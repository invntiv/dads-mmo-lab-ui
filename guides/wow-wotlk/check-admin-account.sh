#!/bin/bash
# ============================================================
#  Dad's MMO Lab — Check Admin Account / Login Diagnostics
#  https://github.com/DadsMmoLab/dads-mmo-lab
#
#  Run this if you can't log into WoW after installing.
#  It checks the AzerothCore database for the admin/admin
#  account, shows all accounts that exist, and verifies the
#  realmlist is reachable.
#
#  Usage: chmod +x check-admin-account.sh && ./check-admin-account.sh
# ============================================================

set -o pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m'
BOLD='\033[1m'

print_success() { echo -e "${GREEN}✅ $1${NC}"; }
print_info()    { echo -e "${BLUE}ℹ️  $1${NC}"; }
print_error()   { echo -e "${RED}❌ $1${NC}"; }
print_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }

clear
echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║${WHITE}${BOLD}         🔍  DAD'S MMO LAB                        ${NC}${CYAN}║${NC}"
echo -e "${CYAN}║${WHITE}        Check Admin Account / Login Help         ${NC}${CYAN}║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# ─────────────────────────────────────────
# STEP 1 — Make sure Docker is alive
# ─────────────────────────────────────────
print_info "Checking Docker..."
if ! docker ps &>/dev/null && ! sudo docker ps &>/dev/null; then
    print_error "Docker is not running or not installed."
    echo -e "${YELLOW}Run fix-after-update.sh first, then try again.${NC}"
    exit 1
fi
# If we need sudo, shim it so the rest of the script just works.
if ! docker ps &>/dev/null; then
    docker() { sudo /usr/bin/docker "$@"; }
fi
print_success "Docker is running"

# ─────────────────────────────────────────
# STEP 2 — Find the database container
# ─────────────────────────────────────────
print_info "Looking for the AzerothCore database container..."

# acore-docker calls it "ac-database". Older / manual installs may use
# "ac_database" or the compose-prefixed "wow-server-ac-database-1".
DB_CONTAINER=$(docker ps --format '{{.Names}}' 2>/dev/null \
    | grep -iE "(^|[-_])ac[-_]database" | head -1)

if [ -z "$DB_CONTAINER" ]; then
    print_error "No running database container found."
    echo ""
    echo -e "${YELLOW}All containers currently on this system:${NC}"
    docker ps -a --format 'table {{.Names}}\t{{.Status}}' 2>/dev/null
    echo ""
    echo -e "${YELLOW}Start your server first:${NC}"
    echo -e "  ${CYAN}cd ~/wow-server && docker compose up -d${NC}"
    exit 1
fi
print_success "Found database container: ${DB_CONTAINER}"

# ─────────────────────────────────────────
# STEP 3 — Connect to MySQL inside the container
# ─────────────────────────────────────────
# acore-docker default root password is "password". Older manual
# installs may use "azeroth". Try both.
DB_PASS=""
for try_pass in password azeroth; do
    if docker exec -i "$DB_CONTAINER" \
        mysql -uroot -p"$try_pass" -N -B -e "SELECT 1;" \
        &>/dev/null; then
        DB_PASS="$try_pass"
        break
    fi
done

if [ -z "$DB_PASS" ]; then
    print_error "Couldn't connect to MySQL with the default passwords."
    echo -e "${YELLOW}The container is up but MySQL isn't accepting logins.${NC}"
    echo -e "${YELLOW}Try: ${CYAN}docker restart $DB_CONTAINER${NC}"
    echo -e "${YELLOW}Then wait 30 seconds and run this script again.${NC}"
    exit 1
fi
print_success "Connected to MySQL"

sql() {
    docker exec -i "$DB_CONTAINER" \
        mysql -uroot -p"$DB_PASS" -N -B -e "$1" 2>/dev/null
}

# ─────────────────────────────────────────
# SRP6 + direct-SQL account creation
# ─────────────────────────────────────────
# AzerothCore stores account credentials as SRP6 salt+verifier, not a
# password hash. The worldserver computes these on `account create`, but
# its console doesn't accept piped stdin reliably (earlier versions of
# this script tried — the writes vanished). So we do what install-wow-ui.sh
# does at install time: compute the salt+verifier ourselves in Python and
# INSERT directly into acore_auth.account. Lifted from
# install-wow-ui.sh::srp6_compute() — keep them in sync.
#
# The `env -u` strip protects against pyenv/conda/Homebrew setting
# PYTHONHOME at the user level, which can make system python3 fail to
# import its own stdlib.
srp6_compute() {
    local user="$1" pass="$2"
    env -u PYTHONHOME -u PYTHONPATH -u PYTHONSTARTUP -u PYTHONNOUSERSITE \
        python3 - "$user" "$pass" <<'PYEOF'
import hashlib, secrets, sys
N = int("894B645E89E1535BBDAD5B8B290650530801B18EBFBF5E8FAB3C82872A3E9BB7", 16)
G = 7
user = sys.argv[1].upper()
pw = sys.argv[2].upper()
salt = secrets.token_bytes(32)
inner = hashlib.sha1(f"{user}:{pw}".encode()).digest()
outer = hashlib.sha1(salt + inner).digest()
x = int.from_bytes(outer, "little")
v = pow(G, x, N).to_bytes(32, "little")
print(f"{salt.hex().upper()} {v.hex().upper()}")
PYEOF
}

# Idempotent: returns the existing id on stdout if the account already
# exists, otherwise inserts a new row and returns the new id. Non-zero
# exit means the insert genuinely failed (SRP6 compute error, SQL error).
create_account_via_srp6() {
    local user="$1" pass="$2"
    local upper_user
    upper_user=$(echo "$user" | tr '[:lower:]' '[:upper:]')

    local existing_id
    existing_id=$(sql "SELECT id FROM acore_auth.account WHERE username='${upper_user}' LIMIT 1;")
    if [ -n "$existing_id" ]; then
        echo "$existing_id"
        return 0
    fi

    local salt_hex verifier_hex
    read -r salt_hex verifier_hex < <(srp6_compute "$upper_user" "$pass")
    if [ -z "$salt_hex" ] || [ -z "$verifier_hex" ]; then
        return 1
    fi

    sql "INSERT INTO acore_auth.account (username, salt, verifier, expansion) \
         VALUES ('${upper_user}', UNHEX('${salt_hex}'), UNHEX('${verifier_hex}'), 2);" \
        || return 1

    local id
    id=$(sql "SELECT id FROM acore_auth.account WHERE username='${upper_user}' LIMIT 1;")
    [ -z "$id" ] && return 1
    echo "$id"
}

# ─────────────────────────────────────────
# STEP 4 — Does the auth database even exist?
# ─────────────────────────────────────────
if ! sql "USE acore_auth;" &>/dev/null; then
    print_error "The 'acore_auth' database doesn't exist yet."
    echo -e "${YELLOW}The worldserver hasn't finished initializing the databases.${NC}"
    echo -e "${YELLOW}Watch the worldserver logs and wait for 'World initialized':${NC}"
    echo -e "  ${CYAN}docker logs -f \$(docker ps --format '{{.Names}}' | grep worldserver | head -1)${NC}"
    exit 1
fi
print_success "acore_auth database exists"

# ─────────────────────────────────────────
# STEP 5 — Look up the admin account
# ─────────────────────────────────────────
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${WHITE}${BOLD}  Admin account check${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# AzerothCore stores usernames uppercased.
ADMIN_ROW=$(sql "SELECT id, username FROM acore_auth.account WHERE username='ADMIN';")
if [ -z "$ADMIN_ROW" ]; then
    print_error "No 'admin' account exists in the database."
    ADMIN_ID=""
else
    ADMIN_ID=$(echo "$ADMIN_ROW" | awk '{print $1}')
    print_success "Admin account exists (id=${ADMIN_ID})"

    # Check GM level — without this it logs in but can't run GM commands
    GM_LEVEL=$(sql "SELECT gmlevel FROM acore_auth.account_access \
        WHERE id=${ADMIN_ID} AND RealmID=-1 LIMIT 1;")
    if [ -z "$GM_LEVEL" ]; then
        print_warning "Admin account has NO GM level set (it can log in, but won't be a GM)."
    else
        print_success "GM level: ${GM_LEVEL}"
    fi
fi

# ─────────────────────────────────────────
# STEP 6 — List ALL accounts so the user can see what's there
# ─────────────────────────────────────────
echo ""
echo -e "${WHITE}${BOLD}All accounts in the database:${NC}"
ACCOUNT_LIST=$(sql "SELECT id, username, email, last_login FROM acore_auth.account ORDER BY id;")
if [ -z "$ACCOUNT_LIST" ]; then
    echo -e "  ${RED}(none — the account table is empty)${NC}"
else
    printf "  ${WHITE}%-4s  %-20s  %-25s  %s${NC}\n" "ID" "USERNAME" "EMAIL" "LAST LOGIN"
    echo "$ACCOUNT_LIST" | while IFS=$'\t' read -r id username email last_login; do
        printf "  %-4s  %-20s  %-25s  %s\n" "$id" "$username" "${email:-—}" "${last_login:-never}"
    done
fi

# ─────────────────────────────────────────
# STEP 7 — Check the realmlist (most common "can't login" cause)
# ─────────────────────────────────────────
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${WHITE}${BOLD}  Realmlist check${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
REALM_ROW=$(sql "SELECT id, name, address, port FROM acore_auth.realmlist;")
if [ -z "$REALM_ROW" ]; then
    print_error "No realm rows found. The worldserver hasn't registered itself."
else
    echo -e "${WHITE}Realms registered:${NC}"
    echo "$REALM_ROW" | while IFS=$'\t' read -r rid rname raddr rport; do
        echo -e "  ${WHITE}id=${rid}  name='${rname}'  address=${CYAN}${raddr}${WHITE}  port=${rport}${NC}"
    done
    echo ""
    echo -e "${YELLOW}Your WoW client's realmlist.wtf file must point to the SAME address.${NC}"
    echo -e "${YELLOW}For a local install on this Steam Deck, that's usually:${NC}"
    echo -e "  ${CYAN}set realmlist 127.0.0.1${NC}"
    echo -e "${YELLOW}File location (in the WoW client folder):${NC}"
    echo -e "  ${CYAN}Data/enUS/realmlist.wtf${NC}  (or enGB / your language)"
fi

# ─────────────────────────────────────────
# STEP 8 — Are authserver and worldserver actually up?
# ─────────────────────────────────────────
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${WHITE}${BOLD}  Server containers${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
docker ps --format 'table {{.Names}}\t{{.Status}}' 2>/dev/null \
    | grep -iE "NAMES|ac[-_](authserver|worldserver|database)"

AUTH_UP=$(docker ps --format '{{.Names}}' 2>/dev/null \
    | grep -iE "ac[-_]authserver" | head -1)
WORLD_UP=$(docker ps --format '{{.Names}}' 2>/dev/null \
    | grep -iE "ac[-_]worldserver" | head -1)
echo ""
[ -z "$AUTH_UP" ]  && print_error  "authserver is NOT running — the WoW client can't reach the login server."
[ -z "$WORLD_UP" ] && print_warning "worldserver is NOT running — you'd get past login but couldn't enter the world."
[ -n "$AUTH_UP" ] && [ -n "$WORLD_UP" ] && print_success "Both authserver and worldserver are running."

# ─────────────────────────────────────────
# STEP 9 — If admin is missing, offer to create it
# ─────────────────────────────────────────
if [ -z "$ADMIN_ID" ]; then
    echo ""
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${WHITE}${BOLD}  Create the admin/admin account now?${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "${WHITE}I'll compute the SRP6 salt+verifier and INSERT the${NC}"
    echo -e "${WHITE}admin account directly into the database — same path${NC}"
    echo -e "${WHITE}the installer uses, so it's reliable.${NC}"
    echo ""
    echo -e "${WHITE}Type ${GREEN}yes${WHITE} to create admin/admin with GM level 3,${NC}"
    echo -e "${WHITE}or anything else to skip: ${NC}"
    read -r confirm
    if [[ "$confirm" == "yes" ]]; then
        # python3 is on base SteamOS/Arch/Ubuntu, but check anyway so a
        # missing interpreter produces a clear message instead of a silent
        # SRP6 compute failure.
        if ! command -v python3 &>/dev/null; then
            print_error "python3 isn't installed — needed for SRP6 hash computation."
            print_info  "Install it: ${CYAN}sudo pacman -S python${NC} (or apt: ${CYAN}sudo apt install python3${NC})"
            exit 1
        fi

        print_info "Computing SRP6 verifier for admin/admin..."
        NEW_ID=$(create_account_via_srp6 "admin" "admin")
        CREATE_RC=$?

        if [ "$CREATE_RC" != "0" ] || [ -z "$NEW_ID" ]; then
            print_error "Couldn't create the admin account via direct SQL."
            echo -e "${YELLOW}Fallback — do it manually via the worldserver console:${NC}"
            echo -e "  ${CYAN}docker attach $WORLD_UP${NC}"
            echo -e "  ${GREEN}account create admin admin${NC}"
            echo -e "  ${GREEN}account set gmlevel ADMIN 3 -1${NC}"
            echo -e "  ${YELLOW}Exit safely: Ctrl+P then Ctrl+Q (NOT Ctrl+C)${NC}"
            exit 1
        fi

        print_success "Admin account created (id=${NEW_ID})"

        # Grant GM level 3 on all realms (-1) via account_access. The
        # worldserver picks this up on next login attempt without needing
        # a restart. INSERT IGNORE so re-runs don't error on the
        # primary-key conflict.
        print_info "Granting GM level 3..."
        if sql "INSERT IGNORE INTO acore_auth.account_access (id, gmlevel, RealmID) \
                VALUES (${NEW_ID}, 3, -1);"; then
            print_success "GM level granted"
        else
            print_warning "GM-level insert failed — you can log in, but won't be a GM."
            echo -e "${YELLOW}Fix it manually later:${NC}"
            echo -e "  ${CYAN}docker exec ac-database mysql -uroot -ppassword -e \\${NC}"
            echo -e "    ${CYAN}\"INSERT INTO acore_auth.account_access (id, gmlevel, RealmID) VALUES (${NEW_ID}, 3, -1);\" acore_auth${NC}"
        fi

        echo ""
        echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════╗${NC}"
        echo -e "${GREEN}${BOLD}║   ✅ READY TO LOG IN                              ║${NC}"
        echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════╝${NC}"
        echo -e "${WHITE}Log into the WoW client with:${NC}"
        echo -e "  ${GREEN}Username: admin${NC}"
        echo -e "  ${GREEN}Password: admin${NC}"
    fi
fi

echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${WHITE}  📺 youtube.com/@DadsMmoLab${NC}"
echo -e "${WHITE}  📦 github.com/DadsMmoLab/dads-mmo-lab${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

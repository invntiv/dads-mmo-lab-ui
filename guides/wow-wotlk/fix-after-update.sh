#!/bin/bash
# ============================================================
#  Dad's MMO Lab — Fix Docker After SteamOS Update
#  https://github.com/DadsMmoLab/dads-mmo-lab
#
#  Run this if Docker stops working after a SteamOS update
#  Usage: chmod +x fix-after-update.sh && ./fix-after-update.sh
# ============================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m'
BOLD='\033[1m'

clear
echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║${WHITE}${BOLD}         ⚙️  DAD'S MMO LAB                        ${NC}${CYAN}║${NC}"
echo -e "${CYAN}║${WHITE}         Fix Docker After SteamOS Update          ${NC}${CYAN}║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}SteamOS updates can wipe Docker and break the${NC}"
echo -e "${YELLOW}pacman keyring. This script fixes both!${NC}"
echo ""

print_success() { echo -e "${GREEN}✅ $1${NC}"; }
print_info()    { echo -e "${BLUE}ℹ️  $1${NC}"; }
print_error()   { echo -e "${RED}❌ $1${NC}"; }
print_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }

# Returns 0 only when `docker` is REAL Docker (not the podman-docker shim
# SteamOS sometimes ships) AND the `docker compose` plugin works. We need
# both: the shim makes `docker ps` succeed by translating to `podman`, but
# it cannot satisfy `docker compose` since compose v2 is a Go plugin that
# the AzerothCore stack relies on. A plain `docker ps` check is a false
# positive on a shim-only system.
is_real_docker() {
    docker compose version &>/dev/null \
        && ! docker --version 2>&1 | grep -qi podman
}

# True iff the podman-docker shim package is installed. The shim provides
# /usr/bin/docker as a wrapper around podman, which both blocks pacman's
# real `docker` install (file conflict on /usr/bin/docker) and produces
# the false positive above.
has_podman_docker_shim() {
    pacman -Qi podman-docker &>/dev/null
}

# ─────────────────────────────────────────
# STEP 1 — Disable read-only filesystem
# ─────────────────────────────────────────
print_info "Disabling SteamOS read-only filesystem..."
sudo steamos-readonly disable
print_success "Read-only disabled"

# ─────────────────────────────────────────
# STEP 2 — Warn and confirm before keyring reset
# ─────────────────────────────────────────
echo ""
echo -e "${RED}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${RED}║${WHITE}${BOLD}          ⚠️  KEYRING RESET REQUIRED              ${NC}${RED}║${NC}"
echo -e "${RED}╠══════════════════════════════════════════════════╣${NC}"
echo -e "${RED}║${NC}  This script needs to reset your pacman keyring. ${RED}║${NC}"
echo -e "${RED}║${NC}                                                  ${RED}║${NC}"
echo -e "${RED}║${NC}  It will:                                        ${RED}║${NC}"
echo -e "${RED}║${YELLOW}    • Delete /etc/pacman.d/gnupg               ${NC}${RED}║${NC}"
echo -e "${RED}║${YELLOW}    • Reinitialize the keyring                 ${NC}${RED}║${NC}"
echo -e "${RED}║${YELLOW}    • Repopulate Arch + Holo (SteamOS) keys   ${NC}${RED}║${NC}"
echo -e "${RED}║${NC}                                                  ${RED}║${NC}"
echo -e "${RED}║${WHITE}  ⚠️  Any custom keys you added manually will   ${NC}${RED}║${NC}"
echo -e "${RED}║${WHITE}  be removed. Re-add them after this runs       ${NC}${RED}║${NC}"
echo -e "${RED}║${WHITE}  if your system needs them.                    ${NC}${RED}║${NC}"
echo -e "${RED}║${NC}                                                  ${RED}║${NC}"
echo -e "${RED}║${GREEN}  Safe for most standard Steam Deck setups.    ${NC}${RED}║${NC}"
echo -e "${RED}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${WHITE}Type ${GREEN}yes${WHITE} to continue, or anything else to cancel: ${NC}"
read -r confirm
echo ""

if [[ "$confirm" != "yes" ]]; then
    print_error "Cancelled. No changes made."
    exit 1
fi

print_info "Rebuilding pacman keyring..."
sudo rm -rf /etc/pacman.d/gnupg
sudo pacman-key --init
sudo pacman-key --populate archlinux
sudo pacman-key --populate holo
print_success "Keyring rebuilt"

# ─────────────────────────────────────────
# STEP 3 — Enable SteamOS dev mode (auto-confirmed)
# ─────────────────────────────────────────
# `steamos-devmode enable` is interactive — it prints a long warning and
# waits for y/N. Piping `yes` answers it without hanging the script. We
# keep the call best-effort: if the user doesn't have steamos-devmode, or
# Valve changes the prompt shape, we move on instead of aborting.
if command -v steamos-devmode &>/dev/null; then
    print_info "Enabling SteamOS developer mode (auto-confirming the prompt)..."
    yes y | sudo steamos-devmode enable 2>&1 | tail -5 || \
        print_warning "steamos-devmode enable returned non-zero — continuing anyway"
    print_success "Dev mode step finished"
fi

# ─────────────────────────────────────────
# STEP 4 — Remove podman-docker shim if present
# ─────────────────────────────────────────
# SteamOS may install `podman-docker`, which provides /usr/bin/docker as a
# thin wrapper around podman. That shim breaks us in two ways:
#   1. `pacman -S docker` will fail because /usr/bin/docker is already
#      owned by another package (file conflict).
#   2. Even if /usr/bin/docker happens to work for `ps`, the shim doesn't
#      provide `docker compose` (compose v2 is a Go plugin, not part of
#      podman) — so the AC stack won't come up.
# Removing the shim first makes the real-docker install path work cleanly.
if has_podman_docker_shim; then
    print_warning "Detected podman-docker shim — removing it before installing real Docker"
    # `-Rdd` skips dep checks because podman itself may declare a dep on
    # the shim. We aren't removing podman, just the docker wrapper.
    if ! sudo pacman -Rdd --noconfirm podman-docker; then
        print_warning "Couldn't remove podman-docker cleanly — will try --overwrite during install"
    else
        print_success "podman-docker shim removed"
    fi
fi

# ─────────────────────────────────────────
# STEP 5 — Reinstall Docker
# ─────────────────────────────────────────
print_info "Updating keyring package..."
if ! sudo pacman -Sy --noconfirm archlinux-keyring; then
    print_warning "archlinux-keyring update failed — Docker install may fail."
fi

print_info "Reinstalling Docker..."
# `--overwrite '/usr/bin/docker'` is a belt-and-suspenders guard against
# leftover shim files (e.g. if `pacman -Rdd podman-docker` above failed
# but the file is still on disk).
if ! sudo pacman -Sy --noconfirm --overwrite '/usr/bin/docker' docker docker-compose; then
    print_error "Failed to reinstall Docker. Check your internet connection."
    exit 1
fi
print_success "Docker reinstalled"

# ─────────────────────────────────────────
# STEP 6 — Restart Docker service
# ─────────────────────────────────────────
print_info "Starting Docker service..."
sudo systemctl daemon-reload
sudo systemctl enable docker
sudo systemctl start docker
sleep 3

# ─────────────────────────────────────────
# STEP 7 — Verify
# ─────────────────────────────────────────
# is_real_docker() is the only verification — plain `docker ps` is unsafe
# here because the podman shim makes it succeed (see helper docs above).
if is_real_docker || (sudo bash -c 'docker compose version &>/dev/null && ! docker --version 2>&1 | grep -qi podman'); then
    echo ""
    echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}${BOLD}║   ✅ DOCKER IS WORKING AGAIN!                    ║${NC}"
    echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════╝${NC}"
    echo ""

    # ─────────────────────────────────────────
    # STEP 8 — Refresh wotlk server Docker networks
    # Reinstalling Docker wipes iptables/bridge state.
    # Containers auto-restart against a broken network, so
    # authserver can't reach ac-database → "Unable to connect"
    # in the WoW client. Recreating the network fixes it.
    # The named DB volume is preserved — characters are safe.
    #
    # Scope: ONLY touches wotlk (AzerothCore) servers. A user
    # may have multiple wotlk installs (base + npcbots + playerbots)
    # plus vanilla/other servers — we refresh every wotlk install
    # we find and leave everything else alone.
    # ─────────────────────────────────────────
    WOW_CONTAINERS=$(docker ps -a --format '{{.Names}}' 2>/dev/null | \
        grep -iE "ac[-_](authserver|worldserver|database)")

    # Collect unique compose project dirs from container labels.
    # Multiple wotlk containers in the same project share a working_dir.
    declare -a COMPOSE_DIRS=()
    for container in $WOW_CONTAINERS; do
        dir=$(docker inspect --format \
            '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' \
            "$container" 2>/dev/null)
        [ -z "$dir" ] || [ ! -f "$dir/docker-compose.yml" ] && continue
        seen=0
        for existing in "${COMPOSE_DIRS[@]}"; do
            [ "$existing" = "$dir" ] && seen=1 && break
        done
        [ "$seen" = "0" ] && COMPOSE_DIRS+=("$dir")
    done

    # Fallback: scan home for wotlk compose files (acore/azerothcore only —
    # won't match vanilla/cmangos/vmangos installs).
    if [ ${#COMPOSE_DIRS[@]} -eq 0 ]; then
        while IFS= read -r f; do
            d=$(dirname "$f")
            COMPOSE_DIRS+=("$d")
        done < <(find "$HOME" -maxdepth 3 -name "docker-compose.yml" 2>/dev/null \
            | xargs grep -l -iE "azerothcore|acore-docker" 2>/dev/null)
    fi

    if [ ${#COMPOSE_DIRS[@]} -gt 0 ]; then
        print_info "Refreshing ${#COMPOSE_DIRS[@]} wotlk server(s) (preserves your characters)..."

        # Stop all wotlk servers first
        for dir in "${COMPOSE_DIRS[@]}"; do
            (cd "$dir" && docker compose down >/dev/null 2>&1) || true
        done

        # Prune dangling networks once (global op, but only removes unused)
        docker network prune -f >/dev/null 2>&1

        # Bring each back up
        declare -a FAILED=()
        for dir in "${COMPOSE_DIRS[@]}"; do
            if (cd "$dir" && \
                (docker compose up -d --scale phpmyadmin=0 >/dev/null 2>&1 \
                  || docker compose up -d >/dev/null 2>&1)); then
                print_success "Refreshed: $dir"
            else
                FAILED+=("$dir")
            fi
        done

        if [ ${#FAILED[@]} -eq 0 ]; then
            echo ""
            echo -e "${WHITE}All wotlk servers refreshed — log in and play!${NC}"
        else
            print_warning "Some servers couldn't auto-restart. Run manually:"
            for dir in "${FAILED[@]}"; do
                echo -e "  ${CYAN}cd $dir && docker compose up -d${NC}"
            done
        fi
    else
        echo -e "${WHITE}No wotlk server detected — Docker is fixed and ready.${NC}"
        echo -e "${WHITE}If you have a server, start it with: ${CYAN}cd ~/wow-server && docker compose up -d${NC}"
    fi
else
    print_error "Docker isn't usable yet. Specifically:"
    if docker --version 2>&1 | grep -qi podman; then
        echo -e "  ${YELLOW}• /usr/bin/docker is still the podman shim (not real Docker).${NC}"
        echo -e "    ${WHITE}Try: ${CYAN}sudo pacman -Rdd --noconfirm podman-docker && sudo pacman -S --overwrite '/usr/bin/docker' docker${NC}"
    elif ! command -v docker &>/dev/null; then
        echo -e "  ${YELLOW}• \`docker\` command not found — pacman install probably failed earlier.${NC}"
    elif ! docker compose version &>/dev/null; then
        echo -e "  ${YELLOW}• \`docker compose\` plugin missing — only the docker CLI is installed.${NC}"
        echo -e "    ${WHITE}Try: ${CYAN}sudo pacman -S docker-compose${NC}"
    else
        echo -e "  ${YELLOW}• Docker daemon isn't responding. Try rebooting and re-running this script.${NC}"
    fi
fi

echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${WHITE}  📺 youtube.com/@DadsMmoLab${NC}"
echo -e "${WHITE}  📦 github.com/DadsMmoLab/dads-mmo-lab${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

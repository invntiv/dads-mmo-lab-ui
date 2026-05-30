#!/bin/bash
# ============================================================
#  Dad's MMO Lab — WoW Server Setup (UI-driven)
#
#  Non-interactive variant of install-wow.sh. All user input
#  is supplied by the Tauri UI via environment variables; this
#  script never calls `read`. Output goes straight to stdout
#  so the UI can stream it into its terminal console.
#
#  Required env vars (set by the UI before invocation):
#    DML_SERVER_TYPE    base | npcbots | playerbots
#
#  Optional env vars:
#    DML_BUILD_METHOD   prebuilt | compile  (only used for npcbots;
#                       playerbots is always compile, base ignores it)
#    DML_ADMIN_USER     stored in the install metadata for later
#    DML_ADMIN_PASS     account creation (account creation itself
#                       still happens after the worldserver is ready)
#    DML_FORCE          "1" to wipe an existing install at the target
#                       directory; otherwise the script aborts if the
#                       directory already exists.
#    DML_DEV_CONTAINER  "1" to force the dev-container Docker path — use the
#                       host's daemon via the mounted socket instead of
#                       installing+starting one. Auto-detected for distrobox/
#                       toolbox/podman, so it's rarely set by hand, and never
#                       triggers on a real SteamOS host.
#
#  Differences from install-wow.sh:
#    - No `read` prompts, no `clear`. The script runs straight through.
#    - No keyring-reset prompt: if pacman is broken, we abort with a
#      clear error and let the user run install-wow.sh from a real
#      terminal to handle it interactively. Avoiding silent destructive
#      ops is non-negotiable per CLAUDE.md.
#    - No module installs at install time. Same as install-wow.sh today:
#      modules are added afterward via manage-wow-modules.sh.
#    - No "create accounts" wait loop. The UI handles account creation
#      out-of-band once the worldserver reports ready.
# ============================================================

WIZARD_VERSION="1.1.0-ui"

set -o pipefail

# ─────────────────────────────────────────
# COLORS  (kept so output looks the same in
# a real terminal as in the UI's console)
# ─────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m'
BOLD='\033[1m'

print_header() {
    echo ""
    echo -e "${CYAN}══════════════════════════════════════════════════${NC}"
    echo -e "${WHITE}${BOLD}  DAD'S MMO LAB — WoW Server Installer${NC}"
    echo -e "${BLUE}  github.com/DadsMmoLab/dads-mmo-lab — v${WIZARD_VERSION}${NC}"
    echo -e "${CYAN}══════════════════════════════════════════════════${NC}"
    echo ""
}

print_step() {
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${WHITE}${BOLD} $1${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

print_success() { echo -e "${GREEN}[OK]  $1${NC}"; }
print_warning() { echo -e "${YELLOW}[WARN] $1${NC}"; }
print_error()   { echo -e "${RED}[ERR] $1${NC}"; }
print_info()    { echo -e "${BLUE}[..]  $1${NC}"; }

# ─────────────────────────────────────────
# UI COLLAPSIBLE-SECTION MARKERS
# ─────────────────────────────────────────
# The Tauri UI's forward_lines watches for these sentinel lines and turns
# them into `install:section` events, then hides the sentinel from the
# console. Wrap noisy commands (docker build, docker pull) with these so
# the user gets a collapsible block instead of thousands of lines.
section_start() { echo "::DML::SECTION::START::$1::"; }
section_end()   { echo "::DML::SECTION::END::"; }

# ─────────────────────────────────────────
# USER-MODULE REGISTRY
# ─────────────────────────────────────────
# Mirror of MODULE_REGISTRY in manage-wow-modules.sh:89-98 — the eight
# add-on modules the UI exposes during onboarding. Format: key|url.
# Filenames of .conf.dist files are discovered at install time (each
# module owns the naming convention), so no second column needed.
declare -a USER_MODULE_REGISTRY=(
    "mod-ah-bot-plus|https://github.com/NathanHandley/mod-ah-bot-plus.git"
    "mod-solocraft|https://github.com/azerothcore/mod-solocraft.git"
    "mod-aoe-loot|https://github.com/azerothcore/mod-aoe-loot.git"
    "mod-learn-spells|https://github.com/azerothcore/mod-learn-spells.git"
    "mod-individual-progression|https://github.com/ZhengPeiRu21/mod-individual-progression.git"
    "mod-autobalance|https://github.com/azerothcore/mod-autobalance.git"
    "mod-transmog|https://github.com/azerothcore/mod-transmog.git"
    "mod-1v1-arena|https://github.com/azerothcore/mod-1v1-arena.git"
    "mod-npc-enchanter|https://github.com/azerothcore/mod-npc-enchanter.git"
)

# Look up a module URL by key. Returns empty string if not found —
# unknown keys are skipped (don't fail the install).
user_module_url() {
    local key="$1" entry k url
    for entry in "${USER_MODULE_REGISTRY[@]}"; do
        IFS='|' read -r k url <<< "$entry"
        if [ "$k" = "$key" ]; then
            echo "$url"
            return 0
        fi
    done
    return 1
}

# Replace or append a key=value line in a conf file. Used to apply the
# UI's per-module overrides on top of the upstream `.conf.dist` copy.
# Match is exact: leading whitespace + key + optional whitespace + `=`.
# If the key exists, the line is rewritten; otherwise appended.
conf_set() {
    local file="$1" key="$2" value="$3"
    if [ ! -f "$file" ]; then
        print_warning "conf_set: $file missing — skipping $key"
        return 1
    fi
    # Escape for sed: only `|` is unsafe in our delimiter; values are
    # ints / floats / 0|1 so this is sufficient.
    local escaped_value="${value//|/\\|}"
    if grep -qE "^[[:space:]]*${key}[[:space:]]*=" "$file"; then
        sed -i -E "s|^[[:space:]]*${key}[[:space:]]*=.*|${key} = ${escaped_value}|" "$file"
    else
        echo "${key} = ${value}" >> "$file"
    fi
}

# Per-module conf writer. For each module the UI asks about, translate
# the relevant DML_MOD_* env vars into conf overrides. Modules with no
# UI knobs (or with env vars unset) get only the `.conf.dist` defaults.
apply_module_overrides() {
    local key="$1" module_dir="$2" conf_target_dir="$3"
    local conf_dist
    # Most modules ship a single .conf.dist; find it.
    conf_dist=$(find "$module_dir/conf" -maxdepth 1 -name "*.conf.dist" 2>/dev/null | head -1)
    if [ -z "$conf_dist" ]; then
        # Some modules (aoe-loot, autobalance, etc.) keep dists in
        # subdirs. Fall back to a recursive find.
        conf_dist=$(find "$module_dir/conf" -name "*.conf.dist" 2>/dev/null | head -1)
    fi
    if [ -z "$conf_dist" ]; then
        print_info "$key: no .conf.dist found (module has no configurable conf)"
        return 0
    fi

    local basename_dist conf_active
    basename_dist=$(basename "$conf_dist")
    # Drop the .dist suffix: `mod_ahbot.conf.dist` -> `mod_ahbot.conf`
    conf_active="$conf_target_dir/${basename_dist%.dist}"
    mkdir -p "$conf_target_dir"
    cp "$conf_dist" "$conf_active"

    case "$key" in
        mod-ah-bot-plus)
            # Onboarding knobs mapped to mod-ah-bot-plus's schema.
            # Plus uses different field names + a boolean style ("true"/
            # "false" lowercase rather than 1/0). Unset env vars leave
            # the .conf.dist default in place.
            [ -n "$DML_MOD_AHBOT_ITEMS_PER_CYCLE" ] && \
                conf_set "$conf_active" "AuctionHouseBot.ItemsPerCycle" "$DML_MOD_AHBOT_ITEMS_PER_CYCLE"

            # Map our wizard's three-way enum (short/medium/long) to
            # the new (min,max) seconds pair. Defaults match upstream's
            # .conf.dist medium band.
            if [ -n "$DML_MOD_AHBOT_ELAPSING_TIME_CLASS" ]; then
                local listing_min listing_max
                case "$DML_MOD_AHBOT_ELAPSING_TIME_CLASS" in
                    2)  listing_min=600    listing_max=3600   ;;  # 10min-1hr (short)
                    0)  listing_min=86400  listing_max=172800 ;;  # 1d-2d   (long)
                    *)  listing_min=3600   listing_max=86400  ;;  # 1hr-24hr (medium / default)
                esac
                conf_set "$conf_active" "AuctionHouseBot.ListingExpireTimeInSecondsMin" "$listing_min"
                conf_set "$conf_active" "AuctionHouseBot.ListingExpireTimeInSecondsMax" "$listing_max"
            fi

            # Buyer is now under `Buyer.Enabled` and takes a real bool.
            # Translate our 1/0 env from the wizard.
            if [ -n "$DML_MOD_AHBOT_ENABLE_BUYER" ]; then
                local buyer_val=false
                [ "$DML_MOD_AHBOT_ENABLE_BUYER" = "1" ] && buyer_val=true
                conf_set "$conf_active" "AuctionHouseBot.Buyer.Enabled" "$buyer_val"
            fi

            # Profession materials now map to a family of AdvancedPricing
            # toggles per TradeGood subcategory. ON = include those item
            # classes in the bot's pricing model so they show up on the
            # AH. OFF leaves the .conf.dist defaults (all true) intact.
            if [ -n "$DML_MOD_AHBOT_PROFESSION_ITEMS" ]; then
                local prof_val=false
                [ "$DML_MOD_AHBOT_PROFESSION_ITEMS" = "1" ] && prof_val=true
                conf_set "$conf_active" "AuctionHouseBot.AdvancedPricing.TradeGood.Cloth.Enabled"      "$prof_val"
                conf_set "$conf_active" "AuctionHouseBot.AdvancedPricing.TradeGood.Herb.Enabled"       "$prof_val"
                conf_set "$conf_active" "AuctionHouseBot.AdvancedPricing.TradeGood.MetalStone.Enabled" "$prof_val"
                conf_set "$conf_active" "AuctionHouseBot.AdvancedPricing.TradeGood.Leather.Enabled"    "$prof_val"
                conf_set "$conf_active" "AuctionHouseBot.AdvancedPricing.TradeGood.Enchanting.Enabled" "$prof_val"
                conf_set "$conf_active" "AuctionHouseBot.AdvancedPricing.TradeGood.Elemental.Enabled"  "$prof_val"
            fi

            # Note: plus drops the old `VendorItems` toggle — vendor
            # goods are handled via the new mod's Blizzlike rules. The
            # wizard no longer exposes that knob.

            # Bot character is wired up after worldserver bootstrap by
            # bootstrap_accounts_and_ahbot — it writes the actual GUID
            # into AuctionHouseBot.GUIDs and flips EnableSeller to true.
            # Until then leave seller off so the bot loads but stays
            # inert.
            conf_set "$conf_active" "AuctionHouseBot.GUIDs"        "0"
            conf_set "$conf_active" "AuctionHouseBot.EnableSeller" "false"
            print_info "AH Bot: bot character will be wired up after install."
            ;;
        mod-individual-progression)
            if [ "${DML_MOD_IP_AUTHENTIC_DIFFICULTY:-0}" = "1" ]; then
                conf_set "$conf_active" "IndividualProgression.VanillaPowerAdjustment"   "0.6"
                conf_set "$conf_active" "IndividualProgression.VanillaHealingAdjustment" "0.6"
                conf_set "$conf_active" "IndividualProgression.TBCPowerAdjustment"       "0.6"
                conf_set "$conf_active" "IndividualProgression.TBCHealingAdjustment"     "0.6"
            fi
            if [ -n "$DML_MOD_IP_DISABLE_RDF" ]; then
                conf_set "$conf_active" "IndividualProgression.DisableRDF" "$DML_MOD_IP_DISABLE_RDF"
            fi
            # DK gating: stored as enum 0 (disabled) or 13 (require TBC).
            if [ -n "$DML_MOD_IP_DK_REQUIRES_TBC" ]; then
                if [ "$DML_MOD_IP_DK_REQUIRES_TBC" = "1" ]; then
                    conf_set "$conf_active" "IndividualProgression.DeathKnightUnlockProgression" "13"
                else
                    conf_set "$conf_active" "IndividualProgression.DeathKnightUnlockProgression" "0"
                fi
            fi
            ;;
        *)
            # Other modules have no install-time overrides — defaults
            # are correct per MODULES_PLAN.md Phase 1. Power-user
            # toggles get exposed on the post-install Modules page.
            :
            ;;
    esac

    print_success "Wrote $(basename "$conf_active")"
}

# Clone every module listed in DML_MODULES_ADD into <install>/modules/
# and write each one's conf. Anything in <install>/modules/ before the
# initial `docker compose up -d --build` is compiled into the worldserver
# image automatically — no separate rebuild needed.
install_user_modules() {
    if [ -z "${DML_MODULES_ADD:-}" ]; then
        return 0
    fi
    if [ "$SERVER_TYPE" != "playerbots" ]; then
        # Base / NPCBots use prebuilt images — modules can't be compiled
        # in. The Modules page in the UI blocks this too, but if we got
        # here it means someone passed env vars regardless. Skip cleanly.
        print_warning "DML_MODULES_ADD ignored: modules only supported on playerbots installs"
        return 0
    fi
    print_step "Installing optional modules"

    mkdir -p "$SERVER_DIR/modules"
    # The conf target dir is bind-mounted into the container at
    # /azerothcore/env/dist/etc — AC reads module configs from
    # /azerothcore/env/dist/etc/modules/<name>.conf.
    local conf_target_dir="$SERVER_DIR/env/dist/etc/modules"
    mkdir -p "$conf_target_dir"

    local IFS=','
    local key url
    for key in $DML_MODULES_ADD; do
        # Trim incidental whitespace from the comma-separated list.
        key="${key// /}"
        [ -z "$key" ] && continue

        url=$(user_module_url "$key") || {
            print_warning "Unknown module key: $key (skipping)"
            continue
        }

        if [ -d "$SERVER_DIR/modules/$key" ]; then
            print_info "$key already present — skipping clone"
        else
            print_info "Cloning $key..."
            if ! git clone --progress --depth 1 "$url" "$SERVER_DIR/modules/$key"; then
                print_error "Clone failed for $key (continuing without it)"
                continue
            fi
        fi

        apply_module_overrides "$key" "$SERVER_DIR/modules/$key" "$conf_target_dir"
    done

    print_success "Modules ready — they will be compiled into the worldserver image"
}

# ─────────────────────────────────────────
# ELUNA (mod-ale) SETUP
# ─────────────────────────────────────────
# Clones mod-ale and copies the dml_*.lua bridge scripts into the
# install's lua_scripts/. mod-ale is the Lua engine; the dml_*.lua
# files are what register custom SOAP-callable commands like
# `dml_addclass` (My Party "Add to party") and `dml_whisper` (the
# relay for talents / autogear / maintenance whispers).
#
# Without this, the worldserver compiles cleanly but every SOAP call
# the UI makes to `dml_*` returns "Command does not exist" — visible
# in My Party's "Spawn paladin bot — worldserver SOAP fault" toast.
#
# Caller contract: must run with $SERVER_DIR set + modules/ present,
# BEFORE the docker compose build so mod-ale gets compiled into the
# worldserver image.
setup_eluna() {
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local modules_dir="$SERVER_DIR/modules"
    local lua_scripts_dir="$SERVER_DIR/lua_scripts"

    print_info "Installing Eluna (mod-ale) for whisper / addclass bridge..."
    if [ -d "$modules_dir/mod-ale" ]; then
        print_info "mod-ale already present — skipping clone."
    else
        if ! git clone --depth 1 \
            https://github.com/azerothcore/mod-ale.git \
            "$modules_dir/mod-ale"; then
            print_warning "mod-ale clone failed."
            print_warning "Server will still build, but My Party + chat-driven"
            print_warning "commands (talents / autogear / maintenance) won't work."
            return 0
        fi
    fi

    mkdir -p "$lua_scripts_dir"

    # The Lab's Eluna bridge scripts — each wires a SOAP-callable
    # command to a player-context action. Names mirror install-wow.sh's
    # legacy setup_eluna so anything that worked there works here too.
    local copied=0
    local missing=0
    for script_name in dml_whisper.lua dml_addclass.lua dml_uninvite.lua dml_login.lua dml_gm.lua dml_summon_npc.lua; do
        local src="$script_dir/eluna-scripts/$script_name"
        if [ -f "$src" ]; then
            cp "$src" "$lua_scripts_dir/$script_name"
            copied=$((copied + 1))
        else
            print_warning "$script_name not found at: $src"
            missing=$((missing + 1))
        fi
    done
    if [ "$missing" -eq 0 ]; then
        print_success "Eluna installed — $copied bridge scripts ready."
    else
        print_warning "Eluna compiled in, but $missing bridge script(s) missing."
        print_warning "My Party and whisper-driven commands will not work."
    fi
}

# ─────────────────────────────────────────
# PLAYERBOTS COMPOSE OVERRIDE
# ─────────────────────────────────────────
# Writes docker-compose.override.yml for a playerbots install. Shared by
# the fresh-install path and the migrate path so they stay byte-compatible.
#
# $1 = "fresh" | "migrate"
#   fresh   — first-ever compile. Sets CWITH_WARNINGS="OFF" to spare the
#             user AzerothCore's -Wall/-Wextra warning flood. There are no
#             cached objects to invalidate on a clean build, so the flag is
#             free here.
#   migrate — the server was already compiled once (manually). OMIT the
#             CWITH_WARNINGS build arg so the compiler command line matches
#             that original build EXACTLY. ccache keys on the full command
#             line incl. warning flags; flipping them would miss every cache
#             entry and force a full ~1.5h recompile. By omitting the arg we
#             inherit the same default the manual install used, so ccache
#             hits the entire already-built core + playerbots and only the
#             newly-added mod-ale (+ any chosen modules) compiles fresh.
write_playerbots_override() {
    local mode="${1:-fresh}"
    {
        cat << 'TOP'
services:
  ac-worldserver:
    build:
      context: .
      target: worldserver
TOP
        if [ "$mode" = "fresh" ]; then
            cat << 'WARN'
      args:
        # Non-developer install — silence the -Wall/-Wextra warning flood.
        # Documented acore-docker knob; defaults to "ON". (Omitted on
        # migrate to keep ccache warm — see write_playerbots_override.)
        CWITH_WARNINGS: "OFF"
WARN
        fi
        cat << 'BOTTOM'
    volumes:
      - ./modules:/azerothcore/modules
      # Lua scripts for mod-ale (Eluna). The dml_*.lua files in here are
      # the only way to run things like `.playerbots addclass` AS the
      # player from outside the game, which is how My Party spawns bots
      # and how whisper-driven commands (talents, autogear) work.
      # Without this mount the scripts inside the image are inert —
      # `dml_addclass` etc. won't exist when SOAP tries to call them.
      - ./lua_scripts:/azerothcore/env/dist/bin/lua_scripts
    environment:
      AC_PLAYERBOTS_UPDATES_ENABLE_DATABASES: "1"
      AC_AI_PLAYERBOT_RANDOM_BOT_AUTOLOGIN: "1"
      AC_AI_PLAYERBOT_MIN_RANDOM_BOTS: "50"
      AC_AI_PLAYERBOT_MAX_RANDOM_BOTS: "200"
      # SOAP is the long-term GM command channel for the UI. Enabled at
      # install so the app can later issue commands like `additem`,
      # `teleport`, `account set gmlevel`, etc. via HTTP+XML on port 7878
      # using the ADMIN account bootstrap_accounts_and_ahbot creates.
      # Without IP=0.0.0.0 SOAP binds to 127.0.0.1 INSIDE the container,
      # unreachable from the host even though the port is published.
      AC_SOAP_ENABLED: "1"
      AC_SOAP_IP: "0.0.0.0"
      # Tell mod-ale where to find the dml_*.lua scripts. Must be the
      # CONTAINER-side path (it does relative resolution from /azerothcore,
      # which won't match our lua_scripts mount otherwise).
      AC_ALE_SCRIPT_PATH: "/azerothcore/env/dist/bin/lua_scripts"
  ac-authserver:
    build:
      context: .
      target: authserver
  ac-db-import:
    build:
      context: .
      target: db-import
  ac-client-data-init:
    build:
      context: .
      target: client-data
BOTTOM
    } > "$SERVER_DIR/docker-compose.override.yml"
}

# ─────────────────────────────────────────
# COMPILE PLAYERBOTS WORLDSERVER
# ─────────────────────────────────────────
# `docker compose up -d --build` builds multiple images in one shot — the
# playerbots-enabled worldserver and the smaller authserver / db-import /
# client-data targets. Each is its own CMake invocation, so the percentage
# marker `[ NN%]` resets between them. Without a transition the UI parks
# them all under one collapsible with a confusingly-resetting bar.
#
# Filter the live stream through awk: pass every line through, and when the
# percent drops sharply from "near done" back to "fresh start" (>= 80 →
# < 10), emit a SECTION::END + new SECTION::START so the UI renders a clean
# second collapsible for the next stage. `stdbuf -oL` forces line-buffered
# awk output so the console doesn't lag the live build by 4KB chunks.
#
# Returns non-zero on build failure (caller decides whether to exit).
compile_playerbots() {
    print_info "Compiling Worldserver (with Playerbots) and Authserver..."
    cd "$SERVER_DIR" || return 1
    section_start "Docker build (1/2) — Worldserver + Playerbots"
    docker compose up -d --build 2>&1 \
        | tee "$HOME/playerbots-build.log" \
        | stdbuf -oL awk '
            BEGIN { last_pct = -1; stage_emitted = 0 }
            {
                print
                if (match($0, /\[ *[0-9]+%\]/)) {
                    pct_str = substr($0, RSTART, RLENGTH)
                    gsub(/[^0-9]/, "", pct_str)
                    pct = pct_str + 0
                    if (last_pct >= 80 && pct < 10 && !stage_emitted) {
                        print "::DML::SECTION::END::"
                        print "::DML::SECTION::START::Docker build (2/2) — Authserver::"
                        stage_emitted = 1
                    }
                    last_pct = pct
                }
            }'
    # Capture compose exit code NOW — section_end runs commands and would
    # clobber $PIPESTATUS. Index [0] is the docker compose process;
    # tee/stdbuf/awk are downstream.
    local build_rc=${PIPESTATUS[0]}
    section_end
    if [ "$build_rc" -ne 0 ]; then
        print_error "Compilation failed. See ~/playerbots-build.log"
        return 1
    fi
    return 0
}

# ─────────────────────────────────────────
# MIGRATE AN EXISTING (MANUAL) INSTALL TO PARITY
# ─────────────────────────────────────────
# A user who set their server up by hand (install-wow.sh / install-wow-
# wotlk.sh) has a working playerbots fork on disk but is missing the
# Lab-specific bits: SOAP, the Eluna bridge scripts, the AHBot account, and
# the install.json marker. Migrate fills exactly those gaps WITHOUT wiping
# anything — their characters, accounts and data volumes are left intact.
#
# Entered via DML_MIGRATE=1; the UI only routes a buildable playerbots
# source install here (analyze_install gates that), but we re-check anyway.
migrate_existing_install() {
    print_step "Migrating your server to The Lab"

    if [ ! -d "$SERVER_DIR" ]; then
        print_error "No install found at $SERVER_DIR — nothing to migrate."
        exit 1
    fi
    # Only a buildable source tree can be migrated — SOAP + Eluna get
    # compiled in via this Dockerfile. Prebuilt/base/npcbots stacks have
    # nothing to rebuild; the UI shouldn't send them here, but guard.
    if [ ! -f "$SERVER_DIR/apps/docker/Dockerfile" ]; then
        print_error "$SERVER_DIR has no buildable source tree (apps/docker/Dockerfile)."
        print_info  "This server can't be migrated in place — do a fresh Playerbots install instead."
        exit 1
    fi

    # Back up the existing override before replacing it — never silently
    # discard the user's customizations.
    if [ -f "$SERVER_DIR/docker-compose.override.yml" ]; then
        local bak="$SERVER_DIR/docker-compose.override.yml.pre-dml.$(date -u +%Y%m%d%H%M%S).bak"
        if cp "$SERVER_DIR/docker-compose.override.yml" "$bak"; then
            print_success "Backed up existing override → $(basename "$bak")"
        fi
    fi

    # 1. Canonical override — adds SOAP + the lua_scripts mount + Eluna path.
    #    "migrate" mode omits CWITH_WARNINGS so ccache stays warm (see
    #    write_playerbots_override).
    print_info "Updating compose override (adds SOAP + Eluna)..."
    write_playerbots_override migrate
    print_success "Compose override updated."

    # 2. mod-playerbots must be present. These installs are playerbots forks
    #    so it normally is, but a missing module dir would compile a botless
    #    core — clone it if absent.
    if [ ! -d "$SERVER_DIR/modules/mod-playerbots" ]; then
        print_info "mod-playerbots missing — cloning..."
        git clone --progress --depth 1 \
            https://github.com/mod-playerbots/mod-playerbots.git \
            --branch=master \
            "$SERVER_DIR/modules/mod-playerbots" \
            || print_warning "mod-playerbots clone failed — bots may be unavailable."
    fi

    # 3. Eluna (mod-ale) + dml_*.lua bridge. Idempotent: clones mod-ale only
    #    if missing and refreshes all six scripts (fills the dml_summon_npc
    #    gap older manual setup_eluna left out).
    setup_eluna

    # 4. Any modules the user opted into during the (cheap) recompile.
    install_user_modules

    # 5. Recompile. ccache makes this incremental — only mod-ale + any new
    #    modules compile fresh, then a relink.
    if ! compile_playerbots; then
        print_error "Migration build failed — your server is unchanged. See ~/playerbots-build.log"
        exit 1
    fi

    # 6. Server must be reachable before bootstrapping accounts.
    if ! wait_for_server; then
        exit 1
    fi

    # 7. Admin (adopt-or-create) + AHBOT + character + conf. create_account_
    #    via_srp6 is idempotent: an existing admin account is reused untouched
    #    (only GM level is granted), so adopting a hand-made account never
    #    rewrites its password.
    if ! bootstrap_accounts_and_ahbot; then
        print_error "Account setup failed — see above. install.json NOT written; re-run to retry."
        exit 1
    fi

    # 8. Mark complete. Tag build_method so the marker records provenance.
    BUILD_METHOD="migrate"
    write_metadata
}

# ─────────────────────────────────────────
# RESOLVE INPUTS
# ─────────────────────────────────────────
SERVER_TYPE="${DML_SERVER_TYPE:-}"
BUILD_METHOD="${DML_BUILD_METHOD:-}"
FORCE="${DML_FORCE:-0}"

case "$SERVER_TYPE" in
    base)       SERVER_NAME="Base WoW";        SERVER_DIR="$HOME/wow-server" ;;
    npcbots)    SERVER_NAME="NPCBots WoW";     SERVER_DIR="$HOME/wow-server-npcbots" ;;
    playerbots) SERVER_NAME="Playerbots WoW";  SERVER_DIR="$HOME/wow-server-playerbots" ;;
    *)
        print_error "DML_SERVER_TYPE must be one of: base, npcbots, playerbots (got: '$SERVER_TYPE')"
        exit 2
        ;;
esac

# Default build method per server type
if [ "$SERVER_TYPE" = "playerbots" ]; then
    BUILD_METHOD="compile"
elif [ "$SERVER_TYPE" = "npcbots" ] && [ -z "$BUILD_METHOD" ]; then
    BUILD_METHOD="prebuilt"
fi

# ─────────────────────────────────────────
# SYSTEM CHECKS
# ─────────────────────────────────────────
check_system() {
    print_step "Checking system"

    if [[ "$OSTYPE" != "linux-gnu"* ]]; then
        print_error "This installer requires Linux."
        exit 1
    fi
    print_success "Linux detected"

    AVAILABLE_GB=$(df -BG "$HOME" 2>/dev/null | awk 'NR==2 {print $4}' | sed 's/G//' | tr -d ' ')
    if [ -n "$AVAILABLE_GB" ] && [ "$AVAILABLE_GB" -lt 15 ] 2>/dev/null; then
        print_error "Not enough disk space: ${AVAILABLE_GB}GB free, need at least 15GB."
        exit 1
    fi
    print_success "Disk space OK (${AVAILABLE_GB:-unknown}GB available)"

    if ! ping -c 1 -W 3 github.com &>/dev/null; then
        print_error "No internet connection (ping to github.com failed)."
        exit 1
    fi
    print_success "Internet OK"
}

# ─────────────────────────────────────────
# INSTALL DOCKER (non-interactive)
# ─────────────────────────────────────────

# Detect a dev container (distrobox / toolbox / podman). These have no
# systemd to start a docker daemon, but distrobox mounts the host's docker
# socket — so we drive the host daemon with just the CLI instead of
# installing and starting one. Never true on a real SteamOS host, so the
# normal install path below is untouched. DML_DEV_CONTAINER=1 forces it if
# auto-detection ever misses.
running_in_container() {
    [ -n "${DML_DEV_CONTAINER:-}" ] && return 0
    [ -f /run/.containerenv ] && return 0
    [ -f /run/.toolboxenv ] && return 0
    [ -n "${container:-}" ] && return 0
    return 1
}

# Returns 0 only when `docker` is REAL Docker (not the podman-docker shim
# SteamOS sometimes ships) AND the `docker compose` plugin works. The shim
# satisfies `docker ps` but NOT `docker compose` (compose v2 is a Go plugin
# unrelated to podman). The AC stack depends on compose, so any earlier
# check that only ran `docker ps` is a false positive on a shim-only host.
is_real_docker() {
    docker compose version &>/dev/null \
        && ! docker --version 2>&1 | grep -qi podman
}

# True iff the podman-docker shim package is installed. The shim owns
# /usr/bin/docker, which both produces the false positive above and blocks
# a real `pacman -S docker` from installing due to file conflict.
has_podman_docker_shim() {
    pacman -Qi podman-docker &>/dev/null
}

# acore-docker's compile builds use `RUN --mount`, which needs BuildKit.
# Docker can be present WITHOUT the buildx plugin (Arch ships it as a
# separate `docker-buildx` package), so verify it independently of docker
# itself — otherwise the compile dies with "the --mount option requires
# BuildKit" and produces no worldserver image. Idempotent: no-op if present.
ensure_buildx() {
    if docker buildx version &>/dev/null; then
        return 0
    fi
    print_info "Installing Docker BuildKit (buildx)..."
    if command -v pacman &>/dev/null; then
        sudo -n pacman -S --noconfirm --needed docker-buildx >/dev/null 2>&1 || true
    elif command -v apt-get &>/dev/null; then
        sudo -n apt-get install -y docker-buildx >/dev/null 2>&1 || true
    fi
    if ! docker buildx version &>/dev/null; then
        print_warning "Could not confirm Docker BuildKit (buildx) — compile builds may fail."
        print_info  "Install it manually and retry: sudo pacman -S docker-buildx"
    fi
}

install_docker() {
    # Early return ONLY if real Docker (not the podman shim) is in place AND
    # the daemon is reachable. The old check used `docker ps` alone, which
    # silently accepted the podman-docker shim — later `docker compose up`
    # then failed because podman doesn't ship compose v2.
    if command -v docker &>/dev/null \
        && is_real_docker \
        && docker ps &>/dev/null 2>&1; then
        print_success "Docker already installed and running"
        ensure_buildx
        return 0
    fi

    # Dev container: use the host's daemon via the mounted socket. There's no
    # systemd here, so we never start a daemon — just make sure the CLI exists
    # and that `docker ps` reaches the host. Gated on running_in_container() so
    # a real SteamOS host skips straight to the normal install below.
    if running_in_container; then
        print_info "Dev container detected — using the host's Docker daemon (none started here)."
        # docker-buildx is REQUIRED: acore-docker's Dockerfile uses
        # `RUN --mount=type=cache/bind`, which only works under BuildKit.
        # Arch's `docker` package does NOT bundle buildx — without it the
        # compile step fails with "the --mount option requires BuildKit"
        # and the build silently produces no worldserver image.
        if command -v pacman &>/dev/null; then
            sudo -n pacman -S --noconfirm --needed docker docker-compose docker-buildx >/dev/null 2>&1 || true
        elif command -v apt-get &>/dev/null; then
            sudo -n apt-get install -y docker.io docker-compose docker-buildx >/dev/null 2>&1 || true
        fi
        if command -v docker &>/dev/null && docker ps &>/dev/null 2>&1; then
            print_success "Docker CLI present; reaching host daemon via mounted socket"
            return 0
        fi
        print_error "In a dev container but Docker isn't reachable."
        print_info  "Install the CLI in the container (sudo pacman -S docker docker-compose) and confirm the host socket is mounted at /run/host/run/docker.sock."
        exit 1
    fi

    print_info "Installing Docker..."

    if command -v steamos-readonly &>/dev/null; then
        sudo -n steamos-readonly disable 2>/dev/null || {
            print_error "Need passwordless sudo to disable SteamOS read-only mode."
            print_info  "Run install-wow.sh in a terminal first, or add a NOPASSWD sudoers rule."
            exit 1
        }
    fi

    # Fail fast if pacman is broken — UI mode cannot prompt for a keyring reset
    if command -v pacman &>/dev/null; then
        if ! sudo -n pacman -Sy --noconfirm &>/dev/null; then
            print_error "pacman sync failed. Your keyring may be broken."
            print_info  "Run install-wow.sh from Konsole — it handles the keyring reset interactively."
            exit 1
        fi
        # Drop the podman-docker shim before installing real docker. If left
        # in place, pacman aborts with a file conflict on /usr/bin/docker.
        # `-Rdd` skips dep checks since podman may declare a dep on the shim.
        if has_podman_docker_shim; then
            print_info "Removing podman-docker shim so real Docker can install..."
            sudo -n pacman -Rdd --noconfirm podman-docker >/dev/null 2>&1 \
                || print_warning "Couldn't remove podman-docker — falling back to --overwrite"
        fi
        # docker-buildx provides BuildKit. acore-docker's Dockerfile uses
        # `RUN --mount=type=cache/bind`, which only works under BuildKit —
        # without it, compile builds die with "the --mount option requires
        # BuildKit" and produce no worldserver image.
        #
        # `--overwrite '/usr/bin/docker'` is belt-and-suspenders against
        # leftover shim files (e.g. the `-Rdd podman-docker` step above
        # failed but the file is still on disk).
        if ! sudo -n pacman -S --noconfirm --overwrite '/usr/bin/docker' docker docker-compose docker-buildx; then
            print_error "Failed to install Docker via pacman."
            exit 1
        fi
    elif command -v apt-get &>/dev/null; then
        sudo -n apt-get update -y || true
        if ! sudo -n apt-get install -y docker.io docker-compose; then
            print_error "Failed to install Docker via apt-get."
            exit 1
        fi
        # BuildKit (see note above). Best-effort: the package name varies
        # across Debian/Ubuntu releases, so don't fail the install over it.
        sudo -n apt-get install -y docker-buildx >/dev/null 2>&1 || true
    else
        print_error "No supported package manager found (need pacman or apt-get)."
        exit 1
    fi

    sudo -n usermod -aG docker "$USER" || true
    sleep 2
    sudo -n systemctl daemon-reload 2>/dev/null || true
    sudo -n systemctl enable docker 2>/dev/null || true
    if ! sudo -n systemctl start docker 2>/dev/null; then
        print_error "Docker failed to start. Reboot and try again."
        exit 1
    fi
    sleep 3

    print_info "Configuring Docker permissions..."
    echo "$USER ALL=(ALL) NOPASSWD: /usr/bin/docker, /usr/bin/docker-compose" \
        | sudo -n tee /etc/sudoers.d/docker-nopasswd > /dev/null 2>&1 || true
    sudo -n chmod 0440 /etc/sudoers.d/docker-nopasswd 2>/dev/null || true
    sudo -n chmod 666 /var/run/docker.sock 2>/dev/null || true

    # Fail loudly if the install ended up with the shim still in charge —
    # `docker ps` may succeed via podman, but `docker compose up` will fail
    # later, and we want the failure surface to be HERE not five minutes
    # into an AC compile.
    if ! is_real_docker; then
        print_error "Docker install completed but the binary still looks like the podman-docker shim."
        print_info  "Run: sudo pacman -Rdd --noconfirm podman-docker && sudo pacman -S --overwrite '/usr/bin/docker' docker docker-compose"
        exit 1
    fi
    if ! docker ps &>/dev/null 2>&1; then
        if sudo -n docker ps &>/dev/null 2>&1; then
            function docker() { sudo -n docker "$@"; }
            export -f docker 2>/dev/null || true
            print_info "Using sudo for Docker — will work directly after next login."
        else
            print_error "Docker installed but not reachable. Try rebooting."
            exit 1
        fi
    fi

    print_success "Docker installed."
}

install_git() {
    if command -v git &>/dev/null; then
        print_success "Git already installed"
        return 0
    fi
    print_info "Installing Git..."
    if command -v pacman &>/dev/null && sudo -n pacman -Sy --noconfirm git; then
        print_success "Git installed."
    elif command -v apt-get &>/dev/null && sudo -n apt-get install -y git; then
        print_success "Git installed."
    else
        print_error "Failed to install Git."
        exit 1
    fi
}

# ─────────────────────────────────────────
# INSTALL SERVER
# ─────────────────────────────────────────
remove_existing_install_if_forced() {
    if [ ! -d "$SERVER_DIR" ]; then
        return 0
    fi
    if [ "$FORCE" != "1" ]; then
        print_error "An existing install already lives at $SERVER_DIR."
        print_info  "Set DML_FORCE=1 to wipe it, or remove it manually and re-run."
        exit 1
    fi
    print_warning "DML_FORCE=1 set — removing existing install at $SERVER_DIR"
    docker compose -f "$SERVER_DIR/docker-compose.yml" down -v 2>/dev/null || true
    sudo -n rm -rf "$SERVER_DIR" 2>/dev/null || rm -rf "$SERVER_DIR"
}

install_server() {
    print_step "Installing $SERVER_NAME"

    print_info "Checking dependencies..."
    install_docker
    install_git
    remove_existing_install_if_forced

    case "$SERVER_TYPE" in
        base)
            print_info "Downloading AzerothCore..."
            git clone --progress --depth 1 \
                https://github.com/azerothcore/acore-docker.git \
                "$SERVER_DIR"

            if [ ! -f "$SERVER_DIR/docker-compose.yml" ]; then
                print_error "Download failed."
                exit 1
            fi

            cat > "$SERVER_DIR/docker-compose.override.yml" << 'EOF'
services:
  phpmyadmin:
    ports:
      - "8181:80"
EOF
            mkdir -p "$SERVER_DIR/scripts/lua"
            print_success "AzerothCore downloaded."

            print_info "Pulling server images..."
            cd "$SERVER_DIR" || exit 1
            if ! docker compose pull; then
                print_error "Failed to pull images."
                exit 1
            fi

            print_info "Starting server..."
            if ! docker compose up -d --scale phpmyadmin=0; then
                print_error "Failed to start server."
                exit 1
            fi
            ;;

        npcbots)
            if [ "$BUILD_METHOD" = "prebuilt" ]; then
                print_info "Using pre-built NPCBots images..."
                git clone --progress --depth 1 \
                    https://github.com/trickerer/AzerothCore-wotlk-with-NPCBots.git \
                    "$SERVER_DIR"

                mkdir -p "$HOME/npcbots-sql"
                cp -r "$SERVER_DIR/data/sql/custom/db_auth"       "$HOME/npcbots-sql/"
                cp -r "$SERVER_DIR/data/sql/custom/db_characters" "$HOME/npcbots-sql/"
                cp -r "$SERVER_DIR/data/sql/custom/db_world"      "$HOME/npcbots-sql/"

                sudo -n rm -rf "$SERVER_DIR" 2>/dev/null || rm -rf "$SERVER_DIR"
                git clone --progress --depth 1 \
                    https://github.com/azerothcore/acore-docker.git \
                    "$SERVER_DIR"

                cat > "$SERVER_DIR/docker-compose.override.yml" << 'EOF'
services:
  phpmyadmin:
    ports:
      - "8181:80"
EOF
                cd "$SERVER_DIR" || exit 1
                if ! docker compose pull; then
                    print_error "Failed to pull NPCBots images."
                    exit 1
                fi
                if ! docker compose up -d --scale phpmyadmin=0; then
                    print_error "Failed to start NPCBots server."
                    exit 1
                fi

                # Apply NPCBots SQL (best-effort, identical to install-wow.sh)
                print_info "Waiting for database to be ready..."
                sleep 15
                DB_CONTAINER=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -i "database" | head -1)
                DB_CONTAINER="${DB_CONTAINER:-wow-server-ac-database-1}"
                local sql_errors=0
                for db in db_auth:acore_auth db_characters:acore_characters db_world:acore_world; do
                    folder="${db%%:*}"; schema="${db##*:}"
                    for f in "$HOME/npcbots-sql/$folder/"*.sql; do
                        [ -f "$f" ] || continue
                        if ! docker exec -i "$DB_CONTAINER" mysql -uroot -ppassword "$schema" < "$f" 2>/dev/null; then
                            print_warning "SQL failed: $(basename "$f")"
                            sql_errors=$((sql_errors + 1))
                        fi
                    done
                done
                if [ "$sql_errors" -gt 0 ]; then
                    print_warning "$sql_errors SQL file(s) failed. NPCBots features may be incomplete."
                else
                    print_success "NPCBots database applied."
                fi
            else
                print_info "Compiling NPCBots from source (2-4 hours)..."
                git clone --progress --depth 1 \
                    https://github.com/trickerer/AzerothCore-wotlk-with-NPCBots.git \
                    "$SERVER_DIR"

                cat > "$SERVER_DIR/docker-compose.override.yml" << 'OVERRIDE'
services:
  ac-worldserver:
    image: dadsmmolab/npcbots-worldserver:latest
    build:
      context: .
      target: worldserver
      dockerfile: apps/docker/Dockerfile
  ac-authserver:
    image: dadsmmolab/npcbots-authserver:latest
    build:
      context: .
      target: authserver
      dockerfile: apps/docker/Dockerfile
  ac-db-import:
    image: dadsmmolab/npcbots-db-import:latest
    build:
      context: .
      target: db-import
      dockerfile: apps/docker/Dockerfile
  ac-client-data-init:
    image: dadsmmolab/npcbots-client-data:latest
    build:
      context: .
      target: client-data
      dockerfile: apps/docker/Dockerfile
OVERRIDE

                cd "$SERVER_DIR" || exit 1
                section_start "Docker build — NPCBots"
                docker compose up -d --build 2>&1 | tee "$HOME/npcbots-build.log"
                # Capture exit code NOW — section_end would clobber $PIPESTATUS.
                BUILD_RC=${PIPESTATUS[0]}
                section_end
                if [ "$BUILD_RC" -ne 0 ]; then
                    print_error "Compilation failed. See ~/npcbots-build.log"
                    exit 1
                fi
            fi
            print_success "NPCBots server installed."
            ;;

        playerbots)
            print_info "Cloning Playerbots source..."
            git clone --progress \
                https://github.com/mod-playerbots/azerothcore-wotlk.git \
                --branch=Playerbot \
                "$SERVER_DIR"
            if [ ! -d "$SERVER_DIR" ]; then
                print_error "Clone failed."
                exit 1
            fi

            print_info "Cloning mod-playerbots..."
            git clone --progress --depth 1 \
                https://github.com/mod-playerbots/mod-playerbots.git \
                --branch=master \
                "$SERVER_DIR/modules/mod-playerbots"

            write_playerbots_override fresh

            # Clone + configure user-selected modules BEFORE the build so
            # they get compiled into the same worldserver image. Free
            # optimisation — adding modules now costs nothing extra
            # versus adding them post-install (which would force a 30-90
            # min rebuild). See MODULES_PLAN.md §2.
            install_user_modules

            # Eluna (mod-ale) + dml_*.lua bridge. Must run BEFORE the
            # docker build so mod-ale gets compiled into the worldserver
            # image; the lua_scripts/ directory it creates is what the
            # lua_scripts volume mount in the override binds to.
            setup_eluna

            compile_playerbots || exit 1
            print_success "Playerbots server compiled."
            ;;
    esac
}

# ─────────────────────────────────────────
# WAIT FOR SERVER READY
# ─────────────────────────────────────────
wait_for_server() {
    print_step "Waiting for worldserver"

    print_info "First start imports the full world database into MySQL. On a"
    print_info "Steam Deck this can take 10-30+ minutes — it's normal, not stuck."
    print_info "Every start after this one is much faster (no re-import)."

    TIMEOUT=1800
    # If the worldserver container hasn't even APPEARED after 60s, the
    # user is in a docker-state corner case (containers removed, compose
    # up failed, etc.) — there's no point polling logs we'll never see.
    # Earlier versions polled the full 1800s and reported a useless
    # warning; resume runs hit this when "Stop server" had removed the
    # containers and no `up -d` brought them back.
    NO_CONTAINER_TIMEOUT=60
    ELAPSED=0
    READY=0
    WORLD_CONTAINER=""

    # Update the displayed elapsed counter every second so the UI feels
    # alive, but only re-poll docker logs every 5s (it shells out to a
    # subprocess + reads the whole worldserver log). The `printf "\r..."`
    # at the end of the line is what makes our forward_lines reader
    # treat the line as transient — the UI replaces a single in-place
    # row each tick instead of appending a new line every interval.
    while [ $ELAPSED -lt $TIMEOUT ]; do
        if [ $((ELAPSED % 5)) -eq 0 ]; then
            WORLD_CONTAINER=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -i "worldserver" | head -1)
            if [ -n "$WORLD_CONTAINER" ]; then
                if docker logs "$WORLD_CONTAINER" 2>/dev/null | grep -q "ready\.\.\."; then
                    READY=1
                    break
                fi
            fi
        fi
        # Fast-fail when no worldserver container has shown up after
        # NO_CONTAINER_TIMEOUT — don't burn 1800s polling for something
        # docker can't possibly produce.
        if [ -z "$WORLD_CONTAINER" ] && [ $ELAPSED -ge $NO_CONTAINER_TIMEOUT ]; then
            echo "" # clear the in-place counter line
            print_error "No worldserver container exists after ${NO_CONTAINER_TIMEOUT}s."
            print_info  "Looks like containers were removed (e.g. by an earlier 'Stop server')."
            print_info  "Try: cd '$SERVER_DIR' && docker compose up -d"
            print_info  "Then re-run the install or click Finish setup again."
            return 1
        fi
        printf "[..]  server initializing (%ds elapsed)\r" "$ELAPSED"
        sleep 1
        ELAPSED=$((ELAPSED + 1))
    done

    if [ $READY -eq 1 ]; then
        print_success "Worldserver ready."
    else
        print_warning "Worldserver did not report ready within ${TIMEOUT}s."
        print_info  "Check: docker logs -f $WORLD_CONTAINER"
    fi
}

# ─────────────────────────────────────────
# BOOTSTRAP ACCOUNTS + AHBOT (post-server-ready)
# ─────────────────────────────────────────
# Pattern locked in 2026-05-18: at install time, all GM account
# bootstrap goes through direct SRP6 + SQL writes. Per-request GM
# operations during the app's runtime will go through SOAP (port 7878)
# using the admin account we create here. See the dev log for the full
# decision rationale (originally evaluated pty-based command piping and
# rejected as timing-fragile).
#
# Inputs:
#   DML_ADMIN_USER, DML_ADMIN_PASS — from onboarding wizard. Default to
#       "admin"/"admin" if not set so a fresh install always has a
#       known account the user can log into WoW with.
#
# What this function does:
#   1. Computes SRP6 salt+verifier for the user-chosen admin credentials
#      via embedded Python (algorithm verified against AC source).
#   2. SQL INSERTs the admin account into acore_auth.account with
#      gmlevel 3 in account_access.
#   3. Generates a random password for an internal AHBOT account, creates
#      it the same way.
#   4. SQL INSERTs one minimal character row on the AHBOT account —
#      mod-ah-bot-plus needs a real character GUID to impersonate as
#      the seller (see modules/mod-ah-bot-plus/src/).
#   5. Rewrites mod_ahbot.conf with the new character GUID
#      (AuctionHouseBot.GUIDs) and EnableSeller=true — the bot becomes
#      active on next worldserver restart.
#   6. Soft-restarts the worldserver so the conf change takes effect.

# Helper: docker exec into ac-database and run a SQL statement.
# The `-N -B` flags give tab-separated output without column headers,
# easier to parse from shell. The `2>/dev/null` suppresses MySQL's
# "Using a password on the command line interface can be insecure"
# warning that goes to stderr on every call.
sql_exec() {
    local query="$1"
    docker exec -i ac-database mysql -uroot -ppassword -N -B -e "$query" 2>/dev/null
}

# Compute SRP6 salt+verifier for (username, password). Prints two
# uppercase hex strings, space-separated. Mirrors AC's
# SRP6::MakeRegistrationData (src/common/Cryptography/Authentication/SRP6.cpp).
# Verified against accounts created via AC's own `account create`.
#
# `env -u PYTHONHOME -u PYTHONPATH -u PYTHONSTARTUP -u PYTHONNOUSERSITE`
# strips the env vars that pyenv / conda / Homebrew commonly set —
# users with one of those on PATH would otherwise see python3 launch
# but fail to import its own stdlib ("No module named 'encodings'"),
# blocking the entire admin-account bootstrap. The system python3 on
# SteamOS / Arch / Ubuntu always works with a clean env.
srp6_compute() {
    local user="$1" pass="$2"
    env -u PYTHONHOME -u PYTHONPATH -u PYTHONSTARTUP -u PYTHONNOUSERSITE \
        python3 - "$user" "$pass" <<'PYEOF'
import hashlib, secrets, sys
# Canonical WoW SRP6 modulus. AC stores it as 32 bytes via
# HexStrToByteArray(..., reverse=true) then BigNumber(bytes, littleEndian=true)
# — those two flips cancel out, so N's numeric value equals int(literal_hex, 16).
N = int("894B645E89E1535BBDAD5B8B290650530801B18EBFBF5E8FAB3C82872A3E9BB7", 16)
G = 7
# AC's AccountMgr::CreateAccount calls Utf8ToUpperOnlyLatin(username)
# and (password) before passing to SRP6. We do the same here so the
# inner SHA1 input matches whatever AC would have used.
user = sys.argv[1].upper()
pw = sys.argv[2].upper()
salt = secrets.token_bytes(32)
inner = hashlib.sha1(f"{user}:{pw}".encode()).digest()
outer = hashlib.sha1(salt + inner).digest()
x = int.from_bytes(outer, "little")  # AC BigNumber default is littleEndian
v = pow(G, x, N).to_bytes(32, "little")  # ToByteArray<32>() with default LE
print(f"{salt.hex().upper()} {v.hex().upper()}")
PYEOF
}

# Insert an account into acore_auth.account via SRP6+SQL. Returns the
# account's id on stdout. Idempotent: if an account with the given
# username already exists (e.g. resume-after-crash), returns its
# existing id instead of erroring on the duplicate-key insert.
create_account_via_srp6() {
    local user="$1" pass="$2"
    # AC stores usernames uppercased; do the same so case-insensitive
    # logins from the WoW client work AND so our existence check uses
    # the canonical form.
    local upper_user
    upper_user=$(echo "$user" | tr '[:lower:]' '[:upper:]')

    # If the account already exists, return its id and skip the insert.
    # This is what makes the bootstrap step safe to re-run.
    local existing_id
    existing_id=$(sql_exec "SELECT id FROM acore_auth.account WHERE username='${upper_user}' LIMIT 1;")
    if [ -n "$existing_id" ]; then
        echo "$existing_id"
        return 0
    fi

    local salt_hex verifier_hex
    read -r salt_hex verifier_hex < <(srp6_compute "$upper_user" "$pass")
    if [ -z "$salt_hex" ] || [ -z "$verifier_hex" ]; then
        print_error "SRP6 hash computation failed for $upper_user"
        return 1
    fi

    sql_exec "INSERT INTO acore_auth.account (username, salt, verifier, expansion) \
              VALUES ('${upper_user}', UNHEX('${salt_hex}'), UNHEX('${verifier_hex}'), 2);" \
        || { print_error "Failed to insert account $upper_user"; return 1; }

    local id
    id=$(sql_exec "SELECT id FROM acore_auth.account WHERE username='${upper_user}' LIMIT 1;")
    if [ -z "$id" ]; then
        print_error "Account $upper_user inserted but couldn't read back its id"
        return 1
    fi
    echo "$id"
}

bootstrap_accounts_and_ahbot() {
    print_step "Creating admin + Auction House Bot accounts"

    # ── Admin account ─────────────────────────────────────────────
    local admin_user="${DML_ADMIN_USER:-admin}"
    local admin_pass="${DML_ADMIN_PASS:-admin}"
    local admin_id
    admin_id=$(create_account_via_srp6 "$admin_user" "$admin_pass") || return 1
    # GM level 3 with RealmID=-1 = god-mode on every realm. Use
    # INSERT ... ON DUPLICATE KEY UPDATE so a resume after a partial
    # bootstrap doesn't error out on the (id, RealmID) primary key.
    sql_exec "INSERT INTO acore_auth.account_access (id, gmlevel, RealmID) \
              VALUES (${admin_id}, 3, -1) \
              ON DUPLICATE KEY UPDATE gmlevel=VALUES(gmlevel);" \
        || { print_warning "Couldn't grant GM level to ${admin_user}"; }
    print_success "Admin account ready: ${admin_user} (GM level 3, id ${admin_id})"

    # ── AHBOT account (player-level, used only as AH Bot seller) ──
    # Random password — the user never logs into this account.
    local ahbot_pass
    ahbot_pass=$(head -c 16 /dev/urandom | base64 | tr -d '/+=' | head -c 16)
    local ahbot_id
    ahbot_id=$(create_account_via_srp6 "AHBOT" "$ahbot_pass") || return 1
    print_success "AH Bot account ready: AHBOT (id ${ahbot_id})"

    # ── AHBOT character ───────────────────────────────────────────
    # AHB queries `SELECT guid FROM characters WHERE account = ?`
    # at startup and needs at least one row. Only three columns lack
    # defaults: name, taximask, innTriggerId. `guid` is int-unsigned-not-
    # autoincrement, so we look up MAX(guid)+1 ourselves (Playerbots
    # already populated 1..700 in our test installs).
    #
    # Idempotency: if AHBOT account already has at least one character
    # (resume after partial bootstrap), use the existing one instead of
    # creating a second AHBotSeller. AHB with GUID=0 uses ALL chars on
    # the account anyway, so an extra seller would just confuse later
    # reconfigure flows.
    local existing_guid
    existing_guid=$(sql_exec "SELECT guid FROM acore_characters.characters WHERE account=${ahbot_id} ORDER BY guid LIMIT 1;")
    local seller_guid
    if [ -n "$existing_guid" ]; then
        seller_guid="$existing_guid"
        print_success "AH Bot character already exists: guid ${seller_guid}"
    else
        local next_guid
        next_guid=$(sql_exec "SELECT COALESCE(MAX(guid),0)+1 FROM acore_characters.characters;")
        if [ -z "$next_guid" ] || ! [[ "$next_guid" =~ ^[0-9]+$ ]]; then
            print_error "Couldn't compute next character GUID (got: '$next_guid')"
            return 1
        fi
        # Name MUST be in AC's normalized form (first-letter capitalized,
        # rest lowercase) because AC's command parser normalizes target
        # names before SQL lookup. Mixed-case "AHBotSeller" caused
        # `.send items` and `.tele name` to report "Character does not
        # exist" even though the row was present. Use "Ahbotseller".
        sql_exec "INSERT INTO acore_characters.characters \
                  (guid, account, name, race, class, gender, level, taximask, innTriggerId) \
                  VALUES (${next_guid}, ${ahbot_id}, 'Ahbotseller', 1, 1, 0, 1, \
                          '0 0 0 0 0 0 0 0 0 0 0 0 0 0 ', 0);" \
            || { print_warning "Couldn't create AH Bot character"; return 1; }
        seller_guid="$next_guid"
        print_success "Created AH Bot character: Ahbotseller (guid ${seller_guid}) on account ${ahbot_id}"
    fi

    # ── Rewrite mod_ahbot.conf with the new bot character GUID ────
    # mod-ah-bot-plus only needs the character GUID — there's no
    # Account field anymore. The bot impersonates whatever GUIDs are
    # listed; account ownership is implicit. Booleans are lowercase
    # "true"/"false" in the plus schema.
    local conf="$SERVER_DIR/env/dist/etc/modules/mod_ahbot.conf"
    if [ ! -f "$conf" ]; then
        print_warning "mod_ahbot.conf not found at $conf — AH Bot won't activate until reconfigured"
        return 0
    fi
    sed -i -E \
        -e "s|^AuctionHouseBot\.GUIDs[[:space:]]*=.*|AuctionHouseBot.GUIDs = ${seller_guid}|" \
        -e "s|^AuctionHouseBot\.EnableSeller[[:space:]]*=.*|AuctionHouseBot.EnableSeller = true|" \
        "$conf"
    print_success "Configured mod_ahbot.conf (GUIDs=${seller_guid}, EnableSeller=true)"

    # ── Restart worldserver so AHB picks up the new conf ──────────
    print_info "Restarting worldserver to activate AH Bot..."
    (cd "$SERVER_DIR" && docker compose restart ac-worldserver) > /dev/null 2>&1 \
        || print_warning "Worldserver restart had non-zero exit; AHB will activate on next manual start"
    print_success "Worldserver restarted"
}

# ─────────────────────────────────────────
# RECORD INSTALL METADATA
# ─────────────────────────────────────────
write_metadata() {
    print_step "Writing install metadata"
    local meta_dir="$SERVER_DIR/.dads-mmo-lab"
    mkdir -p "$meta_dir"
    cat > "$meta_dir/install.json" << META
{
  "version": "${WIZARD_VERSION}",
  "server_type": "${SERVER_TYPE}",
  "server_name": "${SERVER_NAME}",
  "build_method": "${BUILD_METHOD}",
  "admin_user": "${DML_ADMIN_USER:-admin}",
  "installed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
META
    print_success "Wrote $meta_dir/install.json"
}

# ─────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────
print_header
print_info "Target:       $SERVER_NAME"
print_info "Install dir:  $SERVER_DIR"
[ -n "$BUILD_METHOD" ] && print_info "Build method: $BUILD_METHOD"
print_info "Admin user:   ${DML_ADMIN_USER:-admin}"

# RESUME mode (DML_RESUME=1): an earlier install run made it past the
# clone + compile but crashed before bootstrap could finish (e.g.
# Hyprland crashed during wait_for_server). Skip the expensive
# clone/compile work — the containers + modules are already on disk —
# and just finish the post-server-ready setup.
#
# Detection of the partial state happens UI-side: the dashboard shows a
# "Finish setup" banner when install.json is missing, and clicking it
# spawns this script with DML_RESUME=1.
if [ "${DML_MIGRATE:-0}" = "1" ]; then
    # MIGRATE mode (DML_MIGRATE=1): adopt a working but hand-built server
    # and bring it up to Lab parity (SOAP + Eluna + AHBot + marker) without
    # wiping anything. Has its own internal wait/bootstrap/metadata steps and
    # exits non-zero on failure, so just hand off to it.
    migrate_existing_install
elif [ "${DML_RESUME:-0}" = "1" ]; then
    print_info "Resume mode — skipping clone/compile, completing post-install setup..."

    # Bring the stack up before waiting. Resume gets entered when an
    # earlier install crashed AFTER the docker images existed but BEFORE
    # bootstrap finished; in between the user may have run "Stop server"
    # (which is `docker compose down`, removing containers — only the
    # data volumes survive). Without an explicit `up -d` here,
    # wait_for_server polls for a worldserver container that no longer
    # exists and times out at 1800s for nothing. `up -d` is idempotent:
    # already-running containers stay as-is; missing ones get recreated
    # from the existing docker-compose.yml against the persisted volumes.
    if [ -d "$SERVER_DIR" ]; then
        print_info "Ensuring containers are up before waiting..."
        (cd "$SERVER_DIR" && docker compose up -d) > /dev/null 2>&1 \
            || print_warning "docker compose up returned non-zero — wait_for_server will report what's wrong."
    fi

    if ! wait_for_server; then
        # Fail-fast happens when containers aren't even up after 60s —
        # no point trying bootstrap when we have nothing to bootstrap
        # against. Exit non-zero so the app marks the install incomplete
        # and the user re-attempts after fixing the docker state.
        exit 1
    fi
    if ! bootstrap_accounts_and_ahbot; then
        print_error "Bootstrap failed — admin and/or AH Bot accounts were not created."
        print_info  "install.json is NOT being written so the app will detect this as incomplete and re-offer the Finish-setup flow."
        exit 1
    fi
    write_metadata
else
    check_system
    install_server
    # A successful build+up always leaves a worldserver container. If none
    # exists, the image build silently failed (most often BuildKit/
    # docker-buildx missing) — abort now instead of waiting out the timeout
    # and then falsely writing install.json as if the server were ready.
    if ! docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qi worldserver; then
        print_error "Install produced no worldserver container — the Docker image build failed."
        print_info  "Most common cause: Docker BuildKit unavailable. Make sure 'docker-buildx' is installed, then retry. See ~/playerbots-build.log or ~/npcbots-build.log."
        exit 1
    fi
    wait_for_server
    # Same gating as the resume branch — write_metadata MUST NOT run if
    # bootstrap failed. Earlier versions ran them unconditionally, so a
    # mid-bootstrap crash (e.g. python3 + hostile PYTHONHOME) still
    # produced install.json and the app mistook a half-broken install
    # for a complete one. Re-run with DML_RESUME=1 after fixing the
    # underlying issue.
    if ! bootstrap_accounts_and_ahbot; then
        print_error "Bootstrap failed — admin and/or AH Bot accounts were not created."
        print_info  "install.json is NOT being written so the app will detect this as incomplete and re-offer the Finish-setup flow."
        exit 1
    fi
    write_metadata
fi

echo ""
echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  Install complete.${NC}"
echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════${NC}"
echo ""
print_info "Admin account: ${DML_ADMIN_USER:-admin} / ${DML_ADMIN_PASS:-admin}"
print_info "Auction House Bot is active and will start listing items shortly."
echo ""
# Note: realmlist.wtf is patched in-app when the user picks their client
# directory from the dashboard, so we no longer print the manual step
# here. The bundled HOWTO docs still describe it for non-Lab workflows.
exit 0

#!/bin/bash
# ============================================================
#  Dad's MMO Lab — Fix Docker After SteamOS Update (UI companion)
#  https://github.com/DadsMmoLab/dads-mmo-lab
#
#  Non-interactive variant of fix-after-update.sh, launched by The Lab
#  via `pkexec bash fix-after-update-ui.sh <user-home>` — so it runs as
#  ROOT (no `sudo` needed) and never calls `read`/`clear`. The keyring
#  reset is auto-confirmed: The Lab shows the user the warning and gets
#  consent before launching this.
#
#  It emits ::DML::SECTION::START::<title>:: / ::DML::SECTION::END::
#  sentinels around the noisy ranges (keyring, docker reinstall, server
#  refresh) so the Tauri console folds them into collapsible groups.
#
#  $1 — the invoking user's $HOME (pkexec wipes the env, so $HOME here
#       would be /root). Used only for the compose-dir fallback scan.
#
#  Usage (standalone, already root):  bash fix-after-update-ui.sh /home/deck
# ============================================================

set -o pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m'

USER_HOME="${1:-$HOME}"

# The Tauri console strips ANSI colour but renders emoji. We only use
# emoji-default codepoints (Emoji_Presentation=Yes) so they reliably draw
# in colour from the system emoji font — unlike ℹ️/⚠️, which are text
# symbols + a variation selector and fell back to a tiny monochrome glyph
# (the "i" / outline triangle) in the WebKit monospace font.
print_success() { echo -e "${GREEN}✅ $1${NC}"; }
print_error()   { echo -e "${RED}❌ $1${NC}"; }
print_info()    { echo -e "${BLUE}💡 $1${NC}"; }
print_warning() { echo -e "${YELLOW}🚨 $1${NC}"; }

# Sentinels parsed by Tauri's forward_lines into collapsible sections.
section_start() { echo "::DML::SECTION::START::$1::"; }
section_end()   { echo "::DML::SECTION::END::"; }

# Returns 0 only when `docker` is REAL Docker (not the podman-docker shim)
# AND `docker compose` works — the AzerothCore stack needs compose v2.
is_real_docker() {
    docker compose version &>/dev/null \
        && ! docker --version 2>&1 | grep -qi podman
}
has_podman_docker_shim() {
    pacman -Qi podman-docker &>/dev/null
}

echo -e "${CYAN}Fix Docker After SteamOS Update${NC}"
echo -e "${YELLOW}SteamOS updates can wipe Docker and break the pacman keyring. Repairing both…${NC}"
echo ""

# ─────────────────────────────────────────
# STEP 1 — Disable read-only filesystem
# ─────────────────────────────────────────
print_info "Disabling SteamOS read-only filesystem..."
steamos-readonly disable && print_success "Read-only disabled" \
    || print_warning "Couldn't disable read-only (continuing)"

# ─────────────────────────────────────────
# STEP 2 — Rebuild pacman keyring (auto-confirmed by the app)
# ─────────────────────────────────────────
section_start "Rebuilding pacman keyring"
print_info "Rebuilding pacman keyring..."
rm -rf /etc/pacman.d/gnupg
pacman-key --init
pacman-key --populate archlinux
pacman-key --populate holo
section_end
print_success "Keyring rebuilt"

# ─────────────────────────────────────────
# STEP 3 — Enable SteamOS dev mode (auto-confirm the prompt)
# ─────────────────────────────────────────
if command -v steamos-devmode &>/dev/null; then
    print_info "Enabling SteamOS developer mode..."
    yes y | steamos-devmode enable 2>&1 | tail -5 \
        || print_warning "steamos-devmode enable returned non-zero — continuing anyway"
    print_success "Dev mode step finished"
fi

# ─────────────────────────────────────────
# STEP 4 — Remove podman-docker shim if present
# ─────────────────────────────────────────
if has_podman_docker_shim; then
    print_warning "Detected podman-docker shim — removing it before installing real Docker"
    if ! pacman -Rdd --noconfirm podman-docker; then
        print_warning "Couldn't remove podman-docker cleanly — will try --overwrite during install"
    else
        print_success "podman-docker shim removed"
    fi
fi

# ─────────────────────────────────────────
# STEP 5 — Reinstall Docker
# ─────────────────────────────────────────
section_start "Reinstalling Docker"
print_info "Updating keyring package..."
if ! pacman -Sy --noconfirm archlinux-keyring; then
    print_warning "archlinux-keyring update failed — Docker install may fail."
fi

print_info "Reinstalling Docker..."
if ! pacman -Sy --noconfirm --overwrite '/usr/bin/docker' docker docker-compose; then
    section_end
    print_error "Failed to reinstall Docker. Check your internet connection."
    exit 1
fi
section_end
print_success "Docker reinstalled"

# ─────────────────────────────────────────
# STEP 6 — Restart Docker service
# ─────────────────────────────────────────
print_info "Starting Docker service..."
systemctl daemon-reload
systemctl enable docker
systemctl start docker
sleep 3

# ─────────────────────────────────────────
# STEP 7 — Verify
# ─────────────────────────────────────────
if is_real_docker; then
    print_success "DOCKER IS WORKING AGAIN!"

    # ─────────────────────────────────────────
    # STEP 8 — Refresh wotlk server Docker networks
    # Reinstalling Docker wipes iptables/bridge state; containers
    # auto-restart against a broken network so authserver can't reach
    # ac-database. Recreating the network fixes it. Named DB volume is
    # preserved — characters are safe.
    # ─────────────────────────────────────────
    section_start "Refreshing your server"
    WOW_CONTAINERS=$(docker ps -a --format '{{.Names}}' 2>/dev/null | \
        grep -iE "ac[-_](authserver|worldserver|database)")

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

    # Fallback: scan the user's home (passed as $1 — $HOME here is /root).
    if [ ${#COMPOSE_DIRS[@]} -eq 0 ] && [ -d "$USER_HOME" ]; then
        while IFS= read -r f; do
            COMPOSE_DIRS+=("$(dirname "$f")")
        done < <(find "$USER_HOME" -maxdepth 3 -name "docker-compose.yml" 2>/dev/null \
            | xargs grep -l -iE "azerothcore|acore-docker" 2>/dev/null)
    fi

    if [ ${#COMPOSE_DIRS[@]} -gt 0 ]; then
        print_info "Refreshing ${#COMPOSE_DIRS[@]} server(s) (preserves your characters)..."
        for dir in "${COMPOSE_DIRS[@]}"; do
            (cd "$dir" && docker compose down >/dev/null 2>&1) || true
        done
        docker network prune -f >/dev/null 2>&1
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
        section_end
        if [ ${#FAILED[@]} -eq 0 ]; then
            print_success "All servers refreshed — log in and play!"
        else
            print_warning "Some servers couldn't auto-restart. Start them from The Lab's dashboard."
        fi
    else
        section_end
        print_info "No server detected — Docker is fixed and ready."
    fi
else
    print_error "Docker isn't usable yet."
    if docker --version 2>&1 | grep -qi podman; then
        print_warning "/usr/bin/docker is still the podman shim (not real Docker)."
    elif ! command -v docker &>/dev/null; then
        print_warning "\`docker\` command not found — the pacman install probably failed."
    elif ! docker compose version &>/dev/null; then
        print_warning "\`docker compose\` plugin missing — only the docker CLI installed."
    else
        print_warning "Docker daemon isn't responding. Try rebooting and running the fix again."
    fi
    exit 1
fi

echo ""
print_success "Done."

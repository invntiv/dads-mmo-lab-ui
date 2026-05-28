#!/bin/bash
# ============================================================
#  Dad's MMO Lab — Docker Diagnostic
#  https://github.com/DadsMmoLab/dads-mmo-lab
#
#  Read-only check: tells you if Docker is real, if compose works,
#  and if the SteamOS podman-docker shim is hiding the truth.
#  Run this BEFORE fix-after-update.sh to see what's actually broken,
#  or AFTER to confirm the fix worked.
#
#  Usage: chmod +x check-docker.sh && ./check-docker.sh
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
echo -e "${CYAN}║${WHITE}${BOLD}         🔧  DAD'S MMO LAB                        ${NC}${CYAN}║${NC}"
echo -e "${CYAN}║${WHITE}            Docker Diagnostic                     ${NC}${CYAN}║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}Read-only — this script changes NOTHING on your system.${NC}"
echo ""

# ─────────────────────────────────────────
# Collect facts (no side effects)
# ─────────────────────────────────────────
DOCKER_PATH=""
DOCKER_REAL_PATH=""
DOCKER_VERSION_OUT=""
DOCKER_COMPOSE_OUT=""
DOCKER_PS_OK=0
SHIM_INSTALLED=0
DOCKER_PKG_INSTALLED=0
DOCKER_SERVICE_STATE="unknown"

# `command -v` returns shell builtins too, so prefer `which` to get a path.
if command -v docker &>/dev/null; then
    DOCKER_PATH=$(command -v docker)
    # readlink -f resolves the full symlink chain — surfaces the podman
    # shim, which is itself just a symlink/wrapper to /usr/bin/podman on
    # most distros.
    DOCKER_REAL_PATH=$(readlink -f "$DOCKER_PATH" 2>/dev/null || echo "$DOCKER_PATH")
    DOCKER_VERSION_OUT=$(docker --version 2>&1)
    DOCKER_COMPOSE_OUT=$(docker compose version 2>&1)
    docker ps &>/dev/null 2>&1 && DOCKER_PS_OK=1
fi

if command -v pacman &>/dev/null; then
    pacman -Qi podman-docker &>/dev/null && SHIM_INSTALLED=1
    pacman -Qi docker &>/dev/null && DOCKER_PKG_INSTALLED=1
fi

if command -v systemctl &>/dev/null; then
    DOCKER_SERVICE_STATE=$(systemctl is-active docker 2>/dev/null || echo "inactive")
fi

# Helper: does the version output identify itself as podman?
docker_says_podman() {
    [ -n "$DOCKER_VERSION_OUT" ] && echo "$DOCKER_VERSION_OUT" | grep -qi podman
}

# Helper: does `docker compose` work?
compose_works() {
    [ -n "$DOCKER_COMPOSE_OUT" ] && echo "$DOCKER_COMPOSE_OUT" | grep -qiE "Docker Compose version|^v?[0-9]"
}

# ─────────────────────────────────────────
# Per-fact lines
# ─────────────────────────────────────────
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${WHITE}${BOLD}  Facts${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# docker binary
if [ -z "$DOCKER_PATH" ]; then
    print_error "\`docker\` command: NOT FOUND"
else
    echo -e "${WHITE}  \`docker\` lives at: ${CYAN}${DOCKER_PATH}${NC}"
    [ "$DOCKER_PATH" != "$DOCKER_REAL_PATH" ] && \
        echo -e "${WHITE}  ...resolves to:    ${CYAN}${DOCKER_REAL_PATH}${NC}"
    echo -e "${WHITE}  \`docker --version\` says:${NC}"
    echo -e "    ${CYAN}${DOCKER_VERSION_OUT}${NC}"
fi
echo ""

# compose
if [ -n "$DOCKER_PATH" ]; then
    if compose_works; then
        echo -e "${WHITE}  \`docker compose version\` works:${NC}"
        echo -e "    ${CYAN}$(echo "$DOCKER_COMPOSE_OUT" | head -1)${NC}"
    else
        print_error "\`docker compose\` plugin: NOT WORKING"
        echo -e "    ${YELLOW}Output: ${DOCKER_COMPOSE_OUT}${NC}"
    fi
fi
echo ""

# daemon reachable
if [ -n "$DOCKER_PATH" ]; then
    if [ "$DOCKER_PS_OK" = "1" ]; then
        echo -e "${WHITE}  \`docker ps\` (daemon reachable): ${GREEN}YES${NC}"
    else
        echo -e "${WHITE}  \`docker ps\` (daemon reachable): ${RED}NO${NC}"
        if [ "$DOCKER_SERVICE_STATE" != "active" ] && [ "$DOCKER_SERVICE_STATE" != "unknown" ]; then
            echo -e "    ${YELLOW}docker.service state: ${DOCKER_SERVICE_STATE}${NC}"
        fi
    fi
fi
echo ""

# packages
if command -v pacman &>/dev/null; then
    echo -e "${WHITE}  Packages:${NC}"
    [ "$DOCKER_PKG_INSTALLED" = "1" ] \
        && echo -e "    ${GREEN}✓${NC} docker (real)" \
        || echo -e "    ${RED}✗${NC} docker (real)"
    [ "$SHIM_INSTALLED" = "1" ] \
        && echo -e "    ${YELLOW}⚠${NC} podman-docker (the shim — bad)" \
        || echo -e "    ${GREEN}✓${NC} podman-docker not installed"
fi

# ─────────────────────────────────────────
# Verdict
# ─────────────────────────────────────────
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${WHITE}${BOLD}  Verdict${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

VERDICT="UNKNOWN"
if [ -z "$DOCKER_PATH" ]; then
    VERDICT="DOCKER_MISSING"
elif docker_says_podman; then
    VERDICT="SHIM_PRESENT"
elif ! compose_works; then
    VERDICT="COMPOSE_MISSING"
elif [ "$DOCKER_PS_OK" != "1" ]; then
    VERDICT="DAEMON_DOWN"
else
    VERDICT="WORKING"
fi

case "$VERDICT" in
    WORKING)
        echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════╗${NC}"
        echo -e "${GREEN}${BOLD}║   ✅ DOCKER IS HEALTHY                            ║${NC}"
        echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════╝${NC}"
        echo ""
        echo -e "${WHITE}Real Docker, compose plugin works, daemon is reachable.${NC}"
        echo -e "${WHITE}You're good to start a server.${NC}"
        ;;
    SHIM_PRESENT)
        echo -e "${RED}${BOLD}╔══════════════════════════════════════════════════╗${NC}"
        echo -e "${RED}${BOLD}║   ❌ PODMAN-DOCKER SHIM IS IN CHARGE              ║${NC}"
        echo -e "${RED}${BOLD}╚══════════════════════════════════════════════════╝${NC}"
        echo ""
        echo -e "${WHITE}\`docker\` on your system is actually podman wearing a${NC}"
        echo -e "${WHITE}docker mask. Many commands work, but \`docker compose\`${NC}"
        echo -e "${WHITE}— which the WoW server needs — does NOT.${NC}"
        echo ""
        echo -e "${WHITE}${BOLD}Fix:${NC} run ${CYAN}./fix-after-update.sh${NC} — it removes the shim and${NC}"
        echo -e "${WHITE}installs real Docker."
        ;;
    COMPOSE_MISSING)
        echo -e "${RED}${BOLD}╔══════════════════════════════════════════════════╗${NC}"
        echo -e "${RED}${BOLD}║   ❌ DOCKER COMPOSE NOT AVAILABLE                 ║${NC}"
        echo -e "${RED}${BOLD}╚══════════════════════════════════════════════════╝${NC}"
        echo ""
        echo -e "${WHITE}Docker itself looks OK but the compose plugin is missing.${NC}"
        echo -e "${WHITE}${BOLD}Fix:${NC} ${CYAN}sudo pacman -S docker-compose${NC}"
        ;;
    DAEMON_DOWN)
        echo -e "${YELLOW}${BOLD}╔══════════════════════════════════════════════════╗${NC}"
        echo -e "${YELLOW}${BOLD}║   ⚠️  DOCKER DAEMON ISN'T RUNNING                 ║${NC}"
        echo -e "${YELLOW}${BOLD}╚══════════════════════════════════════════════════╝${NC}"
        echo ""
        echo -e "${WHITE}Real Docker is installed but the service isn't responding.${NC}"
        echo -e "${WHITE}${BOLD}Fix:${NC} ${CYAN}sudo systemctl enable --now docker${NC}"
        echo -e "${WHITE}If that fails, run ${CYAN}./fix-after-update.sh${NC}."
        ;;
    DOCKER_MISSING)
        echo -e "${RED}${BOLD}╔══════════════════════════════════════════════════╗${NC}"
        echo -e "${RED}${BOLD}║   ❌ DOCKER NOT INSTALLED                         ║${NC}"
        echo -e "${RED}${BOLD}╚══════════════════════════════════════════════════╝${NC}"
        echo ""
        echo -e "${WHITE}No \`docker\` command found at all.${NC}"
        echo -e "${WHITE}${BOLD}Fix:${NC} run ${CYAN}./fix-after-update.sh${NC} to install everything fresh."
        ;;
esac

echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${WHITE}  📺 youtube.com/@DadsMmoLab${NC}"
echo -e "${WHITE}  📦 github.com/DadsMmoLab/dads-mmo-lab${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Exit code: 0 if WORKING, 1 otherwise. Lets the UI shell-out distinguish
# success from any of the failure cases without parsing stdout.
[ "$VERDICT" = "WORKING" ] && exit 0 || exit 1

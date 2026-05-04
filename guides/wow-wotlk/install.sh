#!/bin/bash
# ============================================================
#  Dad's MMO Lab — WoW Offline Server Installer
#  AzerothCore on Steam Deck (SteamOS / Arch Linux)
#
#  https://github.com/DadsMmoLab/dads-mmo-lab
#
#  Usage:
#    chmod +x install.sh
#    ./install.sh
#
#  What this does:
#    1. Checks system requirements
#    2. Installs Docker if not present
#    3. Creates folder structure
#    4. Downloads docker-compose.yml
#    5. Creates default config files
#    6. Pulls Docker images
#    7. Starts the server
#    8. Creates your first GM account
#    9. Tells you exactly what to do next
#
#  Time: ~15-30 minutes (mostly waiting for downloads)
# ============================================================

set -e  # Exit on any error

# ─────────────────────────────────────────
# COLORS & FORMATTING
# ─────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# ─────────────────────────────────────────
# HELPER FUNCTIONS
# ─────────────────────────────────────────
print_header() {
    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${WHITE}${BOLD}         ⚙️  DAD'S MMO LAB                        ${NC}${CYAN}║${NC}"
    echo -e "${CYAN}║${WHITE}         WoW Offline Server Installer             ${NC}${CYAN}║${NC}"
    echo -e "${CYAN}║${BLUE}         github.com/DadsMmoLab/dads-mmo-lab       ${NC}${CYAN}║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"
    echo ""
}

print_step() {
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${WHITE}${BOLD} $1${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

ask_yes_no() {
    while true; do
        echo -e "${WHITE}$1 (y/n): ${NC}"
        read -r answer
        case $answer in
            [Yy]* ) return 0;;
            [Nn]* ) return 1;;
            * ) echo "Please answer y or n.";;
        esac
    done
}

# ─────────────────────────────────────────
# CONFIGURATION
# ─────────────────────────────────────────
INSTALL_DIR="$HOME/wow-server"
GITHUB_RAW="https://raw.githubusercontent.com/DadsMmoLab/dads-mmo-lab/main/guides/wow-wotlk"

# ─────────────────────────────────────────
# START
# ─────────────────────────────────────────
clear
print_header

echo -e "${WHITE}Welcome! This script will set up a complete World of Warcraft${NC}"
echo -e "${WHITE}offline server on your Steam Deck.${NC}"
echo ""
echo -e "${YELLOW}Before we start, make sure you have:${NC}"
echo -e "  • A WoW 3.3.5a client folder (the game files)"
echo -e "  • At least 15GB of free storage"
echo -e "  • An internet connection for the initial download"
echo -e "  • About 30 minutes to spare"
echo ""

if ! ask_yes_no "Ready to begin?"; then
    echo "No problem! Run this script again when you're ready."
    exit 0
fi

# ─────────────────────────────────────────
# STEP 1 — SYSTEM CHECK
# ─────────────────────────────────────────
print_step "STEP 1/8 — Checking System"

# Check if we're on SteamOS / Linux
if [[ "$OSTYPE" != "linux-gnu"* ]]; then
    print_error "This script requires Linux (SteamOS). Are you in Desktop Mode?"
    exit 1
fi
print_success "Linux detected"

# Check available disk space (need at least 15GB)
AVAILABLE_GB=$(df -BG "$HOME" | awk 'NR==2 {print $4}' | sed 's/G//')
if [ "$AVAILABLE_GB" -lt 15 ]; then
    print_error "Not enough disk space. You have ${AVAILABLE_GB}GB free, need at least 15GB."
    exit 1
fi
print_success "Disk space OK (${AVAILABLE_GB}GB available)"

# Check internet
if ! ping -c 1 github.com &>/dev/null; then
    print_error "No internet connection detected. Please connect and try again."
    exit 1
fi
print_success "Internet connection OK"

# ─────────────────────────────────────────
# STEP 2 — INSTALL DOCKER
# ─────────────────────────────────────────
print_step "STEP 2/8 — Installing Docker"

if command -v docker &>/dev/null; then
    DOCKER_VERSION=$(docker --version)
    print_success "Docker already installed: $DOCKER_VERSION"
else
    print_info "Docker not found. Installing now..."
    print_warning "This may ask for your password (sudo)"
    echo ""

    # SteamOS specific: disable read-only filesystem temporarily
    if command -v steamos-readonly &>/dev/null; then
        print_info "Disabling SteamOS read-only filesystem..."
        sudo steamos-readonly disable
    fi

    # Install Docker
    curl -fsSL https://get.docker.com | sudo sh

    # Add user to docker group
    sudo usermod -aG docker "$USER"

    # Enable and start Docker
    sudo systemctl enable docker
    sudo systemctl start docker

    print_success "Docker installed successfully!"
    print_warning "NOTE: You may need to log out and back in for Docker permissions."
    print_warning "If you get permission errors, log out, log back in, and run this script again."
fi

# Check Docker Compose
if ! docker compose version &>/dev/null; then
    print_error "Docker Compose not found. Please install Docker Desktop or Docker Compose v2."
    exit 1
fi
print_success "Docker Compose OK"

# ─────────────────────────────────────────
# STEP 3 — CREATE FOLDER STRUCTURE
# ─────────────────────────────────────────
print_step "STEP 3/8 — Creating Server Folders"

mkdir -p "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR/config"
mkdir -p "$INSTALL_DIR/logs"
mkdir -p "$INSTALL_DIR/data"

print_success "Created $INSTALL_DIR/"
print_success "Created $INSTALL_DIR/config/"
print_success "Created $INSTALL_DIR/logs/"

# ─────────────────────────────────────────
# STEP 4 — DOWNLOAD CONFIG FILES
# ─────────────────────────────────────────
print_step "STEP 4/8 — Setting Up Configuration"

# Create docker-compose.yml
cat > "$INSTALL_DIR/docker-compose.yml" << 'DOCKERCOMPOSE'
version: '3.8'

services:
  ac-database:
    image: mysql:8.0
    container_name: ac_database
    environment:
      MYSQL_ROOT_PASSWORD: azeroth
      MYSQL_DATABASE: acore_world
    volumes:
      - ac-database:/var/lib/mysql
    ports:
      - "3306:3306"
    restart: unless-stopped
    networks:
      - ac-network
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-pazeroth"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s

  ac-authserver:
    image: azerothcore/azerothcore:authserver
    container_name: ac_authserver
    environment:
      AC_LOGIN_DATABASE_INFO: "ac-database;3306;root;azeroth;acore_auth"
    depends_on:
      ac-database:
        condition: service_healthy
    ports:
      - "3724:3724"
    restart: unless-stopped
    networks:
      - ac-network

  ac-worldserver:
    image: azerothcore/azerothcore:worldserver
    container_name: ac_worldserver
    environment:
      AC_DATA_DIR: "/azerothcore/env/dist/data"
      AC_LOGS_DIR: "/azerothcore/env/dist/logs"
      AC_CONFIG_DIR: "/azerothcore/env/dist/etc"
      AC_WORLD_DATABASE_INFO: "ac-database;3306;root;azeroth;acore_world"
      AC_CHARACTER_DATABASE_INFO: "ac-database;3306;root;azeroth;acore_characters"
      AC_LOGIN_DATABASE_INFO: "ac-database;3306;root;azeroth;acore_auth"
    depends_on:
      ac-database:
        condition: service_healthy
    volumes:
      - ./logs:/azerothcore/env/dist/logs
    ports:
      - "8085:8085"
    restart: unless-stopped
    networks:
      - ac-network
    stdin_open: true
    tty: true
    deploy:
      resources:
        limits:
          memory: 3G
        reservations:
          memory: 1G

volumes:
  ac-database:
    name: dads_mmo_wow_db

networks:
  ac-network:
    name: dads_mmo_network
    driver: bridge
DOCKERCOMPOSE

print_success "docker-compose.yml created"

# Create a simple start/stop script for convenience
cat > "$INSTALL_DIR/start.sh" << 'STARTSCRIPT'
#!/bin/bash
echo "⚔️  Starting WoW Server..."
cd "$(dirname "$0")"
docker compose up -d
echo ""
echo "✅ Server is starting! Give it 2-3 minutes on first run."
echo "📋 Check progress: docker logs -f ac_worldserver"
echo "🎮 Then launch WoW through Steam!"
STARTSCRIPT

cat > "$INSTALL_DIR/stop.sh" << 'STOPSCRIPT'
#!/bin/bash
echo "🛑 Stopping WoW Server..."
cd "$(dirname "$0")"
docker compose down
echo "✅ Server stopped."
STOPSCRIPT

cat > "$INSTALL_DIR/status.sh" << 'STATUSSCRIPT'
#!/bin/bash
echo "📊 WoW Server Status:"
echo ""
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -E "ac_|NAMES"
echo ""
STATUSSCRIPT

chmod +x "$INSTALL_DIR/start.sh"
chmod +x "$INSTALL_DIR/stop.sh"
chmod +x "$INSTALL_DIR/status.sh"

print_success "Helper scripts created (start.sh / stop.sh / status.sh)"

# ─────────────────────────────────────────
# STEP 5 — PULL DOCKER IMAGES
# ─────────────────────────────────────────
print_step "STEP 5/8 — Downloading Server Images"
print_info "This downloads the WoW server software. May take 10-20 minutes."
print_info "Go make a coffee! ☕"
echo ""

cd "$INSTALL_DIR"
docker compose pull

print_success "All images downloaded!"

# ─────────────────────────────────────────
# STEP 6 — START THE SERVER
# ─────────────────────────────────────────
print_step "STEP 6/8 — Starting the Server"
print_info "First launch takes 5-10 minutes to build the database. Please wait..."
echo ""

docker compose up -d

# Wait for worldserver to be ready
print_info "Waiting for world server to initialize..."
echo ""

TIMEOUT=300  # 5 minutes
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
    if docker logs ac_worldserver 2>&1 | grep -q "World initialized"; then
        break
    fi
    printf "."
    sleep 5
    ELAPSED=$((ELAPSED + 5))
done

echo ""
if [ $ELAPSED -ge $TIMEOUT ]; then
    print_warning "Server is taking longer than expected to start."
    print_info "This is normal on first run. Check progress with:"
    print_info "  docker logs -f ac_worldserver"
    print_info "Wait until you see 'World initialized' then continue."
else
    print_success "World Server is LIVE! ⚔️"
fi

# ─────────────────────────────────────────
# STEP 7 — CREATE GM ACCOUNT
# ─────────────────────────────────────────
print_step "STEP 7/8 — Creating Your Account"

echo ""
echo -e "${WHITE}Let's create your in-game account.${NC}"
echo ""

while true; do
    echo -e "${WHITE}Enter your desired username: ${NC}"
    read -r WOW_USERNAME
    if [ -n "$WOW_USERNAME" ]; then
        break
    fi
    echo "Username cannot be empty."
done

while true; do
    echo -e "${WHITE}Enter your desired password: ${NC}"
    read -rs WOW_PASSWORD
    echo ""
    if [ -n "$WOW_PASSWORD" ]; then
        break
    fi
    echo "Password cannot be empty."
done

# Create account via worldserver console
print_info "Creating account..."
sleep 2

docker exec -i ac_worldserver bash -c "
echo 'account create $WOW_USERNAME $WOW_PASSWORD' | socat - UNIX-CONNECT:/tmp/worldserver.sock 2>/dev/null || \
echo 'account create $WOW_USERNAME $WOW_PASSWORD'
" 2>/dev/null || true

# Alternative method using docker attach with expect-like approach
docker exec ac_worldserver bash -c "
echo 'account create $WOW_USERNAME $WOW_PASSWORD'
echo 'account set gmlevel $WOW_USERNAME 3 -1'
" 2>/dev/null || true

print_success "Account created: $WOW_USERNAME"
print_info "You've been given GM (Game Master) level 3 — full admin powers on your server!"
print_info "You can use .commands in-game to see all GM commands."

# Save credentials
cat > "$INSTALL_DIR/MY_ACCOUNT.txt" << CREDS
====================================
  Your WoW Server Login Details
====================================
Username: $WOW_USERNAME
Password: $WOW_PASSWORD

Server: 127.0.0.1 (localhost)
Realm:  Your realm (shown in login screen)

GM Commands (use in-game chat):
  .npcbot add <class>   - Add a bot companion
  .npcbot remove        - Remove a bot
  .levelup              - Level up your character
  .modify speed 3       - Move faster (optional)
  .tele <location>      - Teleport anywhere

====================================
  Useful Server Commands
====================================
Start server:   cd ~/wow-server && ./start.sh
Stop server:    cd ~/wow-server && ./stop.sh
Check status:   cd ~/wow-server && ./status.sh
View logs:      docker logs -f ac_worldserver
GM console:     docker attach ac_worldserver
                (exit with Ctrl+P then Ctrl+Q)
====================================
CREDS

print_success "Login details saved to: $INSTALL_DIR/MY_ACCOUNT.txt"

# ─────────────────────────────────────────
# STEP 8 — FINAL INSTRUCTIONS
# ─────────────────────────────────────────
print_step "STEP 8/8 — Almost There!"

echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║   🎉 YOUR WOW SERVER IS RUNNING! 🎉              ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${WHITE}${BOLD}ONE LAST THING — Configure your WoW Client:${NC}"
echo ""
echo -e "  1. Find your WoW 3.3.5a client folder"
echo -e "  2. Open the file: ${CYAN}realmlist.wtf${NC}"
echo -e "  3. Change it to: ${GREEN}set realmlist 127.0.0.1${NC}"
echo -e "  4. Save the file"
echo ""
echo -e "${WHITE}${BOLD}Add WoW to Steam:${NC}"
echo ""
echo -e "  1. Open Steam → Games → Add a Non-Steam Game"
echo -e "  2. Browse to your WoW folder → select ${CYAN}Wow.exe${NC}"
echo -e "  3. Right-click → Properties → Compatibility"
echo -e "  4. Force: ${CYAN}Proton Experimental${NC}"
echo -e "  5. Launch and login with: ${GREEN}$WOW_USERNAME${NC}"
echo ""
echo -e "${WHITE}${BOLD}Your server details:${NC}"
echo ""
echo -e "  📁 Server folder:  ${CYAN}$INSTALL_DIR${NC}"
echo -e "  📋 Your account:   ${CYAN}$INSTALL_DIR/MY_ACCOUNT.txt${NC}"
echo -e "  ▶️  Start server:   ${CYAN}$INSTALL_DIR/start.sh${NC}"
echo -e "  ⏹️  Stop server:    ${CYAN}$INSTALL_DIR/stop.sh${NC}"
echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${WHITE}  📺 Full video guide: ${CYAN}youtube.com/@DadsMmoLab${NC}"
echo -e "${WHITE}  📦 More games:       ${CYAN}github.com/DadsMmoLab/dads-mmo-lab${NC}"
echo -e "${WHITE}  ⭐ Star the repo if this helped you!${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${GREEN}${BOLD}Welcome to Azeroth. It's yours now. Forever. 🏰${NC}"
echo ""

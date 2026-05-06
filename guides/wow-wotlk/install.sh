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

set -o pipefail  # Catch pipe errors without being too aggressive on unset vars

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
AVAILABLE_GB=$(df -BG "$HOME" 2>/dev/null | awk 'NR==2 {print $4}' | sed 's/G//' | tr -d ' ')
if [ -n "$AVAILABLE_GB" ] && [ "$AVAILABLE_GB" -lt 15 ] 2>/dev/null; then
    print_error "Not enough disk space. You have ${AVAILABLE_GB}GB free, need at least 15GB."
    exit 1
fi
print_success "Disk space OK (${AVAILABLE_GB:-unknown}GB available)"

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
    print_warning "This may ask for your sudo/deck password"
    echo ""

    # ── Detect SteamOS / Arch vs everything else ──
    if grep -qi "steamos\|arch" /etc/os-release 2>/dev/null || \
       command -v pacman &>/dev/null; then

        print_info "SteamOS / Arch Linux detected — using pacman..."

        # SteamOS has a read-only filesystem — disable it first
        if command -v steamos-readonly &>/dev/null; then
            print_info "Disabling SteamOS read-only filesystem..."
            sudo steamos-readonly disable
        fi

        # Fix pacman keyring — required on SteamOS before installing anything
        print_info "Initialising pacman keyring (this may take a minute)..."

        # Remove and reinitialise the keyring from scratch
        # This fixes 'keyring is not writable' and 'key missing' errors
        sudo rm -rf /etc/pacman.d/gnupg 2>/dev/null || true
        sudo pacman-key --init 2>/dev/null || true
        sudo pacman-key --populate archlinux 2>/dev/null || true
        sudo pacman-key --populate holo 2>/dev/null || true

        # Try steamos-devmode as an additional fix if available
        if command -v steamos-devmode &>/dev/null; then
            sudo steamos-devmode enable 2>/dev/null || true
        fi

        # Update keyring package first before anything else
        print_info "Updating keyring..."
        sudo pacman -Sy --noconfirm --needed archlinux-keyring 2>/dev/null || true

        # Now install Docker
        print_info "Installing Docker via pacman..."
        if ! sudo pacman -Sy --noconfirm docker docker-compose; then
            print_error "Failed to install Docker via pacman."
            print_info "Please try these manual steps in Konsole:"
            print_info "  sudo steamos-readonly disable"
            print_info "  sudo rm -rf /etc/pacman.d/gnupg"
            print_info "  sudo pacman-key --init"
            print_info "  sudo pacman-key --populate archlinux"
            print_info "  sudo pacman-key --populate holo"
            print_info "  sudo pacman -Sy --noconfirm docker docker-compose"
            print_info "Then run this installer again."
            exit 1
        fi

    else
        # Standard Linux (Ubuntu, Debian, Fedora etc.)
        print_info "Standard Linux detected — using get.docker.com..."
        curl -fsSL https://get.docker.com | sudo sh
    fi

    # Add current user to docker group
    sudo usermod -aG docker "$USER" 2>/dev/null || true

    # Enable and start Docker service
    # On SteamOS the service may need a moment after installation
    sleep 2
    sudo systemctl daemon-reload 2>/dev/null || true
    sudo systemctl enable docker 2>/dev/null || true
    sudo systemctl start docker 2>/dev/null || true

    # Give Docker a moment to fully start
    sleep 3

    print_success "Docker installed successfully!"
    print_warning "NOTE: You may need to log out and back in for group permissions."
    print_warning "If you see permission errors, log out, log back in, and re-run this script."
fi

# Use sudo for docker if group not yet active in this session
if ! docker ps &>/dev/null 2>&1; then
    if sudo docker ps &>/dev/null 2>&1; then
        print_warning "Docker group not active yet — using sudo for this session."
        function docker() { sudo docker "$@"; }
        export -f docker 2>/dev/null || true
    else
        print_error "Docker is not responding. Try rebooting and running this script again."
        exit 1
    fi
fi

# Verify Docker Compose is available
if ! docker compose version &>/dev/null; then
    if ! docker-compose version &>/dev/null; then
        print_error "Docker Compose not found."
        print_info "On SteamOS try: sudo pacman -Sy --noconfirm docker-compose"
        exit 1
    fi
fi
print_success "Docker Compose OK"

# ─────────────────────────────────────────
# STEP 3 — INSTALL GIT IF NEEDED
# ─────────────────────────────────────────
print_step "STEP 3/8 — Checking Dependencies"

if ! command -v git &>/dev/null; then
    print_warning "Git not found — installing..."
    if command -v pacman &>/dev/null; then
        sudo pacman -Sy --noconfirm git 2>/dev/null || true
    else
        sudo apt-get install -y git 2>/dev/null || true
    fi
fi

if ! command -v git &>/dev/null; then
    print_error "Could not install git. Please install it manually:"
    print_info "  sudo pacman -Sy --noconfirm git"
    exit 1
fi
print_success "Git is available"

# ─────────────────────────────────────────
# STEP 4 — DOWNLOAD AZEROTHCORE
# ─────────────────────────────────────────
print_step "STEP 4/8 — Setting Up Configuration"

print_info "Downloading official AzerothCore Docker setup..."

# Remove existing folder if it exists so git clone works cleanly
if [ -d "$INSTALL_DIR" ]; then
    print_info "Clearing existing server folder for fresh install..."
    rm -rf "$INSTALL_DIR"
fi

# Clone official acore-docker repo directly into INSTALL_DIR
git clone --depth 1 \
    https://github.com/azerothcore/acore-docker.git \
    "$INSTALL_DIR" 2>&1

# Verify the clone worked and docker-compose.yml exists
if [ ! -f "$INSTALL_DIR/docker-compose.yml" ]; then
    print_error "Failed to download AzerothCore setup."
    print_info "Things to try:"
    print_info "  1. Check your internet connection"
    print_info "  2. Try running the installer again"
    print_info "  3. Manually run: git clone https://github.com/azerothcore/acore-docker.git ~/wow-server"
    exit 1
fi

# Create our extra helper folders inside the cloned repo
mkdir -p "$INSTALL_DIR/logs"
mkdir -p "$INSTALL_DIR/data"

# ── Fix phpMyAdmin port conflict on Steam Deck ──
# phpMyAdmin ships hardcoded on port 8080 which conflicts with
# Decky Loader and other services on many Steam Decks.
# We remap it to port 8181 using docker-compose.override.yml
print_info "Configuring ports for Steam Deck..."

cat > "$INSTALL_DIR/docker-compose.override.yml" << 'OVERRIDE'
services:
  phpmyadmin:
    ports:
      - "8181:80"
OVERRIDE

print_success "phpMyAdmin remapped to port 8181 (avoids Steam Deck conflicts)"
print_info "If you want to use phpMyAdmin, visit: http://localhost:8181"

print_success "AzerothCore Docker setup downloaded!"
print_success "docker-compose.yml is ready!"

# ─────────────────────────────────────────
# INSTALL MODULES
# ─────────────────────────────────────────
print_step "STEP 4b/8 — Installing Dad's MMO Lab Modules"
print_info "Installing the special sauce that makes this server shine..."
echo ""

MODULES_DIR="$INSTALL_DIR/modules"
mkdir -p "$MODULES_DIR"

# mod-playerbots — 500 AI bots that roam, quest, dungeon and party with you
print_info "Installing mod-playerbots (AI bots)..."
git clone --depth 1 \
    https://github.com/liyunfan1223/mod-playerbots.git \
    "$MODULES_DIR/mod-playerbots" 2>/dev/null && \
    print_success "mod-playerbots installed!" || \
    print_warning "mod-playerbots failed — you can add it manually later"

# mod-individual-progression — Vanilla → TBC → WotLK natural progression
print_info "Installing mod-individual-progression..."
git clone --depth 1 \
    https://github.com/ZhengPeiRu21/mod-individual-progression.git \
    "$MODULES_DIR/mod-individual-progression" 2>/dev/null && \
    print_success "mod-individual-progression installed!" || \
    print_warning "mod-individual-progression failed — you can add it manually later"

# mod-ah-bot-plus — Living Auction House economy on all three AHs
print_info "Installing mod-ah-bot-plus (Auction House bot)..."
git clone --depth 1 \
    https://github.com/azerothcore/mod-ah-bot.git \
    "$MODULES_DIR/mod-ah-bot" 2>/dev/null && \
    print_success "mod-ah-bot-plus installed!" || \
    print_warning "mod-ah-bot failed — you can add it manually later"

# mod-dungeon-master — Procedural dungeon challenges with roguelike buffs
print_info "Installing mod-dungeon-master..."
git clone --depth 1 \
    https://github.com/InstanceForge/mod-dungeon-master.git \
    "$MODULES_DIR/mod-dungeon-master" 2>/dev/null && \
    print_success "mod-dungeon-master installed!" || \
    print_warning "mod-dungeon-master failed — you can add it manually later"

echo ""
print_success "Modules installed! These give you:"
print_info "  🤖 500 AI bots — party, dungeon and raid companions"
print_info "  📈 Individual progression — Vanilla → TBC → WotLK"
print_info "  💰 Living Auction House — real economy on all 3 AHs"
print_info "  🏰 Dungeon Master — procedural challenges and roguelike buffs"
echo ""
cat > "$INSTALL_DIR/start.sh" << 'STARTSCRIPT'
#!/bin/bash
echo "⚔️  Starting WoW Server..."
cd "$(dirname "$0")"
docker compose up -d --scale phpmyadmin=0
echo ""
echo "✅ Server is starting! Give it 2-3 minutes on first run."
echo "📋 To check progress run: docker ps"
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
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -E "acore|NAMES"
echo ""
STATUSSCRIPT

chmod +x "$INSTALL_DIR/start.sh"
chmod +x "$INSTALL_DIR/stop.sh"
chmod +x "$INSTALL_DIR/status.sh"

# Create gaming mode launcher in home folder
cat > "$HOME/wow-gaming-mode.sh" << 'GAMINGMODE'
#!/bin/bash
# Dad's MMO Lab — WoW Gaming Mode Launcher
# Add this as a Non-Steam game to play entirely from Gaming Mode!

# Check server is installed
if [ ! -d ~/wow-server ]; then
    echo "========================================"
    echo "  ❌ WoW server not found!"
    echo "  Please run install.sh first."
    echo "  github.com/DadsMmoLab/dads-mmo-lab"
    echo "========================================"
    read
    exit 1
fi

cd ~/wow-server

echo "========================================"
echo "  ⚔️  DAD'S MMO LAB"
echo "  WoW Offline Server"
echo "========================================"
echo ""
echo "  Starting server..."
echo ""

docker compose up -d --scale phpmyadmin=0

echo ""
echo "  Waiting for world server..."
echo ""

TIMEOUT=300
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
    if docker logs "$WORLD_CONTAINER" 2>&1 | grep -q "ready\.\.\."; then
        break
    fi
    printf "."
    sleep 3
    ELAPSED=$((ELAPSED + 3))
done

echo ""
echo ""
echo "========================================"
echo "  ✅ SERVER IS READY!"
echo "  Launch WoW from your Steam library"
echo ""
echo "  Press ENTER when done playing"
echo "  to shut down safely."
echo "========================================"
echo ""

read

echo ""
echo "  Shutting down server..."
echo ""

docker compose down

echo ""
echo "========================================"
echo "  ✅ Server stopped! Safe to close."
echo "========================================"
echo ""

exec bash
GAMINGMODE

chmod +x "$HOME/wow-gaming-mode.sh"
print_success "Gaming Mode launcher created at ~/wow-gaming-mode.sh"
print_info "Add this as a Non-Steam game to play entirely from Gaming Mode!"

print_success "Helper scripts created (start.sh / stop.sh / status.sh)"

# ─────────────────────────────────────────
# STEP 5 — PULL DOCKER IMAGES
# ─────────────────────────────────────────
print_step "STEP 5/8 — Downloading Server Images"
print_info "This downloads the WoW server software. May take 10-20 minutes."
print_info "Go make a coffee! ☕"
echo ""

cd "$INSTALL_DIR"

if ! docker compose pull; then
    print_error "Failed to download server images."
    print_info "Things to try:"
    print_info "  1. Check your internet connection"
    print_info "  2. Make sure Docker is running: sudo systemctl start docker"
    print_info "  3. Try running the installer again"
    exit 1
fi

print_success "All images downloaded!"

# ─────────────────────────────────────────
# STEP 6 — START THE SERVER
# ─────────────────────────────────────────
print_step "STEP 6/8 — Starting the Server"
print_info "First launch takes 5-10 minutes to build the database. Please wait..."
echo ""

# Clean up any orphaned containers from previous installs
print_info "Cleaning up any previous installation remnants..."
docker compose down --remove-orphans 2>/dev/null || true
# Remove any stray worldserver/authserver containers by image name
docker ps -a --format '{{.Names}}' | grep -iE "worldserver|authserver|ac-database" | \
    xargs -r docker rm -f 2>/dev/null || true

if ! docker compose up -d --scale phpmyadmin=0; then
    print_error "Failed to start the server."
    print_info "Things to try:"
    print_info "  1. Check Docker is running: sudo systemctl status docker"
    print_info "  2. Check logs: docker compose logs"
    print_info "  3. Try running the installer again"
    exit 1
fi

# Wait for worldserver to be ready
print_info "Waiting for world server to initialize..."
print_info "First launch builds the entire database — this can take 5-15 minutes."
print_info "The dots below mean it's working. Go make a coffee! ☕"
echo ""

# Detect worldserver container name dynamically
WORLD_CONTAINER=$(docker ps --format '{{.Names}}' | grep -i "worldserver" | head -1)
if [ -z "$WORLD_CONTAINER" ]; then
    WORLD_CONTAINER="wow-server-ac-worldserver-1"
fi
print_info "Detected worldserver container: $WORLD_CONTAINER"

TIMEOUT=900
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
    if docker logs "$WORLD_CONTAINER" 2>&1 | grep -q "ready\.\.\."; then
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
    print_info "  docker logs -f $WORLD_CONTAINER"
    print_info "Wait until you see 'ready...' then continue."
else
    print_success "World Server is LIVE! ⚔️"
fi

# ─────────────────────────────────────────
# STEP 7 — CREATE GM ACCOUNT
# ─────────────────────────────────────────
print_step "STEP 7/8 — Creating Your Account"

echo ""

# Wait for DB to be ready
sleep 10

# Detect DB container
DB_CONTAINER=$(docker ps --format '{{.Names}}' | grep -iE "ac.database|ac_database" | head -1)
if [ -z "$DB_CONTAINER" ]; then
    DB_CONTAINER="wow-server-ac-database-1"
fi

# ── Create default admin account automatically ──
print_info "Creating default admin account..."

ADMIN_UPPER="ADMIN"
ADMIN_HASH=$(echo -n "ADMIN:ADMIN" | sha1sum | awk '{print toupper($1)}' 2>/dev/null || \
             echo -n "ADMIN:ADMIN" | shasum -a 1 | awk '{print toupper($1)}' 2>/dev/null || \
             echo "")

if [ -n "$ADMIN_HASH" ]; then
    docker exec "$DB_CONTAINER" mysql -uroot -ppassword acore_auth -e "
        INSERT INTO account (username, sha_pass_hash, reg_mail, email, joindate)
        VALUES ('ADMIN', '${ADMIN_HASH}', 'admin@local.lan', 'admin@local.lan', NOW())
        ON DUPLICATE KEY UPDATE sha_pass_hash='${ADMIN_HASH}';
    " 2>/dev/null || true

    ADMIN_ID=$(docker exec "$DB_CONTAINER" mysql -uroot -ppassword acore_auth -sNe \
        "SELECT id FROM account WHERE username='ADMIN';" 2>/dev/null)

    if [ -n "$ADMIN_ID" ]; then
        docker exec "$DB_CONTAINER" mysql -uroot -ppassword acore_auth -e "
            INSERT INTO account_access (id, gmlevel, RealmID)
            VALUES ('${ADMIN_ID}', 3, -1)
            ON DUPLICATE KEY UPDATE gmlevel=3;
        " 2>/dev/null || true
        print_success "Default account created!"
        print_info "  Username: admin"
        print_info "  Password: admin"
        print_info "  GM Level: 3 (full admin)"
    fi
else
    print_warning "Could not auto-create admin account — create it manually:"
    print_info "  docker attach $WORLD_CONTAINER"
    print_info "  account create admin admin admin"
    print_info "  account set gmlevel admin 3 -1"
fi

echo ""
echo -e "${WHITE}Want to create an additional custom account? (y/n): ${NC}"
read -r CREATE_CUSTOM
if [[ "$CREATE_CUSTOM" =~ ^[Yy]$ ]]; then
    echo ""
    echo -e "${WHITE}Let's create your custom account.${NC}"
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

    # Hash the password
    WOW_USERNAME_UPPER=$(echo "$WOW_USERNAME" | tr '[:lower:]' '[:upper:]')
    WOW_PASSWORD_UPPER=$(echo "$WOW_PASSWORD" | tr '[:lower:]' '[:upper:]')

    if command -v sha1sum &>/dev/null; then
        WOW_PASS_HASH=$(echo -n "${WOW_USERNAME_UPPER}:${WOW_PASSWORD_UPPER}" | sha1sum | awk '{print toupper($1)}')
    elif command -v shasum &>/dev/null; then
    WOW_PASS_HASH=$(echo -n "${WOW_USERNAME_UPPER}:${WOW_PASSWORD_UPPER}" | shasum -a 1 | awk '{print toupper($1)}')
else
    print_warning "sha1sum not found — account creation may need to be done manually."
    WOW_PASS_HASH=""
fi

if [ -z "$WOW_PASS_HASH" ]; then
    print_warning "Could not hash password — skipping automatic account creation."
    print_info "Create your account manually after the server starts:"
    print_info "  docker attach $WORLD_CONTAINER"
    print_info "  account create ${WOW_USERNAME} ${WOW_PASSWORD} ${WOW_PASSWORD}"
    print_info "  account set gmlevel ${WOW_USERNAME} 3 -1"
else
# Insert account directly into auth database
docker exec "$DB_CONTAINER" mysql -uroot -ppassword acore_auth -e "
  INSERT INTO account (username, sha_pass_hash, reg_mail, email, joindate)
  VALUES (
    UPPER('${WOW_USERNAME}'),
    '${WOW_PASS_HASH}',
    'admin@local.lan',
    'admin@local.lan',
    NOW()
  ) ON DUPLICATE KEY UPDATE sha_pass_hash='${WOW_PASS_HASH}';
" 2>/dev/null

# Get the account ID we just created
ACCOUNT_ID=$(docker exec "$DB_CONTAINER" mysql -uroot -ppassword acore_auth -sNe \
  "SELECT id FROM account WHERE username=UPPER('${WOW_USERNAME}');" 2>/dev/null)

# Set GM level 3 on all realms
if [ -n "$ACCOUNT_ID" ]; then
    docker exec "$DB_CONTAINER" mysql -uroot -ppassword acore_auth -e "
      INSERT INTO account_access (id, gmlevel, RealmID)
      VALUES ('${ACCOUNT_ID}', 3, -1)
      ON DUPLICATE KEY UPDATE gmlevel=3;
    " 2>/dev/null
    print_success "Account created successfully: ${WOW_USERNAME}"
    print_info "GM Level 3 granted — full admin powers on your server!"
else
    print_warning "Account may not have been created automatically."
    print_info "You can create it manually after launch:"
    print_info "  docker attach $WORLD_CONTAINER"
    print_info "  account create ${WOW_USERNAME} ${WOW_PASSWORD} ${WOW_PASSWORD}"
    print_info "  account set gmlevel ${WOW_USERNAME} 3 -1"
    print_info "  (then press Ctrl+P followed by Ctrl+Q to exit)"
fi
fi

# Save credentials
cat > "$INSTALL_DIR/MY_ACCOUNT.txt" << CREDS
====================================
  Your WoW Server Login Details
====================================

DEFAULT ACCOUNT (always created):
  Username: admin
  Password: admin
  GM Level: 3 (full admin)

CUSTOM ACCOUNT (if you created one):
  Username: $WOW_USERNAME
  Password: $WOW_PASSWORD

Server: 127.0.0.1 (localhost)
Realm:  Your realm (shown in login screen)

GM Commands (use in-game chat):
  .levelup              - Level up your character
  .modify speed 3       - Move faster (optional)
  .tele <location>      - Teleport anywhere
  .commands             - See all GM commands

====================================
  Useful Server Commands
====================================
Start server:   cd ~/wow-server && ./start.sh
Stop server:    cd ~/wow-server && ./stop.sh
Check status:   docker ps
View logs:      docker logs -f $WORLD_CONTAINER
GM console:     docker attach $WORLD_CONTAINER
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
echo -e "  🖥️  GM Console:     ${CYAN}docker attach $WORLD_CONTAINER${NC}"
echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${WHITE}  📺 Full video guide: ${CYAN}youtube.com/@DadsMmoLab${NC}"
echo -e "${WHITE}  📦 More games:       ${CYAN}github.com/DadsMmoLab/dads-mmo-lab${NC}"
echo -e "${WHITE}  ⭐ Star the repo if this helped you!${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${GREEN}${BOLD}Welcome to Azeroth. It's yours now. Forever. 🏰${NC}"
echo ""

# 🧙 How to Run the WoW Installer — Complete Beginner Guide

> **"So easy a caveman can do it."**
> If you've never used Linux before, this guide is written specifically for you.
> Follow every step exactly and you'll be in Azeroth in about 30 minutes.

---

## 📋 Before You Start — Checklist

Make sure you have all of these BEFORE running the installer:

- [ ] A **Steam Deck** (or Linux PC)
- [ ] Your **WoW 3.3.5a client folder** — the actual game files (search online for "WoW 3.3.5a client", this version is no longer sold by Blizzard)
- [ ] **At least 15GB of free storage** on your Steam Deck
- [ ] **Internet connection** for the initial download
- [ ] **About 30-60 minutes** of free time (most of it is just waiting)
- [ ] A **USB keyboard** is strongly recommended (makes typing much easier)

---

## 🖥️ Step 1 — Switch to Desktop Mode

Your Steam Deck has two modes — Gaming Mode (the normal game launcher) and Desktop Mode (a full Linux desktop). The installer needs Desktop Mode.

**How to switch:**
1. Press the **STEAM button** on your Steam Deck
2. Scroll down and select **Power**
3. Select **Switch to Desktop**
4. Your Steam Deck will switch to a desktop that looks like a computer

> 💡 **Don't panic** — it looks different but nothing is broken. You can always get back to Gaming Mode by double-clicking the **"Return to Gaming Mode"** icon on the desktop.

---

## 📁 Step 2 — Download the Installer

You need to download the `install.sh` file from GitHub to your Steam Deck.

**Option A — Download directly (easiest):**
1. Open the **web browser** on your Steam Deck desktop (look for Firefox or Discover browser)
2. Go to: `https://github.com/DadsMmoLab/dads-mmo-lab/tree/main/guides/wow-wotlk`
3. Click on `install.sh`
4. Click the **download button** (the icon that looks like a downward arrow ⬇️)
5. Save it to your **Downloads folder**

**Option B — Copy from a USB drive:**
If you downloaded it on another computer, copy it to a USB drive and plug it into your Steam Deck.

---

## 🖥️ Step 3 — Open the Terminal (Konsole)

The terminal is how you talk to Linux. It sounds scary but you only need to type a few things.

**How to open it:**
1. Look at the **taskbar at the bottom** of the desktop
2. Right-click on the **desktop background**
3. Select **"Open Terminal"** or **"Konsole"**

OR:

1. Click the **application menu** (bottom left, looks like a Steam Deck icon)
2. Search for **"Konsole"**
3. Click it to open

> 💡 A black window will appear with a blinking cursor. That's the terminal. It's waiting for you to type something.

---

## ⌨️ Step 4 — Navigate to Your Downloads Folder

In the terminal, type this exactly and press **Enter**:

```bash
cd ~/Downloads
```

> 💡 `cd` means "change directory" — it's like double-clicking a folder. `~/Downloads` means your Downloads folder.

You should see the line change to show you're in Downloads. Now check the file is there by typing:

```bash
ls
```

> 💡 `ls` lists all files in the current folder. You should see `install.sh` in the list.

---

## 🔑 Step 5 — Give the Installer Permission to Run

This is the step most people miss! On Linux, files need special permission before they can run as a program.

Type this exactly and press **Enter**:

```bash
chmod +x install.sh
```

> 💡 `chmod +x` means "give this file execute permission." You only need to do this once. Nothing will happen visually — that's normal!

---

## 🚀 Step 6 — Run the Installer!

Now type this and press **Enter**:

```bash
./install.sh
```

> 💡 The `./` at the start means "run this file from the current folder." Don't forget it!

**You should see a colorful header appear that says:**
```
╔══════════════════════════════════════════════════╗
║         ⚙️  DAD'S MMO LAB                        ║
║         WoW Offline Server Installer             ║
╚══════════════════════════════════════════════════╝
```

If you see this — **you're in!** The installer will guide you through the rest.

---

## 💬 Step 7 — Follow the Installer Prompts

The installer will ask you questions. Here's what to expect:

**"Ready to begin? (y/n)"**
→ Type `y` and press Enter

**It will then automatically:**
- Check your system
- Install Docker (the software that runs the server)
- Install Git (used to download the server files)
- Download the official AzerothCore server *(this takes 10-20 minutes — go make a coffee! ☕)*
- Start the server
- Ask you to create a username and password

**"Enter your desired username:"**
→ Type whatever name you want for your WoW account and press Enter

**"Enter your desired password:"**
→ Type a password (nothing will appear as you type — that's normal for security!)

After that the installer will try to create your account automatically. You'll see either:

```
✅ Account created successfully: YourUsername
```

Or if automatic creation isn't available on your system:

```
⚠️  Create your account manually after launch:
    docker attach acore-docker-ac-worldserver-1
    account create YourUsername YourPassword YourPassword
```

> 💡 **If you see the manual instructions** — don't panic! Just follow the steps it shows you. Type the commands exactly as shown, pressing Enter after each one. Then type Ctrl+P followed by Ctrl+Q to exit the console.

---

## ⚙️ Step 8 — Configure Your WoW Client

Once the installer finishes it will tell you to do one last thing — edit a file in your WoW folder.

1. Navigate to your **WoW 3.3.5a client folder**
2. Find the file called **`realmlist.wtf`** (it's a small text file)
3. Right-click it → **Open with text editor**
4. Delete everything in it and replace it with exactly this:
```
set realmlist 127.0.0.1
```
5. **Save the file**

> 💡 This tells your WoW client to connect to YOUR server on your own Steam Deck instead of Blizzard's servers.

---

## 🎮 Step 9 — Add WoW to Steam and Play!

1. Open **Steam** in Desktop Mode
2. Click **Games** in the top menu → **Add a Non-Steam Game**
3. Click **Browse** and navigate to your WoW 3.3.5a folder
4. Select **`Wow.exe`** and click **Add Selected Programs**
5. In your Steam library, find **WoW** → right-click → **Properties**
6. Click **Compatibility** on the left
7. Check **"Force the use of a specific Steam Play compatibility tool"**
8. Select **Proton Experimental** from the dropdown
9. Close Properties and click **Play**!

At the login screen use the username and password you created in Step 7.

---

## 🎮 BONUS — Play Entirely from Gaming Mode

Once everything is set up and working, you can make the whole experience feel like a proper game — no more switching to Desktop Mode every time you want to play.

**This is how it works:**
1. Launch "WoW Server" from your Steam library in Gaming Mode
2. It starts the server automatically and tells you when it's ready
3. Press the Steam button, launch WoW from your library
4. Play your session
5. Close WoW, go back to the server launcher
6. Press **A** (or Enter on keyboard) to shut down safely

Start to playing: **under 1 minute.**
Exit: **about 20 seconds.**

---

### Step 1 — Download the Gaming Mode Script

1. On your Steam Deck in Desktop Mode open the browser
2. Go to: `https://github.com/DadsMmoLab/dads-mmo-lab/tree/main/guides/wow-wotlk`
3. Download `wow-gaming-mode.sh`
4. Save it to your **home folder** (`/home/deck/`)

### Step 2 — Make it Executable

Open Konsole and run:

```bash
chmod +x ~/wow-gaming-mode.sh
```

### Step 3 — Add to Steam

1. Open **Steam** in Desktop Mode
2. Click **Games** → **Add a Non-Steam Game**
3. Click **Browse** and navigate to your home folder
4. Select `wow-gaming-mode.sh`
5. Click **Add Selected Programs**

### Step 4 — Set the Launch Options

1. Find the new entry in your Steam library
2. Right-click → **Properties**
3. Change the **name** to: `WoW Server`
4. Leave the **Launch Options** field **blank**
5. Under **Compatibility** → check **Force the use of a specific Steam Play compatibility tool** → select **Proton Experimental**

> 💡 You can also set a custom icon and cover art to make it look great in your library!

### Step 5 — That's It!

Switch back to Gaming Mode. You'll see **WoW Server** in your library alongside your other games. Launch it, wait for the ready message, then launch WoW. Everything runs from Gaming Mode — no Desktop Mode needed ever again.

---

## 🔄 Starting and Stopping the Server (Desktop Mode Method)

If you prefer using Desktop Mode or need to start/stop manually:

**Starting the server:**
1. Go to Desktop Mode
2. Open Konsole
3. Type:
```bash
cd ~/wow-server && ./start.sh
```
4. Wait about 30 seconds
5. Go back to Gaming Mode and launch WoW!

**Stopping the server when you're done:**
1. Go to Desktop Mode
2. Open Konsole
3. Type:
```bash
cd ~/wow-server && ./stop.sh
```

> 💡 Always stop the server properly when you're done — don't just turn off your Steam Deck while the server is running!

---

## ❓ Something Went Wrong?

**"Account wasn't created automatically"**
→ The installer will show you the manual commands — follow them exactly
→ Open the worldserver console: `docker attach acore-docker-ac-worldserver-1`
→ Type: `account create USERNAME PASSWORD PASSWORD` (yes, password twice)
→ Type: `account set gmlevel USERNAME 3 -1`
→ Exit with Ctrl+P then Ctrl+Q

**"Nothing happens when I run install.sh"**
→ Make sure you ran `chmod +x install.sh` first (Step 5)
→ Make sure you typed `./install.sh` with the `./` at the start

**"Permission denied"**
→ Run `chmod +x install.sh` again then try `./install.sh`

**"Docker not found" or similar errors**
→ The installer handles Docker automatically — if it fails, try rebooting and running the installer again

**"Can't connect" in the WoW login screen**
→ Make sure the server is running first (`./start.sh`)
→ Make sure `realmlist.wtf` says `set realmlist 127.0.0.1`
→ Give the server 2-3 minutes after starting before launching WoW

**Still stuck?**
→ Drop a comment on our [Reddit post](https://www.reddit.com/r/SteamDeck/s/A8SvXK0eOc) or open an [issue on GitHub](https://github.com/DadsMmoLab/dads-mmo-lab/issues)
→ The community is friendly and we respond fast!

---

## 📺 Prefer to Watch?

Full video walkthrough coming very soon at:

**[youtube.com/@DadsMmoLab](https://youtube.com/@DadsMmoLab)**

Subscribe so you don't miss it — we show every single step on a real Steam Deck!

---

## ⚠️ Important Legal Note

This guide uses [AzerothCore](https://github.com/azerothcore/azerothcore-wotlk) — a completely open source, legal WoW server emulator. We do not distribute any game files or copyrighted content. You must supply your own WoW 3.3.5a client. This is for personal, offline, single-player use only.

---

*Part of the [Dad's MMO Lab](https://github.com/DadsMmoLab/dads-mmo-lab) project — offline MMO servers on Steam Deck, free forever.*

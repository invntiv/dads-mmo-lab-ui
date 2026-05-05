# 🗑️ How to Uninstall the WoW Server — Complete Beginner Guide

> **"Clean removal in under 60 seconds."**
> This guide walks you through completely removing the WoW offline server
> from your Steam Deck. Your WoW client files will NOT be touched.

---

## ⚠️ Read This First — Important Warnings

Before you uninstall, please understand what gets removed:

| What Gets Removed | What Stays Safe |
|---|---|
| ❌ The WoW server software | ✅ Your WoW 3.3.5a client files |
| ❌ All Docker containers | ✅ Docker itself |
| ❌ Downloaded server images | ✅ All your other games |
| ❌ Your characters and progress* | ✅ Everything else on your Deck |

> ⭐ ***The uninstaller will offer to back up your characters before deleting anything. Always say YES to the backup!***

---

## 📋 Before You Start — Checklist

- [ ] You are in **Desktop Mode** (not Gaming Mode)
- [ ] You have read the warning above
- [ ] If you want to keep your characters — make sure the server is **running** before you uninstall so the backup can work

---

## 🖥️ Step 1 — Switch to Desktop Mode

If you're in Gaming Mode:
1. Press the **STEAM button**
2. Select **Power**
3. Select **Switch to Desktop**

---

## 📁 Step 2 — Find the Uninstall Script

The `uninstall.sh` file lives in the same place as `install.sh`.

**If you downloaded it from GitHub:**
1. Open the web browser on your Steam Deck desktop
2. Go to: `https://github.com/DadsMmoLab/dads-mmo-lab/tree/main/guides/wow-wotlk`
3. Click on `uninstall.sh`
4. Download it to your **Downloads folder**

**If you still have it from before:**
It's wherever you saved it originally — Downloads folder most likely.

---

## 🖥️ Step 3 — Open Konsole (The Terminal)

1. Right-click the **desktop background**
2. Select **Open Terminal** or **Konsole**

A black window with a blinking cursor will appear. That's normal!

---

## ⌨️ Step 4 — Navigate to Your Downloads Folder

Type this and press **Enter:**

```bash
cd ~/Downloads
```

Check the file is there:

```bash
ls
```

You should see `uninstall.sh` in the list.

---

## 🔑 Step 5 — Give the Uninstaller Permission to Run

Type this and press **Enter:**

```bash
chmod +x uninstall.sh
```

Nothing will appear visually — that's completely normal!

---

## 🚀 Step 6 — Run the Uninstaller

Type this and press **Enter:**

```bash
./uninstall.sh
```

You should see a red header appear:

```
╔══════════════════════════════════════════════════╗
║         ⚙️  DAD'S MMO LAB                        ║
║         WoW Server — UNINSTALLER                 ║
╚══════════════════════════════════════════════════╝
```

---

## 💬 Step 7 — Answer the Prompts

The uninstaller will ask you three things. Here's exactly what to expect:

---

### Prompt 1 — Backup Your Characters

```
⚠️  Do you want to back up your character data first?
Create a backup before uninstalling? (y/n):
```

**→ Type `y` and press Enter**

> ⭐ **ALWAYS say yes to this.** It saves all your characters, items, gold, and progress to a file. It only takes a few seconds. You can restore everything later if you reinstall.

If the backup succeeds you'll see:
```
✅ Backup saved! (XXmb)
✅ Location: /home/deck/wow-server-backup-XXXXXXXX/full_server_backup.sql
```

> 💡 **Note:** If the backup says the database isn't running, that means your WoW server isn't started. Exit the uninstaller, start the server with `cd ~/wow-server && ./start.sh`, wait 30 seconds, then run the uninstaller again.

---

### Prompt 2 — Final Confirmation

```
⚠️  THIS CANNOT BE UNDONE ⚠️
Are you absolutely sure you want to uninstall? (y/n):
```

**→ Type `y` and press Enter** if you're sure

**→ Type `n` and press Enter** to cancel safely

---

### Prompt 3 — Type DELETE to Confirm

```
Last chance — type DELETE to confirm:
```

**→ Type `DELETE` (all capitals) and press Enter**

> 💡 This is the final safety check. If you type anything other than DELETE the uninstall will cancel and your server will be safe.

---

## ⏳ Step 8 — Wait for Removal

The uninstaller will now:

1. **Stop all server containers** — takes about 10 seconds
2. **Remove Docker images** — takes about 20 seconds
3. **Remove the database** — instant
4. **Delete the server folder** — instant

You'll see green checkmarks as each step completes. When you see:

```
╔══════════════════════════════════════════════════╗
║   ✅ UNINSTALL COMPLETE                           ║
╚══════════════════════════════════════════════════╝
```

**Your WoW server has been completely removed!** ✅

---

## 💾 Step 9 — Save Your Backup File (Important!)

If you made a backup in Step 7, the uninstaller will show you where it saved:

```
Your backup is saved at:
  /home/deck/wow-server-backup-XXXXXXXX/full_server_backup.sql
```

**Copy this file somewhere safe** — USB drive, cloud storage, or your PC. If you ever reinstall and want your characters back, you'll need this file.

---

## 🔄 Want to Reinstall Later?

Reinstalling from scratch is easy. Just run the installer again:

```bash
chmod +x install.sh && ./install.sh
```

To restore your characters after reinstalling:

```bash
docker exec -i acore-docker-ac-database-1 \
  mysql -uroot -ppassword \
  < ~/wow-server-backup-XXXXXXXX/full_server_backup.sql
```

*(Replace XXXXXXXX with the actual date/time in your backup folder name)*

---

## ❓ Something Went Wrong?

**"Nothing happens when I run uninstall.sh"**
→ Run `chmod +x uninstall.sh` first, then `./uninstall.sh`
→ Make sure you have the `./` at the start

**"Database container not running — cannot create backup"**
→ Start the server first: `cd ~/wow-server && ./start.sh`
→ Wait 30 seconds then run the uninstaller again

**"Docker is not installed"**
→ If you never successfully installed the server, there's nothing to uninstall
→ Your Steam Deck is clean already!

**"Permission denied"**
→ Run `chmod +x uninstall.sh` again then try `./uninstall.sh`

**The uninstaller finished but I can still see containers running**
→ Run: `docker ps` to check
→ If anything is still running: `docker stop $(docker ps -q) && docker rm $(docker ps -aq)`

**Still stuck?**
→ Drop a comment on our [Reddit post](https://www.reddit.com/r/SteamDeck/s/A8SvXK0eOc)
→ Open an [issue on GitHub](https://github.com/DadsMmoLab/dads-mmo-lab/issues)
→ We respond fast!

---

## 📺 Prefer to Watch?

Full video walkthrough at:

**[youtube.com/@DadsMmoLab](https://youtube.com/@DadsMmoLab)**

---

## 🔒 What About My WoW Client?

Your WoW 3.3.5a client folder is **completely untouched** by this uninstaller. The uninstaller only removes the server software — Docker containers, images, and the `~/wow-server` folder.

Your game files are safe. Always.

---

*Part of the [Dad's MMO Lab](https://github.com/DadsMmoLab/dads-mmo-lab) project — offline MMO servers on Steam Deck, free forever.*

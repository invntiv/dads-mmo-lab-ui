# ⚙️ Dad's MMO Lab — Steam Deck Offline MMO Server Project

> *"The games we grew up with deserve to live forever. This project makes that possible on a single handheld device."*

**By [u/Kingspoken](https://reddit.com/u/Kingspoken)**

---

## 🎯 What Is This?

This is a collection of **step-by-step guides, Docker scripts, and shell installers** for running classic MMO private servers **completely offline** on a Steam Deck (or any Linux machine).

No subscription. No internet required. No servers getting shut down. Just you and the games you love — forever.

Every guide here is built around:
- ✅ **Open source emulators only** — no copyrighted assets, no game files distributed
- ✅ **Docker-based** — clean, repeatable, easy to remove
- ✅ **Steam Deck tested** — every setup verified on SteamOS
- ✅ **Dad-friendly** — written for people who love games, not just developers

---

## 🌍 The Story

I'm a dad who grew up on MMOs. Like a lot of you, I watched the servers for games I loved get shut down one by one. Nostalrius. Felmyst. Turtle WoW. Games that meant something — gone.

Then I got a Steam Deck.

And I started wondering: *what if I could bring them back? Offline. On a handheld. Forever.*

Turns out — for a lot of classic MMOs — you can. The emulator community has done incredible work over the years. This project is about packaging that work into something any dad (or mom, or kid) can actually use.

**This is not piracy.** We use open source server emulators. You supply your own legally obtained game clients. We just help you run them.

---

## ✅ Currently Working

| Game | Emulator | Status | Guide |
|------|----------|--------|-------|
| ⚔️ World of Warcraft (3.3.5a WotLK) | AzerothCore | ✅ Complete | [View Guide](./guides/wow-wotlk/README.md) |

---

## 🔥 In Progress

| Game | Emulator | Status |
|------|----------|--------|
| 🐉 Monster Hunter Frontier Z | Erupe CE | 🔨 Building |
| 💎 Mu Online | OpenMU | 📋 Planned |
| 🧱 LEGO Universe | Darkflame Universe | 📋 Planned |
| 🏨 Habbo Hotel | Havana | 📋 Planned |
| ⚔️ Tibia | The Forgotten Server | 📋 Planned |
| 🗡️ Cabal Online | Freya | 📋 Planned |
| 🌿 Ragnarok Online | rAthena | 📋 Planned |
| ⚡ PSO Blue Burst | newserv / Archon | 📋 Planned |

---

## 📋 Planned (Phase 02+)

| Game | Emulator | Notes |
|------|----------|-------|
| 🍄 MapleStory (v83 Pre-Big Bang) | Cosmic | Wife's pick 👩 |
| 🌌 Phantasy Star Universe | Clementine | Community server guide |
| ⚒️ RuneScape (2006-2012 era) | 2009Scape / Darkan | |
| 🌟 Final Fantasy XI | LandSandBoat | |
| 🏰 EverQuest 1 | EQEmu | |
| 🚀 Star Wars Galaxies | SWGEmu | |
| ⚔️ Lineage 2 | L2J / Mobius | |
| 🌐 Ultima Online | ServUO | |
| 🗺️ Silkroad Online | Skrillax | |

---

## 🛠️ How It Works

Every game guide follows the same pattern:

```
Steam Deck Desktop Mode
        │
        ▼
   Docker Container
   (Server Emulator)
        │
        ▼
  MariaDB/PostgreSQL/MySQL
   (Game Database)
        │
        ▼
Game Client (via Proton/Wine)
   connects to localhost
```

The server runs silently in the background via Docker. You launch the game client through Steam using Proton. Everything stays on your device — no internet needed after setup.

---

## 📦 Requirements

- Steam Deck (or any Linux machine running SteamOS / Arch-based distro)
- Docker + Docker Compose (install guide included in each setup)
- A legally obtained game client (links to where to find these included per game)
- At least 16GB free storage (varies per game)
- About 1-2 hours for initial setup

---

## 📖 Guide Structure

Each game lives in its own folder under `/guides/`:

```
guides/
├── wow-wotlk/
│   ├── README.md          ← Full step-by-step guide
│   ├── docker-compose.yml ← One-command server setup
│   ├── install.sh         ← Automated installer script
│   └── config/            ← Pre-configured server settings
├── monster-hunter-frontier/
│   └── README.md          ← Coming soon
├── mu-online/
│   └── README.md          ← Coming soon
...
```

---

## ⚠️ Legal & Ethical Notes

This project:
- ✅ Uses **only open source server emulators**
- ✅ Does **not** distribute any game assets, client files, or copyrighted content
- ✅ Requires you to **supply your own game client**
- ✅ Is intended for **personal, offline, single-player use**
- ❌ Does **not** help run public servers
- ❌ Does **not** support monetization of private servers

We respect the incredible work of the emulator communities. We're just helping more people access it.

> *"This is preservation, not piracy."*

---

## 🤝 Contributing

Found a bug in a guide? Got a game working that's not listed? PRs are welcome!

Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before submitting.

---

## 📺 YouTube

Full video tutorials for every guide on this repo:

**▶️ [Dad's MMO Lab — YouTube Channel](https://youtube.com/@DadsMmoLab)**
*(Channel launching soon — subscribe to be notified!)*

---

## 💬 Community

- **Reddit:** [u/Kingspoken](https://reddit.com/u/Kingspoken)
- **Reddit Thread:** [The post that started it all](https://www.reddit.com/r/SteamDeck/s/A8SvXK0eOc)

---

## ☕ Support

This project is free and always will be. If it helped you, consider:

- ⭐ **Starring this repo** — it helps more people find it
- 📢 **Sharing with other dads** who miss their old games
- ☕ **[Buy me a coffee](https://ko-fi.com)** *(link coming soon)*

---

## 📜 License

Scripts and guides in this repo are released under [MIT License](./LICENSE).

Game emulators linked here are subject to their own licenses. Game assets belong to their respective owners and are NOT included here.

---

*Built with love by a dad who just wanted to play WoW on the couch without a subscription.*

*And then things got out of hand.* 😄

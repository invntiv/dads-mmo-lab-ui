# HOWTO — Install Eluna (the Whisper Bridge)

Dad's MMO Lab — bridging The Lab UI to your bots

---

> ✨ **Good news for fresh installs.** As of `install-wow.sh` **v1.2.0**, the Playerbots variant bundles Eluna automatically — `mod-ale` is cloned into your modules folder and `dml_whisper.lua` is dropped into `lua_scripts/` before the first compile. **If you're doing a fresh install, you don't need this guide.**
>
> This document is for **retrofitting an existing Playerbots install** that was set up with an older installer. The Lab UI will continue to work without Eluna — you'll just lose automatic gear application in My Party.

---

## What is this thing?

**Eluna** is a Lua scripting layer for AzerothCore. With it installed, The Lab can control your bots in ways that aren't possible otherwise — specifically, it lets the app send chat whispers to your bots *as your character*, which is how mod-playerbots accepts most of its commands (set a spec, equip gear, top off skills).

Without Eluna, The Lab's "My Party" feature can still spec your bots' talents, but **gear application won't work automatically**. With Eluna, the app can fully outfit a bot with one click.

This guide walks you through installing Eluna manually on an **existing** Playerbots server.

---

## What you need before starting

1. ✅ You already used `install-wow.sh` to install the **Playerbots** variant.
2. ✅ Your server is at `~/wow-server-playerbots/` (the standard location).
3. ✅ Docker is installed and working (`install-wow.sh` does this).
4. ✅ You're comfortable spending **about 30-45 minutes** on this. The rebuild step takes a while.

---

## ⭐ Step 1 — Stop the server

```sh
cd ~/wow-server-playerbots
docker compose down
```

The server needs to be off so we can recompile cleanly.

---

## ⭐ Step 2 — Drop Eluna into the modules folder

```sh
cd ~/wow-server-playerbots/modules
git clone --depth=1 https://github.com/azerothcore/mod-eluna.git
```

That's the whole "install the module" step. Eluna is just another mod, same as Transmog or AH Bot.

---

## ⭐ Step 3 — Rebuild the server with Eluna baked in

```sh
cd ~/wow-server-playerbots
docker compose up -d --build
```

This rebuilds the worldserver Docker image with Eluna compiled in. **Grab a coffee** — it takes 15-30 minutes on a Steam Deck. The first time you've done this since the original install, expect closer to 30. You can watch the output to see progress.

When it finishes, the server starts back up automatically.

---

## ⭐ Step 4 — Drop in The Lab's whisper script

Copy the `dml_whisper.lua` script from this repo into the server's Lua scripts directory.

```sh
cp /path/to/dads-mmo-lab-ui/guides/wow-wotlk/eluna-scripts/dml_whisper.lua \
   ~/wow-server-playerbots/env/dist/bin/lua_scripts/
```

> **Where exactly does Eluna look for scripts?** It depends on the install layout. The default is `<worldserver datadir>/lua_scripts/`. If the path above doesn't exist, run:
> ```sh
> find ~/wow-server-playerbots -name "lua_scripts" -type d 2>/dev/null
> ```
> Eluna will create the directory on its first run if it doesn't exist — start the server once after Step 3, then look.

---

## ⭐ Step 5 — Reload Eluna scripts (or restart the server)

If the server is already running, just reload:

```sh
docker exec -it ac-worldserver bash -c 'echo "reload eluna" | ./worldserver'
```

Or simpler, just restart the worldserver container:

```sh
docker restart ac-worldserver
```

---

## ⭐ Step 6 — Verify it loaded

Watch the worldserver log:

```sh
docker logs -f ac-worldserver | grep dml_whisper
```

You should see:

```
[dml_whisper] loaded — bridge ready
```

If you see that, **you're done.** The Lab will use the bridge automatically.

---

## Verifying end-to-end (optional)

Log into the game with one of your characters. Make sure at least one Playerbot is in your party or actively spawned (you can spot one with `.playerbots rndbot stats` from the GM console). Then, from the worldserver console (or via SOAP from The Lab's debug panel), send:

```
dml_whisper YourCharacterName SomeBotName autogear
```

The bot should equip a fresh outfit. If it does, the whole chain is working — The Lab's My Party flow will be able to do this automatically.

---

## Troubleshooting

**"git clone" fails with "permission denied"** — Make sure you're cloning into the modules dir as your normal user, not with sudo.

**"docker compose up --build" hangs forever** — Sometimes it does. If the build seems stuck for more than 45 minutes with no output movement, Ctrl+C, then run `docker compose down` and try again.

**Eluna built but my script isn't loading** — Confirm the file landed in the right `lua_scripts/` directory. Run `docker exec -it ac-worldserver ls /azerothcore/env/dist/bin/lua_scripts/` to see what Eluna is actually loading from.

**The script loads but my whisper doesn't work** — Make sure the player AND the bot are both online when you fire `dml_whisper`. Offline characters can't receive whispers — same rule as in-game chat.

**`dml_whisper` says "player not found"** — Names are case-sensitive. `Joshua` and `joshua` are different.

---

## What's next

Once Eluna is installed, The Lab's **My Party** feature can:

- Set a bot's spec to whatever you pick
- Equip them with appropriate gear
- Top off their skills and reputation

Without Eluna, you'll get talent application but no automatic gear. The app will tell you when Eluna is missing.

For fresh Playerbots installs, `install-wow.sh` v1.2.0+ handles all of the above automatically — no manual steps. This guide stays around for retrofits and for understanding what the installer does under the hood.

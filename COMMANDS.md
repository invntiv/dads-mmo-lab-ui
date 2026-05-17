# AzerothCore + mod-playerbots Command Reference

> Source of truth: the cloned worldserver under `~/wow-server-playerbots/` on this machine. Every command listed below is registered in a `ChatCommandTable` inside `src/server/scripts/Commands/cs_*.cpp` (core) or `modules/mod-playerbots/src/` (Playerbots module). Commands that exist in stock AzerothCore but were not found in this build are **not** included.
>
> **Audience for UI suitability ratings:** a single-player dad on a Steam Deck running an offline server. Commands that change game state in fun / power-user ways score high; commands that only matter for running a public realm, debugging the emulator, or maintaining databases score low.
>
> **GM-level convention.** Most commands use `rbac::RBAC_PERM_*` rather than a fixed SEC_* level. AzerothCore's default RBAC mapping is:
> - `SEC_PLAYER` = 0
> - `SEC_MODERATOR` = 1
> - `SEC_GAMEMASTER` = 2
> - `SEC_ADMINISTRATOR` = 3
> - `SEC_CONSOLE` = 4 (worldserver console, or SOAP authenticated as a SEC_CONSOLE account)
>
> Stock `install-wow.sh` creates `admin/admin` at GM level 3, which is sufficient for every command in this document **except** a handful gated to console-only.
>
> **UI suitability key:**
> - ★★★ — obvious UI button or form, will be used constantly
> - ★★ — good UI candidate but second priority
> - ★ — exposable but niche
> - — — skip; CLI / SOAP raw is fine

---

## Table of contents

1. [Player editing](#1-player-editing)
2. [Items & inventory](#2-items--inventory)
3. [Teleport & world](#3-teleport--world)
4. [Accounts & GM](#4-accounts--gm)
5. [NPC / mob spawning](#5-npc--mob-spawning)
6. [GameObjects](#6-gameobjects)
7. [Quests & achievements](#7-quests--achievements)
8. [Reputation & titles](#8-reputation--titles)
9. [Spells, talents & cheats](#9-spells-talents--cheats)
10. [Playerbots — master commands](#10-playerbots--master-commands-bot)
11. [Playerbots — random bots](#11-playerbots--random-bots-rndbot)
12. [Playerbots — account linking & misc](#12-playerbots--account-linking--misc)
13. [Server admin](#13-server-admin)
14. [Reload / config](#14-reload--config)
15. [Reset / character maintenance](#15-reset--character-maintenance)
16. [Groups, guilds, instances, LFG](#16-groups-guilds-instances-lfg)
17. [Lookup & list](#17-lookup--list)
18. [Tickets, mail, send](#18-tickets-mail-send)
19. [Events, battlefield, arena, spectator](#19-events-battlefield-arena-spectator)
20. [Debug / power-user (skip-worthy)](#20-debug--power-user-skip-worthy)
21. [Recommended phase-by-phase rollout](#recommended-phase-by-phase-rollout)

---

## 1. Player editing

Modify the selected target (or self) — stats, resources, appearance, movement. **Highest-value UI surface for a solo player.** Most live in `cs_modify.cpp` and `cs_misc.cpp`.

| Command | Syntax | What it does | GM | UI |
|---|---|---|---|---|
| `.modify hp` | `<amount>` | Set current/max HP of target | 2 | ★★★ |
| `.modify mana` | `<amount>` | Set current/max mana | 2 | ★★★ |
| `.modify rage` | `<amount>` | Set rage | 2 | ★ |
| `.modify runicpower` | `<amount>` | Set DK runic power | 2 | ★ |
| `.modify energy` | `<amount>` | Set rogue/cat energy | 2 | ★ |
| `.modify money` | `<copper>` | Add/remove copper (gold = copper×10000) | 2 | ★★★ |
| `.modify scale` | `<0.1–10>` | Change model scale | 2 | ★★ |
| `.modify faction` | `<factionId>` | Change faction template (combat behavior) | 2 | ★ |
| `.modify spell` | `<flatmod> <pctmod> <spell>` | Modify a spell modifier | 2 | — |
| `.modify talentpoints` | `<count>` | Add free talent points | 2 | ★★★ |
| `.modify mount` | `<modelId> <speed>` | Force-mount with custom speed | 2 | ★★ |
| `.modify honor` | `<amount>` | Add honor points | 2 | ★★ |
| `.modify reputation` | `<faction> <amount>` | Adjust standing with a faction | 2 | ★★ |
| `.modify arenapoints` | `<amount>` | Add arena points | 2 | ★ |
| `.modify drunk` | `<0–100>` | Set drunkenness | 2 | — |
| `.modify standstate` | `<state>` | Force animation state | 2 | — |
| `.modify phase` | `<phaseMask>` | Set phase mask (visibility) | 2 | ★ |
| `.modify gender` | `0\|1` | Swap character gender | 2 | ★★ |
| `.modify bit` | `<field> <bit>` | Toggle a bit in a unit field | 3 | — |
| `.modify speed all` | `<rate>` | Multiplier for all movement speeds (1.0 = normal) | 2 | ★★★ |
| `.modify speed walk` | `<rate>` | Walking speed multiplier | 2 | ★ |
| `.modify speed backwalk` | `<rate>` | Backwards walking | 2 | — |
| `.modify speed swim` | `<rate>` | Swim speed | 2 | ★ |
| `.modify speed fly` | `<rate>` | Flight speed | 2 | ★★★ |
| `.morph target` | `<displayId>` | Morph target into another model | 2 | ★★ |
| `.morph mount` | `<displayId>` | Morph mount | 2 | ★ |
| `.morph reset` | — | Reset to original model | 2 | ★★ |
| `.levelup` | `[<player>] [<count>]` | Levels a player up N levels (negative to delevel) | 2 | ★★★ |
| `.character level` | `[<player>] <level>` | Set absolute level | 2 | ★★★ |
| `.character customize` | `[<player>]` | Flag character for paid customization on next login | 2 | ★★ |
| `.character changefaction` | `[<player>]` | Allow faction change next login | 2 | ★★ |
| `.character changerace` | `[<player>]` | Allow race change next login | 2 | ★★ |
| `.character rename` | `[<player>]` | Force-rename on next login | 2 | ★ |
| `.character reputation` | `[<player>]` | List target's faction standings | 2 | ★★ |
| `.character titles` | `[<player>]` | List known titles | 2 | ★★ |
| `.character changeaccount` | `<player> <account>` | Move a character to a different account | 3 | — |
| `.character erase` | `<name>` | Permadelete a character | 3 | — |
| `.character check bank` | `[<player>]` | Inspect bank contents | 2 | ★ |
| `.character check bag` | `[<player>]` | Inspect bags | 2 | ★ |
| `.character check profession` | `[<player>]` | Show known professions | 2 | ★ |
| `.character deleted list` | `[<filter>]` | List soft-deleted characters | 2 | ★ |
| `.character deleted restore` | `<id>` | Undelete a character | 2 | ★★ |
| `.character deleted delete` | `<id>` | Hard-delete | 3 | — |
| `.character deleted purge` | — | Delete all old soft-deleted chars | 3 | — |
| `.die` | — | Kill target | 2 | ★★ |
| `.damage` | `<amount> [<schoolmask>]` | Deal damage to target | 2 | ★★ |
| `.revive` | `[<player>]` | Revive target / player | 2 | ★★★ |
| `.dismount` | — | Force dismount | 2 | ★ |
| `.freeze` | `[<player>]` | Freeze target in place | 2 | ★ |
| `.unfreeze` | `[<player>]` | Release freeze | 2 | ★ |
| `.cooldown` | `[<spell>]` | Clear cooldown (all if no arg) | 2 | ★★★ |
| `.combatstop` | `[<player>]` | Drop combat | 2 | ★★ |
| `.unstuck` | `[<player>] [<location>]` | Teleport unstuck (graveyard/inn) | 2 | ★★ |
| `.maxskill` | — | Max out all skills on target | 2 | ★★ |
| `.setskill` | `<skill> <level> [<max>]` | Set a single skill | 2 | ★ |
| `.cheat god` | `[on\|off]` | Invulnerability | 2 | ★★★ |
| `.cheat power` | `[on\|off]` | Infinite resources (no mana/rage cost) | 2 | ★★★ |
| `.cheat cooldown` | `[on\|off]` | All cooldowns ignored | 2 | ★★★ |
| `.cheat casttime` | `[on\|off]` | All casts instant | 2 | ★★ |
| `.cheat waterwalk` | `[on\|off]` | Walk on water | 2 | ★★ |
| `.cheat taxi` | `[on\|off]` | All flightpaths unlocked | 2 | ★★ |
| `.cheat explore` | `[on\|off]` | Reveal full map | 2 | ★★ |
| `.cheat status` | — | Show which cheats are on | 2 | ★ |
| `.gm on` / `.gm off` | — | Toggle staff badge / GM flag | 2 | ★★★ |
| `.gm fly` | `on\|off` | Toggle anywhere-fly | 2 | ★★★ |
| `.gm visible` | `on\|off` | Toggle visibility to players | 2 | ★ |
| `.gm chat` | `on\|off` | Toggle [GM] tag in chat | 1 | — |
| `.gm spectator` | — | Enter spectator mode | 2 | — |
| `.aura` | `<spell>` | Apply an aura to self/target | 2 | ★★★ |
| `.aura stack` | `<spell> <count>` | Apply N stacks | 2 | ★ |
| `.unaura` | `<spell\|"all">` | Remove an aura | 2 | ★★ |
| `.recall` | `[<player>]` | Teleport target back to their saved location | 2 | ★ |
| `.save` | — | Force-save your character now | 2 | ★ |
| `.bm` | `[on\|off]` | Beastmaster (tame any creature) | 2 | ★ |

---

## 2. Items & inventory

| Command | Syntax | What it does | GM | UI |
|---|---|---|---|---|
| `.additem` | `<itemId\|[link]> [<count>]` | Spawn item into target's bags | 2 | ★★★ |
| `.additem set` | `<itemSetId>` | Add every item in an itemSet | 2 | ★★★ |
| `.bags clear` | `<itemQuality>` | Strip bags of items at-or-below given quality | 2 | ★ |
| `.item move` | `<from> <to>` | Move item between inventory slots | 2 | — |
| `.item refund` | `<itemId>` | Refund a refundable item | 2 | — |
| `.item restore` | `<restoreId> <player>` | Restore a previously deleted item | 3 | ★ |
| `.item restore list` | `[<player>]` | List restorable item entries | 3 | ★ |
| `.gear repair` | `[<player>]` | Repair all equipped items to full durability | 2 | ★★★ |
| `.gear stats` | `[<player>]` | Print summary of equipped gear (ilvl, stats) | 2 | ★★ |
| `.inventory count` | `[<player>]` | Count an item in target's bags | 2 | ★ |
| `.pinfo` | `[<player>]` | Full player info dump (account, gear, money, etc.) | 2 | ★★ |

---

## 3. Teleport & world

| Command | Syntax | What it does | GM | UI |
|---|---|---|---|---|
| `.teleport` | `<name>` | Teleport self to a named location (game_tele table) | 2 | ★★★ |
| `.teleport add` | `<name>` | Save current spot as a named teleport | 2 | ★★ |
| `.teleport del` | `<name>` | Delete a saved teleport | 2 | ★ |
| `.teleport name` | `<player> <location\|"$home">` | Teleport another player to a named loc | 2 | ★★ |
| `.teleport name npc id` | `<creatureEntry>` | Teleport to a creature by template ID | 2 | ★ |
| `.teleport name npc guid` | `<spawnGuid>` | Teleport to a specific creature spawn | 2 | ★ |
| `.teleport name npc name` | `<creatureName>` | Teleport to a named creature | 2 | ★ |
| `.teleport group` | `<location>` | Teleport whole party | 2 | ★★ |
| `.appear` | `[<player>]` | Teleport self to another player | 2 | ★★★ |
| `.summon` | `[<player>]` | Teleport another player to you | 2 | ★★★ |
| `.groupsummon` | `[<player>]` | Summon the player's entire group | 2 | ★★ |
| `.recall` | `[<player>]` | Send player back to where summon picked them up | 2 | ★ |
| `.go creature` | `<spawnGuid>` | Teleport to a creature spawn point | 2 | ★ |
| `.go creature id` | `<entry>` | Teleport to nearest spawn of entry | 2 | ★ |
| `.go creature name` | `<name>` | Teleport to a named creature | 2 | ★ |
| `.go gameobject` | `<spawnGuid>` | Teleport to a gobject | 2 | ★ |
| `.go gameobject id` | `<entry>` | Teleport to nearest gobject of entry | 2 | ★ |
| `.go graveyard` | `<id>` | Teleport to a graveyard | 2 | ★ |
| `.go grid` | `<x> <y> [<mapId>]` | Teleport to grid coords | 2 | — |
| `.go taxinode` | `<nodeId>` | Teleport to a flightmaster | 2 | ★ |
| `.go trigger` | `<id>` | Teleport to an area-trigger | 2 | — |
| `.go zonexy` | `<x> <y> [<zone>]` | Teleport to in-zone coords | 2 | — |
| `.go xyz` | `<x> <y> <z> [<mapId>] [<orient>]` | Teleport to absolute coords | 2 | ★ |
| `.go ticket` | `<ticketId>` | Teleport to ticket reporter | 2 | — |
| `.go quest` | `<questId>` | Teleport to the quest's starting POI | 2 | ★ |
| `.gps` | `[<target>]` | Print current coords / zone of self or target | 2 | ★ |
| `.wchange` | `<type> <grade>` | Change weather (rain/snow/storm) | 2 | ★★ |
| `.linkgrave` | `<graveyardId> [<faction>]` | Link a graveyard to the current zone | 2 | — |
| `.neargrave` | `[<faction>]` | Find nearest graveyard | 2 | ★ |
| `.showarea` | `<areaId>` | Reveal an area on target's map | 2 | ★ |
| `.hidearea` | `<areaId>` | Unreveal an area | 2 | — |
| `.opendoor` | `[<range>]` | Open the nearest gameobject (door/chest) | 2 | ★★ |
| `.mailbox` | — | Spawn a temp mailbox where you stand | 2 | ★★ |
| `.respawn` | — | Force-respawn nearby dead creatures | 2 | ★★ |
| `.respawn all` | — | Respawn all in the current map | 2 | ★ |

---

## 4. Accounts & GM

| Command | Syntax | What it does | GM | UI |
|---|---|---|---|---|
| `.account create` | `<name> <password> [<email>]` | Create an account | Console | ★★★ |
| `.account delete` | `<name>` | Delete an account (and its characters) | Console | ★ |
| `.account` | — | Show *your own* account info (in-game) | 0 | ★ |
| `.account set gmlevel` | `<name> <level> [<realmId\|-1>]` | Promote/demote an account | Console | ★★★ |
| `.account set password` | `<name> <pass> <pass>` | Set another account's password | Console | ★★ |
| `.account set addon` | `<name> <expansion>` | Set account expansion level | 3 | — |
| `.account set 2fa` | `<name> <token\|"off">` | Set/clear 2FA secret | 3 | — |
| `.account set email` | `<name> <email> <email>` | Set account email | Console | — |
| `.account password` | `<old> <new> <new>` | Change *your own* password | 0 | ★ |
| `.account addon` | `<expansion>` | Set your own client expansion level | 0 | — |
| `.account onlinelist` | — | List online accounts | 2 | ★ |
| `.account lock country` | `on\|off` | Lock account to current country | 0 | — |
| `.account lock ip` | `on\|off` | Lock account to current IP | 0 | — |
| `.account remove country` | — | Remove the country lock | 2 | — |
| `.account 2fa setup` | `<token>` | Self-enable 2FA | 0 | — |
| `.account 2fa remove` | `<token>` | Self-disable 2FA | 0 | — |
| `.kick` | `[<player>] [<reason>]` | Kick a player from the realm | 2 | ★★ |
| `.mute` | `<player> <minutes> <reason>` | Chat-mute a player | 1 | ★ |
| `.unmute` | `<player>` | Lift a mute | 1 | ★ |
| `.mutehistory` | `<account>` | Show past mutes | 1 | — |
| `.ban account` | `<account> <duration> <reason>` | Ban an account | 3 | ★ |
| `.ban character` | `<name> <duration> <reason>` | Ban a single character | 3 | ★ |
| `.ban playeraccount` | `<name> <duration> <reason>` | Ban character's account | 3 | ★ |
| `.ban ip` | `<ip> <duration> <reason>` | Ban an IP | 3 | — |
| `.unban account` | `<account>` | Unban | 3 | ★ |
| `.unban character` | `<name>` | Unban a character | 3 | ★ |
| `.unban playeraccount` | `<name>` | Unban via character | 3 | ★ |
| `.unban ip` | `<ip>` | Unban IP | 3 | — |
| `.baninfo account/character/ip` | `<target>` | Show ban details | 2 | — |
| `.banlist account/character/ip` | `[<filter>]` | Browse bans | 2 | — |
| `.gm list` | — | List all GM accounts | 2 | ★ |
| `.gm ingame` | — | List GMs currently online | 0 | ★ |
| `.rbac list` | `[<id>]` | List all RBAC permissions | 3 | — |
| `.rbac account list` | `[<acc>] [<realmId>]` | List permissions on an account | 3 | — |
| `.rbac account grant/deny/revoke` | `<acc> <permId> [<realmId>]` | Toggle RBAC permissions | 3 | — |

---

## 5. NPC / mob spawning

Everything under `.npc`. Without an explicit target the command operates on your current selection.

| Command | Syntax | What it does | GM | UI |
|---|---|---|---|---|
| `.npc add` | `<entry>` | Spawn a permanent creature at your spot | 2 | ★★★ |
| `.npc add temp` | `<entry>` | Spawn a temporary (despawns) creature | 2 | ★★ |
| `.npc add item` | `<entry> <maxcount> <incrtime> [<extendedcost>]` | Add an item to selected vendor | 2 | ★ |
| `.npc add move` | `<creatureGuid> [<waittime>]` | Add a waypoint to a creature's path | 2 | — |
| `.npc add formation` | `<leaderGUID>` | Add selected creature to a formation | 2 | — |
| `.npc delete` | `[<spawnId>]` | Delete the selected creature spawn | 2 | ★★★ |
| `.npc delete item` | `<itemId>` | Remove a vendor item | 2 | ★ |
| `.npc info` | — | Print full info about selected creature | 2 | ★★ |
| `.npc guid` | — | Print GUID of selected creature | 2 | ★ |
| `.npc near` | `[<distance>]` | List creatures within range | 2 | ★ |
| `.npc move` | `[<spawnId>]` | Move selected creature to your location | 2 | ★★ |
| `.npc follow` | — | Make selected creature follow you | 2 | ★★ |
| `.npc follow stop` | — | Stop following | 2 | ★ |
| `.npc tame` | — | Tame as a pet (selected creature) | 2 | ★★ |
| `.npc playemote` | `<emoteId>` | Play an emote | 2 | ★ |
| `.npc say` | `<text>` | Make selected creature speak | 2 | ★ |
| `.npc textemote` | `<emoteId>` | Text emote | 2 | — |
| `.npc whisper` | `<player> <text>` | Whisper as the creature | 2 | — |
| `.npc yell` | `<text>` | Yell as the creature | 2 | — |
| `.npc do` | `<action>` | Trigger creature script action | 2 | — |
| `.npc set entry` | `<entry>` | Change the creature's template entry | 2 | ★ |
| `.npc set model` | `<modelId>` | Change displayed model | 2 | ★★ |
| `.npc set level` | `<level>` | Set selected creature's level | 2 | ★★ |
| `.npc set faction permanent` | `<factionId>` | Permanently set faction | 2 | ★ |
| `.npc set faction temp` | `<factionId>` | Temporary faction change | 2 | ★ |
| `.npc set faction original` | — | Restore the spawn's original faction | 2 | ★ |
| `.npc set flag` | `<flags>` | Set NPC flags bitmask (vendor, trainer, etc.) | 2 | — |
| `.npc set allowmove` | `0\|1` | Toggle movement | 2 | — |
| `.npc set link` | `<creatureGuid>` | Link spawn to another | 3 | — |
| `.npc set movetype` | `<type>` | Random/waypoint/idle movement | 2 | — |
| `.npc set phase` | `<phaseMask>` | Phase the creature into | 2 | — |
| `.npc set wanderdistance` | `<dist>` | Random-movement radius | 2 | — |
| `.npc set spawntime` | `<seconds>` | Respawn delay | 2 | ★ |
| `.npc set data` | `<index> <value>` | Set scripted data field | 2 | — |
| `.npc load` | `<spawnId>` | Hot-reload a creature spawn | 3 | — |
| `.npc spawngroup` | `<groupId>` | Force-spawn a spawn group | 3 | — |
| `.npc despawngroup` | `<groupId>` | Despawn a spawn group | 3 | — |
| `.pet create` | — | Give the targeted creature to you as a pet | 2 | ★★ |
| `.pet delete` | — | Delete current pet | 2 | ★ |
| `.pet learn` | `<spell>` | Teach pet a spell | 2 | ★ |
| `.pet list` | — | List pet's known spells | 2 | — |
| `.pet unlearn` | `<spell>` | Untrain a pet spell | 2 | — |
| `.possess` | — | Take direct control of selected creature | 2 | ★ |
| `.unpossess` | — | Release control | 2 | ★ |
| `.bindsight` | — | See through selected creature's eyes | 2 | ★ |
| `.unbindsight` | — | Stop | 2 | — |

---

## 6. GameObjects

| Command | Syntax | What it does | GM | UI |
|---|---|---|---|---|
| `.gobject add` | `<entry> [<spawntime>]` | Spawn a permanent gobject at your spot | 2 | ★★ |
| `.gobject add temp` | `<entry> <spawntime>` | Spawn a temporary gobject | 2 | ★ |
| `.gobject delete` | `<guid>` | Delete a spawned gobject | 2 | ★ |
| `.gobject info` | `[<entry>]` | Print info about nearest gobject | 2 | ★ |
| `.gobject near` | `[<distance>]` | List nearby gobjects | 2 | ★ |
| `.gobject move` | `<guid> [<x> <y> <z>]` | Move a gobject | 2 | — |
| `.gobject turn` | `<guid> [<o>]` | Rotate a gobject | 2 | — |
| `.gobject target` | `[<filter>]` | Find a gobject by name | 2 | — |
| `.gobject activate` | `<guid>` | Toggle a gobject (open/close door, chest, etc.) | 2 | ★★ |
| `.gobject respawn` | `<guid>` | Respawn a gobject | 2 | ★ |
| `.gobject load` | `<guid>` | Hot-reload a gobject | 3 | — |
| `.gobject set phase` | `<guid> <phaseMask>` | Phase a gobject | 2 | — |
| `.gobject set state` | `<guid> <state>` | Force a state | 2 | — |
| `.gobject spawngroup` | `<group>` | Force-spawn a group | 2 | — |
| `.gobject despawngroup` | `<group>` | Despawn a group | 2 | — |

---

## 7. Quests & achievements

| Command | Syntax | What it does | GM | UI |
|---|---|---|---|---|
| `.quest add` | `<questId> [<player>]` | Add a quest to log | 2 | ★★★ |
| `.quest complete` | `<questId> [<player>]` | Auto-complete objectives | 2 | ★★★ |
| `.quest reward` | `<questId> [<player>]` | Hand in / collect reward | 2 | ★★ |
| `.quest remove` | `<questId> [<player>]` | Remove a quest | 2 | ★★ |
| `.quest status` | `<questId> [<player>]` | Show quest status | 2 | ★ |
| `.achievement add` | `<achievementId> [<player>]` | Grant an achievement | 2 | ★★★ |
| `.achievement checkall` | — | Re-evaluate all achievements for target | 2 | ★ |

---

## 8. Reputation & titles

| Command | Syntax | What it does | GM | UI |
|---|---|---|---|---|
| `.modify reputation` | `<factionId> <amount\|rank>` | Set standing with a faction | 2 | ★★★ |
| `.character reputation` | `[<player>]` | List target's reputations | 2 | ★★ |
| `.titles add` | `<titleId>` | Grant a title | 2 | ★★ |
| `.titles remove` | `<titleId>` | Remove a title | 2 | ★ |
| `.titles current` | `<titleId>` | Set the *active* (worn) title | 2 | ★★ |
| `.titles set mask` | `<mask>` | Raw bitmask of known titles | 3 | — |
| `.character titles` | `[<player>]` | List known titles | 2 | ★ |
| `.honor add` | `<amount>` | Give honor points | 2 | ★ |
| `.honor add kill` | — | Credit an honorable kill (target the victim) | 2 | — |
| `.honor update` | — | Recalculate weekly honor | 2 | — |

---

## 9. Spells, talents & cheats

| Command | Syntax | What it does | GM | UI |
|---|---|---|---|---|
| `.learn` | `<spell> ["all"]` | Teach selected player a spell | 2 | ★★ |
| `.unlearn` | `<spell> ["all"]` | Forget a spell | 2 | ★ |
| `.learn all` | — | (Top-level) GM-default spells | 2 | — |
| `.learn all gm` | — | Learn all GM spells | 3 | — |
| `.learn all my class` | — | Learn every spell available to your class | 2 | ★★★ |
| `.learn all my talents` | — | Learn every class talent | 2 | ★★★ |
| `.learn all my pettalents` | — | Learn pet talents | 2 | ★★ |
| `.learn all my trainer` | — | Learn everything a trainer would teach | 2 | ★★ |
| `.learn all my quest` | — | Learn quest-rewarded spells | 2 | ★ |
| `.learn all crafts` | — | Learn every profession at max | 3 | ★★ |
| `.learn all recipes` | `<professionName>` | Learn every recipe in a profession | 3 | ★★ |
| `.learn all default` | `[<player>]` | Reset to starting spellbook | 3 | — |
| `.learn all lang` | — | Learn every faction language | 3 | ★ |
| `.player learn` | `<player> <spell> ["all"]` | Console-friendly form | 3 | — |
| `.player unlearn` | `<player> <spell> ["all"]` | Console-friendly form | 3 | — |
| `.cast` | `<spell> [<triggered>]` | Cast on selected target | 2 | ★★ |
| `.cast self` | `<spell>` | Cast on yourself | 2 | ★★ |
| `.cast target` | `<spell>` | Make target cast on itself | 2 | ★ |
| `.cast back` | `<spell>` | Make target cast on caster | 2 | ★ |
| `.cast dist` | `<spell> <dist>` | Cast at a distance point | 2 | — |
| `.cast dest` | `<spell> <x> <y> <z>` | Cast at coords | 2 | — |
| `.cooldown` | `[<spell>]` | Clear cooldown(s) | 2 | ★★★ |
| `.reset talents` | `[<player>]` | Wipe spent talents | 2 | ★★★ |
| `.reset spells` | `[<player>]` | Wipe entire spellbook | 2 | ★ |
| `.spellinfo attributes` | `<spell>` | Dump spell attributes | 2 | — |
| `.spellinfo effects` | `<spell>` | Dump spell effects | 2 | — |
| `.spellinfo targets` | `<spell>` | Dump targets | 2 | — |
| `.spellinfo all` | `<spell>` | Full dump | 2 | — |

---

## 10. Playerbots — master commands (`.bot`)

All `.bot` subcommands route through `PlayerbotMgr::HandlePlayerbotCommand`. Most accept `PLAYERNAME` (a single character), `*` (every party member), `!` (every bot in the world; admin only), a comma-separated list, or no argument (use selected target).

| Command | Syntax | What it does | GM | UI |
|---|---|---|---|---|
| `.bot add` | `<charname>` | Log a character on your account in as a bot | 0 | ★★★ |
| `.bot login` | `<charname>` | Alias for `add` | 0 | ★★★ |
| `.bot addaccount` | `<charname\|account>` | Log in **every** character on that account as bots | 0 | ★★★ |
| `.bot addclass` | `<class> [male\|female\|0\|1]` | Conjure a fresh random-bot character of given class (warrior/paladin/hunter/rogue/priest/shaman/mage/warlock/druid/dk) | 0/2 | ★★★ |
| `.bot remove` | `<charname\|*>` | Logout a bot | 0 | ★★★ |
| `.bot rm` | `<charname>` | Alias for `remove` | 0 | ★★ |
| `.bot logout` | `<charname>` | Alias for `remove` | 0 | ★★ |
| `.bot list` | — | List your account's bots (online/offline + class) | 0 | ★★★ |
| `.bot lookup` | — | Print available class icons (`.bot lookup CLASS` for filtered) | 0 | ★ |
| `.bot self` | — | Toggle bot-AI on **your own** character | 0/2 | ★★ |
| `.bot initself` | — | Re-roll *your own* gear at EPIC quality (GM only) | 2 | ★★ |
| `.bot initself=uncommon\|rare\|epic\|legendary\|<gs>` | — | Re-roll self at quality / target gearscore | 2 | ★★ |
| `.bot init=auto` | `<charname\|*>` | Re-roll bot gear to match your gearscore (the safe default) | 0 | ★★★ |
| `.bot init=common\|white` | `<charname\|*>` | Re-roll bot gear white-quality | 2 | ★★ |
| `.bot init=uncommon\|green` | `<charname\|*>` | Green quality | 2 | ★★ |
| `.bot init=rare\|blue` | `<charname\|*>` | Blue quality | 2 | ★★ |
| `.bot init=epic\|purple` | `<charname\|*>` | Epic quality | 2 | ★★★ |
| `.bot init=legendary\|yellow` | `<charname\|*>` | Legendary quality | 2 | ★★ |
| `.bot init=<gearscore>` | `<charname\|*>` | Re-roll to a target gearscore number | 2 | ★★ |
| `.bot refresh` | `<charname\|*>` | Top off consumables / buffs without re-gearing | 0 | ★★★ |
| `.bot refresh=raid` | `<charname>` | Unbind a bot from its current raid lockout | 0 | ★ |
| `.bot levelup` / `.bot level` | `<charname\|*>` | Re-roll gear after a level change | 0 | ★★ |
| `.bot random` | `<charname\|*>` | Apply random-bot full randomization | 0 | ★★ |
| `.bot quests` | `<charname\|*>` | Hand bot the standard dungeon/raid quests | 0 | ★★ |
| `.bot reload` | — | Reload `playerbots.conf` live | 2 | ★★ |
| `.bot tweak` | — | Cycle internal `tweakValue` (0→1→2→0) — dev knob | 2 | — |

---

## 11. Playerbots — random bots (`.rndbot`)

These act on the global random-bot pool, not bots you own. All gated to `SEC_GAMEMASTER` / `Console::Yes`.

| Command | Syntax | What it does | GM | UI |
|---|---|---|---|---|
| `.rndbot stats` | — | Print random-bot population stats | 2 | ★★ |
| `.rndbot reset` | — | Wipe the `playerbots_random_bots` table (requires restart) | 2 | ★ |
| `.rndbot reload` | — | Re-read `playerbots.conf` | 2 | ★★ |
| `.rndbot update` | — | Run one update tick manually | 2 | — |
| `.rndbot init` | `[<namefilter>]` | Initialize / re-randomize matching bots | 2 | ★★ |
| `.rndbot clear` | `[<namefilter>]` | Clear matching bots' random state | 2 | ★ |
| `.rndbot levelup` / `.rndbot level` | `[<filter>]` | Force a level pass on matching bots | 2 | ★ |
| `.rndbot refresh` | `[<filter>]` | Top-off matching bots | 2 | ★ |
| `.rndbot teleport` | `[<filter>]` | Re-roll bot's grind zone for current level | 2 | ★ |
| `.rndbot revive` | `[<filter>]` | Resurrect matching dead bots | 2 | ★ |
| `.rndbot grind` | `[<filter>]` | Send matching bots to a random grind spot | 2 | ★ |
| `.rndbot change_strategy` | `[<filter>]` | Force-rotate combat strategy | 2 | — |

`<namefilter>` is a SQL LIKE pattern (`%` matches anything) — omit it to operate on everything.

---

## 12. Playerbots — account linking & misc

| Command | Syntax | What it does | GM | UI |
|---|---|---|---|---|
| `.playerbots account setKey` | `<securityKey>` | Set the security key on your account that other accounts must present to link | 0 | ★ |
| `.playerbots account link` | `<accountName> <securityKey>` | Link your account to another account so its characters can be loaded as bots | 0 | ★ |
| `.playerbots account linkedAccounts` | — | Show accounts linked to yours | 0 | ★ |
| `.playerbots account unlink` | `<accountName>` | Remove a link | 0 | ★ |
| `.playerbots gtask` | `<subcmd>` | Guild-task system (subcommands handled internally) | 2 | — |
| `.playerbots pmon` | `[reset\|tick\|stack\|toggle]` | Playerbots performance monitor | 2 | — |
| `.playerbots debug bg` | `<subcmd>` | BG-tactics debug | 2 | — |

---

## 13. Server admin

| Command | Syntax | What it does | GM | UI |
|---|---|---|---|---|
| `.server info` | — | Server version, uptime, build, world load | 0 | ★★★ |
| `.server motd` | — | Show current Message of the Day | 0 | ★ |
| `.server set motd` | `<text>` | Change MOTD | 3 | ★★ |
| `.server set loglevel` | `<type> <name> <level>` | Adjust logger level live | 3 | — |
| `.server set closed` | `on\|off` | Close the realm to new logins | 3 | ★ |
| `.server shutdown` | `<seconds> [<exitcode>] [<reason>]` | Shut down the world | 3 | ★★★ |
| `.server shutdown cancel` | — | Cancel a pending shutdown | 3 | ★★★ |
| `.server restart` | `<seconds> [<exitcode>] [<reason>]` | Restart the world | 3 | ★★★ |
| `.server restart cancel` | — | Cancel pending restart | 3 | ★★ |
| `.server idleshutdown` | `<seconds>` | Shut down once no players are online | 3 | ★ |
| `.server idleshutdown cancel` | — | Cancel | 3 | ★ |
| `.server idlerestart` | `<seconds>` | Restart once empty | 3 | ★ |
| `.server idlerestart cancel` | — | Cancel | 3 | ★ |
| `.server corpses` | — | Force corpse cleanup pass | 3 | — |
| `.server debug` | — | Print worldserver debug info | 3 | — |
| `.server exit` | — | Immediate exit (no warning) | 3 | ★ |
| `.saveall` | — | Save every online player now | 3 | ★★ |
| `.announce` | `<msg>` | Broadcast a chat-channel message | 1 | ★★★ |
| `.gmannounce` | `<msg>` | Broadcast as `[GM]` | 1 | ★ |
| `.nameannounce` | `<msg>` | Broadcast prefixed with sender name | 1 | ★ |
| `.gmnameannounce` | `<msg>` | Combined GM + name announce | 1 | — |
| `.notify` | `<msg>` | Center-screen yellow popup to all players | 1 | ★★ |
| `.gmnotify` | `<msg>` | Center popup, GM-tagged | 1 | ★ |
| `.whispers` | `on\|off` | Toggle whether you (the GM) accept whispers | 2 | — |
| `.autobroadcast list` | — | List scheduled broadcasts | 2 | ★ |
| `.autobroadcast add` | `<weight> <text>` | Add a scheduled broadcast | 3 | ★ |
| `.autobroadcast locale` | `<id> <locale> <text>` | Localized variant | 3 | — |
| `.autobroadcast remove` | `<id>` | Remove one | 3 | ★ |
| `.send mail` | `<player> <subject> <body>` | Send a player in-game mail | 3 | ★★ |
| `.send items` | `<player> <subject> <body> <itemids…>` | Mail items to a player | 3 | ★★★ |
| `.send money` | `<player> <subject> <body> <copper>` | Mail money | 3 | ★★ |
| `.send message` | `<player> <text>` | Server-system whisper | 3 | ★ |
| `.message …` | (various) | See section 13 above + `cs_message.cpp` | 1–3 | ★ |
| `.flusharenapoints` | — | Trigger weekly arena-point distribution now | 3 | — |
| `.mailbox` | — | Spawn a temp mailbox where you stand | 2 | ★★ |

---

## 14. Reload / config

These hot-reload database tables without restarting the worldserver. Stock RBAC requires `SEC_ADMINISTRATOR` / console. The full list (from `cs_reload.cpp`) is **~100 individual tables**; the table below covers the ones a UI would care about. Everything else is one-off DBA work — give the user a single "Reload everything" button (`.reload all`) and a smaller dropdown for common subsets.

| Command | Syntax | What it does | GM | UI |
|---|---|---|---|---|
| `.reload all` | — | Reload all reloadable tables | 3 | ★★ |
| `.reload all achievement` | — | Achievement-related tables | 3 | ★ |
| `.reload all area` | — | Area-triggers | 3 | ★ |
| `.reload all gossips` | — | All gossip tables | 3 | ★ |
| `.reload all item` | — | Item-related tables | 3 | ★ |
| `.reload all locales` | — | All locale tables | 3 | — |
| `.reload all loot` | — | All loot templates | 3 | ★ |
| `.reload all npc` | — | NPC tables (text, vendor, trainer) | 3 | ★ |
| `.reload all quest` | — | Quest tables | 3 | ★ |
| `.reload all scripts` | — | Reload script bindings | 3 | ★ |
| `.reload all spell` | — | Spell tables | 3 | ★ |
| `.reload config` | — | Re-read `worldserver.conf` (subset of keys) | 3 | ★★★ |
| `.reload command` | — | Re-read command table | 3 | ★ |
| `.reload conditions` | — | Re-read conditions table | 3 | ★ |
| `.reload creature_template` | — | Reload one creature template | 3 | ★ |
| `.reload game_tele` | — | Reload teleport list (used after `.teleport add`) | 3 | ★ |
| `.reload autobroadcast` | — | Reload scheduled broadcasts | 3 | ★ |
| `.reload rbac` | — | Reload RBAC perms | 3 | — |
| `.reload smart_scripts` | — | Reload SmartAI scripts | 3 | ★ |
| `.reload waypoint_data` / `waypoint_scripts` | — | Reload pathing | 3 | — |

> See `~/wow-server-playerbots/src/server/scripts/Commands/cs_reload.cpp` for the exhaustive list (every `*_loot_template`, every `*_locale`, etc.).

---

## 15. Reset / character maintenance

| Command | Syntax | What it does | GM | UI |
|---|---|---|---|---|
| `.reset all` | `<player>` | Reset everything (talents+spells+stats+achievements+honor) | 3 | ★ |
| `.reset achievements` | `[<player>]` | Wipe achievements | 3 | ★ |
| `.reset honor` | `[<player>]` | Wipe honor stats | 3 | ★ |
| `.reset level` | `[<player>]` | Set back to level 1 | 3 | ★ |
| `.reset spells` | `[<player>]` | Wipe spellbook | 3 | ★ |
| `.reset stats` | `[<player>]` | Recompute base stats | 3 | — |
| `.reset talents` | `[<player>]` | Wipe spent talents | 2 | ★★★ |
| `.reset items equipped` | `[<player>]` | Delete equipped items | 3 | ★ |
| `.reset items bags` | `[<player>]` | Delete bag items | 3 | ★ |
| `.reset items bank` | `[<player>]` | Delete bank items | 3 | ★ |
| `.reset items keyring` | `[<player>]` | Delete keyring | 3 | — |
| `.reset items currency` | `[<player>]` | Wipe currencies | 3 | ★ |
| `.reset items vendor_buyback` | `[<player>]` | Wipe vendor buyback list | 3 | — |
| `.reset items all` | `[<player>]` | Wipe **all** items | 3 | ★ |
| `.reset items allbags` | `[<player>]` | Wipe items including bags themselves | 3 | — |
| `.deserter bg add` | `<player> <minutes>` | Apply BG deserter debuff | 2 | — |
| `.deserter bg remove` / `remove all` | `<player>\|—` | Lift BG deserter | 2 | — |
| `.deserter instance add` | `<player> <minutes>` | Apply instance deserter | 2 | — |
| `.deserter instance remove` / `remove all` | `<player>\|—` | Lift instance deserter | 2 | ★ |
| `.pdump copy` | `<sourceGUID> <destAccount> [<destName>] [<destGUID>]` | Copy a character | 3 | ★ |
| `.pdump load` | `<file> <account> [<name>] [<guid>]` | Restore a character from .pdump | 3 | ★★ |
| `.pdump write` | `<file> <character>` | Dump a character to .pdump | 3 | ★★ |

---

## 16. Groups, guilds, instances, LFG

| Command | Syntax | What it does | GM | UI |
|---|---|---|---|---|
| `.group list` | `[<player>]` | List group members | 2 | ★ |
| `.group join` | `<masterPlayer>` | Add target to another player's group | 2 | ★★ |
| `.group remove` | `[<player>]` | Remove from group | 2 | ★ |
| `.group leader` | `[<player>]` | Promote to leader | 2 | — |
| `.group disband` | `[<player>]` | Disband target's group | 2 | ★ |
| `.group revive` | — | Revive entire group | 2 | ★★ |
| `.guild create` | `<player> <name>` | Create a guild around a player | 3 | ★★ |
| `.guild delete` | `<name>` | Disband a guild | 3 | ★ |
| `.guild invite` | `<player> <guildname>` | Add a player to a guild | 3 | ★ |
| `.guild uninvite` | `<player>` | Remove a player from their guild | 3 | ★ |
| `.guild rank` | `<player> <rank>` | Set a player's guild rank | 3 | — |
| `.guild rename` | `<old> <new>` | Rename a guild | 3 | ★ |
| `.guild info` | `[<player>\|<name>]` | Show guild info | 0 | ★ |
| `.instance listbinds` | `[<player>]` | List target's instance lockouts | 2 | ★★ |
| `.instance unbind` | `<mapid\|"all"> [<difficulty>]` | Clear instance lockouts | 2 | ★★★ |
| `.instance stats` | — | Show worldserver instance stats | 2 | ★ |
| `.instance savedata` | — | Force-save instance scripted data | 2 | — |
| `.instance setbossstate` | `<bossId> <state>` | Set boss-encounter state | 3 | — |
| `.instance getbossstate` | `<bossId>` | Inspect boss state | 3 | — |
| `.lfg player` | `[<player>]` | LFG status for player | 2 | — |
| `.lfg group` | `[<player>]` | LFG status for group | 2 | — |
| `.lfg queue` | — | LFG queue stats | 3 | — |
| `.lfg clean` | — | Wipe LFG state | 3 | ★ |
| `.lfg options` | `[<options>]` | Toggle LFG features | 3 | — |
| `.lfg cooldown` | `[<player>]` | Clear LFG cooldown | 3 | ★ |

---

## 17. Lookup & list

These are read-only search commands — perfect for *backing* a UI search box, less so as commands the user types directly.

| Command | Syntax | What it does | GM | UI |
|---|---|---|---|---|
| `.lookup item` | `<text>` | Search items by name | 2 | ★★★ (backend) |
| `.lookup item set` | `<text>` | Search itemSets | 2 | ★★ (backend) |
| `.lookup creature` | `<text>` | Search creatures by name | 2 | ★★ (backend) |
| `.lookup object` / `.lookup gobject` | `<text>` | Search gameobjects | 2 | ★★ (backend) |
| `.lookup quest` | `<text>` | Search quests | 2 | ★★ (backend) |
| `.lookup spell` | `<text>` | Search spells | 2 | ★★ (backend) |
| `.lookup spell id` | `<id>` | Lookup spell by ID | 2 | ★ |
| `.lookup area` | `<text>` | Search areas | 2 | ★ |
| `.lookup map` | `<text>` | Search maps | 2 | ★ |
| `.lookup taxinode` | `<text>` | Search flight nodes | 2 | ★ |
| `.lookup teleport` | `<text>` | Search saved teleports | 2 | ★★★ |
| `.lookup faction` | `<text>` | Search factions | 2 | ★★ |
| `.lookup skill` | `<text>` | Search skills | 2 | ★ |
| `.lookup title` | `<text>` | Search titles | 2 | ★★ |
| `.lookup event` | `<text>` | Search world-events | 2 | ★ |
| `.lookup player ip` | `<ip>` | Find characters by IP | 2 | — |
| `.lookup player account` | `<account>` | List characters on an account | 2 | ★★ |
| `.lookup player email` | `<email>` | Find characters by email | 2 | — |
| `.list creature` | `<entry> [<count>]` | List spawn points of a creature | 2 | ★ |
| `.list item` | `<itemId> [<count>]` | List existing instances of an item | 2 | ★ |
| `.list object` | `<entry> [<count>]` | List gobject spawns | 2 | ★ |
| `.list auras` | — | List all auras on target | 2 | ★ |
| `.list auras id` | `<spell>` | List a specific aura | 2 | — |
| `.list auras name` | `<text>` | List auras matching name | 2 | — |
| `.list respawns` | — | List near respawns | 2 | — |

---

## 18. Tickets, mail, send

GM-ticket support tools — most are skip-worthy for a single-player install, but the `.send` family is genuinely useful.

| Command | Syntax | What it does | GM | UI |
|---|---|---|---|---|
| `.send mail` | `<player> <subject> <body>` | Send in-game mail | 3 | ★★ |
| `.send items` | `<player> <subject> <body> <itemspecs…>` | Mail items (`itemId[:count]` per token) | 3 | ★★★ |
| `.send money` | `<player> <subject> <body> <copper>` | Mail copper | 3 | ★★ |
| `.send message` | `<player> <text>` | System whisper | 3 | ★ |
| `.mail list` | `<player>` | List a player's mailbox | 2 | ★ |
| `.mail return` | `<player>` | Return all undelivered mail | 2 | — |
| `.ticket list` / `.ticket onlinelist` / `.ticket closedlist` / `.ticket escalatedlist` | — | Browse tickets | 2 | — |
| `.ticket viewid` / `.ticket viewname` | `<id\|name>` | Inspect a ticket | 2 | — |
| `.ticket assign` / `.ticket unassign` | `<id> [<gm>]` | Assign GM | 2 | — |
| `.ticket comment` | `<id> <text>` | Annotate | 2 | — |
| `.ticket complete` / `.ticket close` | `<id>` | Mark done | 2 | — |
| `.ticket delete` | `<id>` | Delete | 3 | — |
| `.ticket escalate` | `<id> <level>` | Escalate | 2 | — |
| `.ticket reset` | — | Wipe ticket DB | 3 | — |
| `.ticket togglesystem` | — | Disable/enable ticket system | 3 | ★ |
| `.ticket response …` | `<id> <text>` | Compose ticket response | 2 | — |

---

## 19. Events, battlefield, arena, spectator

| Command | Syntax | What it does | GM | UI |
|---|---|---|---|---|
| `.event activelist` | — | List currently active world events | 2 | ★★ |
| `.event info` | `<eventId>` | Inspect an event | 2 | ★ |
| `.event start` | `<eventId>` | Force-start an event (e.g. Winter Veil, Brewfest) | 2 | ★★★ |
| `.event stop` | `<eventId>` | Force-stop | 2 | ★★ |
| `.bf start` | `<battleId>` | Start a battlefield (Wintergrasp) | 3 | ★ |
| `.bf stop` | `<battleId>` | Stop | 3 | ★ |
| `.bf switch` | `<battleId>` | Switch attacking team | 3 | — |
| `.bf timer` | `<battleId> <seconds>` | Adjust BF timer | 3 | ★ |
| `.bf enable` | `<battleId>` | Toggle enabled | 3 | — |
| `.bf queue` | `<battleId>` | Queue all online for BF | 3 | — |
| `.arena create` | `<player> "<name>" <type>` | Create an arena team for a player | 3 | — |
| `.arena disband` | `<teamName>` | Disband | 3 | — |
| `.arena rename` | `<old> <new>` | Rename | 3 | — |
| `.arena captain` | `<team> <player>` | Set team captain | 3 | — |
| `.arena info` | `<team>` | Inspect team | 2 | — |
| `.arena lookup` | `<text>` | Find teams | 2 | — |
| `.arena season start/set state/reward/deleteteams` | (various) | Arena-season admin | 3 | — |
| `.spect spectate` | `<player>` | Begin spectating a player | 2 | ★★ |
| `.spect watch` | `<player>` | Switch spectated player | 2 | ★ |
| `.spect leave` | — | Stop spectating | 2 | ★ |
| `.spect reset` | — | Reset spectator state | 2 | — |
| `.spect version` | — | Print spectator version | 2 | — |
| `.skirmish` | `<arenas> <playersPerSide> <player1>,<player2>,…` | Hot-start a custom arena skirmish | 2 | ★ |

---

## 20. Debug / power-user (skip-worthy)

Listed only so we don't accidentally reinvent them. None deserve a UI button.

- **`cs_debug.cpp`** — `.debug threat`, `.debug combat`, `.debug los`, `.debug arena`, `.debug bg`, `.debug lfg`, `.debug loot`, `.debug send <subcmd>`, `.debug play <subcmd>`, `.debug setvalue`, `.debug getvalue`, `.debug zonestats`, `.debug objectcount`, `.debug spawnvehicle`, etc. ~40 entries, all `RBAC_PERM_COMMAND_DEBUG`. Plus top-level `.wpgps`.
- **`cs_cache.cpp`** — `.cache info`, `.cache delete`, `.cache refresh`.
- **`cs_mmaps.cpp`** — `.mmap path`, `.mmap loc`, `.mmap loadedtiles`, `.mmap stats`, `.mmap testarea`.
- **`cs_pool.cpp`** / **`cs_pooltools.cpp`** — `.pool info`, `.pool lookup`, `.pooltools start/def/add/remove/end/clear`. Spawn-pool authoring tools.
- **`cs_worldstate.cpp`** — `.worldstate sunsreach status/phase/subphase/counter/gate/gatecounter`, `.worldstate scourgeinvasion show/state/battleswon/startzone`. Diagnostics for two scripted world events.
- **`cs_disable.cpp`** — `.disable add/remove spell/quest/map/battleground/outdoorpvp/vmap <id> [<flags> <comment>]`. Maintenance tool, not gameplay.
- **`cs_wp.cpp`** — `.wp add/event/load/modify/unload/reload/show`. Waypoint authoring; only useful if you're building creature pathing by hand.
- **`cs_dev.cpp`** / `.dev` — developer flag.
- **`.commands`** — Print every available command (built-in help).
- **`.help <text>`** — Help for a single command.
- **`.commentator`** — Toggle the commentator UI.
- **`.movegens`** — Print active movement generators on target.
- **`.cometome`** — Make selected creature walk to you (devtool).
- **`.string <id> [<locale>]`** — Print a server string by ID.
- **`.playall <soundId>`** — Play a sound to everyone.
- **`.distance [<target>]`** — Print distance to target.
- **`.movegens`** — Print movement generator stack.
- **`.packetlog`** — Per-player packet logging.
- **`.guid`** — Print own GUID.
- **`.player_settings announcer`** — Per-player UI toggles.
- **`.message whispers on\|off`** — Whisper logging.

These commands exist in this build but are not worth UI surface area unless we hit a specific debugging need.

---

## Modules

This server install has **only mod-playerbots** loaded under `modules/`. There are **no other modules currently installed**, so the categories from the brief — Solocraft, AutoBalance, Transmog, AH Bot, IndividualProgression, AoE Loot — have no command surface to enumerate here. When the user adds modules via `manage-wow-modules.sh`, this file will need a re-scan of `modules/*/src/**/*.cpp` for new `ChatCommandTable` registrations. Most of those modules expose 1-3 GM commands (e.g. AH Bot's `.ahbot status`, Solocraft's `.solocraft …` config peek) — patterns to look for when re-scanning:

- Files named `*CommandScript.cpp` or registering with `CommandScript("…")`.
- The string `ChatCommandTable` plus `GetCommands() const override`.

---

## Recommended phase-by-phase rollout

Mapped to ARCHITECTURE.md phases. Phase 2 = read-only via MySQL; Phase 3 = first GM commands via SOAP; Phase 4 = persistence/presets.

### Phase 2 — Read-only situational awareness

The UI is reading directly from `ac_database`, not sending commands. The commands below are the *reference* for what data the UI should surface — implementing them as panels rather than buttons. **No SOAP yet.** Where a command's purpose can be answered by a direct DB query, prefer the query.

| # | Command | Phase-2 implementation | Why |
|---|---|---|---|
| 1 | `.gm ingame` / `.gm list` | Query `account` joined to `account_access` (or `account` `gmlevel` column depending on schema). | Surfacing GMs is trivial and orients the user. |
| 2 | `.pinfo <player>` | Compose from `characters` + `character_equipment` + `character_inventory` + `item_template`. | The character-editor's home screen. |
| 3 | `.character reputation <player>` | Read `character_reputation`. | Drives any reputation tab. |
| 4 | `.character titles <player>` | Read `character_titles` bitmask. | Same. |
| 5 | `.character check bank/bag` | Read `character_inventory`. | Inventory view. |
| 6 | `.gear stats <player>` | Compute from `character_equipment` + `item_template`. | Equipment preview. |
| 7 | `.account onlinelist` | Read `account` joined to `characters.online`. | "Who's logged in" widget. |
| 8 | `.instance listbinds <player>` | Read `character_instance`. | Helpful before clicking "unbind". |
| 9 | `.bot list` | Read `characters` for our account, filter to bot characters. | Bot roster panel. |
| 10 | `.server info` | Use `docker exec ac_worldserver` or read `realmlist` + uptime from container. | Already present in Phase 1. |

### Phase 3 — SOAP comes online

First batch of *write* commands. These are the ones that pay off the fastest as buttons/forms, and are reliably exposed over SOAP because they're `Console::Yes` (or work through a SEC_CONSOLE-authenticated session).

| # | Command | Why now |
|---|---|---|
| 1 | `.additem <id> [<count>]` | The killer feature. Item-search box (driven by `item_template` query) → "Add" button. |
| 2 | `.additem set <itemSetId>` | One-click full set. |
| 3 | `.gear repair [<player>]` | Trivial; eliminates a tedious in-game trip. |
| 4 | `.teleport <name>` | City/dungeon dropdown sourced from `game_tele`. |
| 5 | `.teleport name <player> <loc>` | Same dropdown, applied to bots. |
| 6 | `.summon [<player>]` / `.appear [<player>]` | Two buttons next to any character row. |
| 7 | `.modify money <copper>` | Slider or numeric input — also serves as the "give gold" widget. |
| 8 | `.modify hp` / `.modify mana` | Resource sliders on the character editor. |
| 9 | `.modify speed all <rate>` | Single slider for travel speed. |
| 10 | `.modify talentpoints <n>` | Spinner. |
| 11 | `.levelup` / `.character level <n>` | The "make me 80" button. |
| 12 | `.learn all my class` + `.learn all my talents` | One button each — both very common. |
| 13 | `.cheat god` / `.cheat power` / `.cheat cooldown` | Three toggles in a "Cheats" panel. |
| 14 | `.gm fly on/off` | Toggle. |
| 15 | `.cooldown` | "Reset all cooldowns" button. |
| 16 | `.revive` | One button. |
| 17 | `.morph target <displayId>` + `.morph reset` | Cosmetic; cheap to add. |
| 18 | `.wchange <type> <grade>` | Weather selector — playful. |
| 19 | `.event start/stop <id>` + `.event activelist` | Dropdown of world events with start/stop. |
| 20 | `.quest add <id>` + `.quest complete <id>` + `.achievement add <id>` | Quest/achievement search box → add/complete buttons. |
| 21 | `.instance unbind <map\|"all">` | "Reset raids" button. |
| 22 | `.server shutdown <s>` + `.server shutdown cancel` | Backed by the existing Stop button, but should accept a countdown. |
| 23 | `.account set gmlevel <name> <level>` | Form on the account list. |
| 24 | `.account create <name> <pass> [<email>]` | Form. Useful when adding a friend's character as a bot via `.bot addaccount`. |
| 25 | **Playerbots core**: `.bot add`, `.bot addaccount`, `.bot remove`, `.bot list`, `.bot init=auto`, `.bot init=epic`, `.bot refresh`, `.bot addclass <class> [<gender>]` | The bot-roster screen. `init=auto` is the safe default; `init=epic` is the "go" button for endgame. |
| 26 | `.rndbot stats` + `.rndbot reload` | Small ops panel. |

### Phase 4 — Persistence layer (presets)

These commands aren't new — they're the *building blocks* for the preset/snapshot features. Phase 4's UI surface is the preset library; the commands below are what gets executed when the user clicks "Apply preset".

| # | Composite feature | Commands used | Notes |
|---|---|---|---|
| 1 | **Gear set snapshot** | `.send items` (or direct DB write) | Snapshot reads `character_equipment` + `character_inventory`. Restore mails the items via SOAP `.send items` (safer than direct DB write because the worldserver picks them up automatically on next mailbox visit). |
| 2 | **NPCBot party preset** | Sequence of `.bot add <name>` per roster member, then `.bot init=auto` or `.bot init=epic`, then `.bot refresh` | Save the bot names + chosen gear tier per slot. |
| 3 | **"Hardcore" / "Soft" / "Power-fantasy" mode profile** | `.modify speed all`, `.cheat god`, `.cheat cooldown`, `.cheat power`, `.gm fly` | Bundle a set of toggles applied atomically. |
| 4 | **Quick raid setup** | `.event start`, `.instance unbind all`, `.summon <each bot>`, `.teleport <raid entrance>` | One-click "Open ICC". |
| 5 | **Module-profile presets** | `.reload config` after patching `worldserver.conf` keys | The config patcher edits the file; this is what applies it without a restart for the keys that support live reload. |
| 6 | **Character backup/restore** | `.pdump write <file> <char>` / `.pdump load <file> <account>` | Already supported by the engine — UI just orchestrates the file naming and a "before-experimenting" snapshot button. |

---

*Generated by inspecting `~/wow-server-playerbots/src/server/scripts/Commands/cs_*.cpp` and `~/wow-server-playerbots/modules/mod-playerbots/src/`. Re-run the scan after adding any new module via `manage-wow-modules.sh` — new modules register their own `ChatCommandTable` entries that will not appear here.*

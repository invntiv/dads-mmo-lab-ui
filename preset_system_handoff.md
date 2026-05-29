# WoW 3.3.5a Bot Party Preset System — Project Handoff

## Project Overview

Building a preset-sharing system for a community running local WoW 3.3.5a servers on Steam Decks for solo play. Users have a server management app that supports NPC bots; this format lets people share complete party compositions (4 bots + 1 player slot) via Discord paste-and-parse.

**Goal:** A single TOML block in Discord that the management app parses to spawn bots with specified gear, talents, and glyphs, joining a party with the player.

**Target stack:** 3.3.5a server (TrinityCore/AzerothCore/MaNGOS variant). Steam Deck deployment.

## Core Decisions

### Why TOML

- Human-readable for Discord paste-and-eyeball review
- Battle-tested parsers in every major language
- Supports nested structures and arrays-of-tables natively
- Comments allowed (unlike JSON) — useful for "why this gear" notes from preset authors

### Why include both item ID and name in gear entries

Redundant by design. ID is canonical for the server lookup; name is for human review of the paste. Authors can spot "wait, that's not the right item" without leaving Discord to look up IDs. Names are advisory — IDs are authoritative if they conflict.

### Why array-of-tables for bots (not `bot1`, `bot2`, `bot3`)

`[[party.bots]]` is idiomatic TOML for ordered collections. Iteration is free, no ordinal key invention, and adding/removing bots doesn't require renaming keys.

### Why dotted-key gear (not positional arrays)

Original proposal was `gear = [["head", "Crown of the Tides", 17782], ...]`. Rejected because positional arrays silently break on typo (swapped name and id positions look the same) and aren't self-documenting. Final form:

```toml
[party.bots.gear]
head = { id = 17782, name = "Crown of the Tides" }
```

This makes duplicate slots impossible at the parser level and reads cleanly.

### Why decouple glyphs from the talent URL

Wowhead encodes glyphs as a base-32-ish blob after an underscore in talent calc URLs (e.g., `051003-01-02_001rzx11xtz21xtw31rqr41rqf522j4`). This encoding is undocumented and reverse-engineerable but brittle — if Wowhead changes the scheme, every preset with embedded glyphs breaks. Glyphs are specified as a separate explicit field.

### Why `schema_version` from day one

The first time we add `enchants` or restructure the gear table, every existing Discord preset becomes ambiguous without a version field. Adding versioning later is much harder than starting with it.

## Schema

```toml
schema_version = 1

[preset_info]
name = "Warlock party - Early BRD"
target = { type = "dungeon", name = "BRD" }
author = "DiscordUsername69"

[party.player]
role = "dps"
# Player declares what role they'll fill; bots fill the rest

[[party.bots]]
role = "tank"
level = 54
race = "dwarf"        # optional; random class-appropriate if omitted
faction = "alliance"  # optional; derived from race if omitted
gender = "male"       # optional; random if omitted
name = "Thordrin"     # optional; random if omitted
class = "warrior"
spec = "protection"
talents = "https://www.wowhead.com/wotlk/talent-calc/warrior/051003-01-01"
glyphs = { major = [43395, 43399, 43421], minor = [43395, 43400, 43423] }

[party.bots.gear]
head      = { id = 17782, name = "Crown of the Tides" }
neck      = { id = 11669, name = "Pendant of the Agate Shield" }
shoulder  = { id = 12624, name = "Imperial Plate Shoulders" }
back      = { id = 11623, name = "Tempest Cloak" }
chest     = { id = 12647, name = "Imperial Plate Chest" }
wrist     = { id = 12631, name = "Imperial Plate Bracers" }
hands     = { id = 7488,  name = "Templar Gauntlets of the Bear" }
waist     = { id = 12620, name = "Imperial Plate Belt" }
legs      = { id = 12618, name = "Imperial Plate Leggings" }
feet      = { id = 12616, name = "Imperial Plate Boots" }
finger1   = { id = 11983, name = "Star Ring" }
finger2   = { id = 13160, name = "Heavy Iron Ring of the Bear" }
trinket1  = { id = 18406, name = "Sentinel's Medallion" }
trinket2  = { id = 13965, name = "Mark of Tyranny" }
main_hand = { id = 9425,  name = "Bonebiter" }
off_hand  = { id = 6622,  name = "Aegis of Stormwind" }
ranged    = { id = 2528,  name = "Heavy Throwing Dagger" }

# additional [[party.bots]] blocks for healer, dps1, dps2 follow same shape
```

## Slot Enum

```
head, neck, shoulder, back, chest, shirt, tabard,
wrist, hands, waist, legs, feet,
finger1, finger2, trinket1, trinket2,
main_hand, off_hand, ranged
```

All slots optional. Parser should not require `shirt` or `tabard`. A 2H weapon (staff, 2H sword, etc.) means `off_hand` is omitted — parser should validate this rather than auto-clear.

## Gear: auto vs. explicit (+ fallback)

Gear resolution is intentionally forgiving so a preset always produces a fully-equipped bot, even when item data is partial, wrong, or missing. The ID is the source of truth; `name` is advisory (human-readable only). There are three ways to express a bot's gear:

**1. Fully automatic.** Omit the gear tables entirely, or add the `auto` pseudo-slot. Both mean "let mod-playerbots `autogear` pick the whole outfit for this bot's class/spec/level."

```toml
[[party.bots]]
role = "tank"
class = "warrior"
level = 54
talents = "000000-203023-00000"
spec = "protection"

[party.bots.gear.auto]
# (empty table — apply role/class/talents, auto-gear everything)
```

**2. Mixed (some explicit, rest auto).** Name the slots you care about with an `id`; mark a slot `auto = true` to be explicit about auto-filling it, or just omit it (omitted slots are auto-filled too).

```toml
[party.bots.gear.back]
auto = true                       # explicitly auto-filled

[party.bots.gear.chest]
id = 12647
name = "Imperial Plate Chest"     # advisory; the id wins
```

**3. Fully explicit.** Every slot carries an `id` (the original v1 form).

**Fallback rule (the safety net).** When applying a preset, any explicit slot that fails to equip — wrong slot for the item, item missing from the server's `item_template`, malformed entry, not equippable by that class/level — falls back to the auto-gear kit for that slot. A bot never ends up with *less* gear because of a bad entry; worst case it auto-gears. Unlisted slots are always auto-filled.

> **v1 runtime note:** equipping *specific* items isn't wired yet (mod-playerbots' `outfit equip` only equips items already in the bot's bags, so a specific-gear path needs an item-grant step first). So today every recruited bot is auto-geared on apply regardless of explicit `id`s — i.e. the fallback is currently the *only* path. The schema above is forward-looking; explicit `id`s are parsed, preserved, displayed, and ID↔name-validated now, and will be honored once the equip path lands. `[party.bots.gear.auto]` and `auto = true` are recognized today and suppress the "specific gear isn't applied yet" import warning.

## Talent URL Parsing

Support three input formats from authors:

1. Raw URL: `https://www.wowhead.com/wotlk/talent-calc/warrior/051003-01-01`
2. Markdown link with full path text: `[warrior/051003-01-01](https://www.wowhead.com/wotlk/talent-calc/warrior/051003-01-01)`
3. Markdown link with code-only text: `[051003-01-01](https://www.wowhead.com/wotlk/talent-calc/warrior/051003-01-01)`

**Extraction regex:** `talent-calc/(\w+)/([\d-]+)(?:_(\w+))?`

Captures `[class, talent_string, glyph_blob_optional]`. Discard the glyph_blob — glyphs come from the explicit `glyphs` field, not the URL.

### 3.3.5a vs WotLK Classic compatibility

WotLK Classic and 3.3.5a have functionally identical talent trees. Talent point distribution, prerequisites, and tier requirements are the same — WotLK Classic is based on 3.3.5/3.4 and Blizzard didn't restructure trees in Classic. Minor numerical tweaks (Sunder Armor stack interactions, PvP coefficients) don't affect the calculator structure.

**Caveat to verify before shipping:** If the server's a forked TrinityCore/AzerothCore running a snapshot that pre-dates final 3.3.5a balance, mismatches are possible. Sanity check: export a known character's talents from the server, compare to Wowhead's string for that exact build. Confirm matching before declaring Wowhead-URL parsing canonical.

## Glyph Specification

WotLK has 3 major + 3 minor glyph slots per spec.

By ID (canonical):
```toml
glyphs = { major = [43395, 43399, 43421], minor = [43395, 43400, 43423] }
```

By name (parser resolves against a glyph lookup table):
```toml
glyphs = { major = ["Glyph of Devastate", "Glyph of Cleaving", "Glyph of Last Stand"] }
```

Parser should accept both. If name-based, resolve to IDs at parse time and fail loudly on unknown names.

## Validation Strategy

Liberal parse, strict validation. Two distinct phases:

**Parse phase** (format-level):
- Accept missing optional fields
- Accept extra unknown fields (warn but don't fail — forward-compat for future schema versions)
- Accept name OR ID for items and glyphs

**Validation phase** (game-rules, before bot spawn):
- Class can equip every gear piece (check `item_template.AllowableClass` or equivalent)
- Bot level meets gear `RequiredLevel`
- Race/class combo is valid for the server's expansion
- Talent point total ≤ allowed for level (typically `level - 9`, so 41pts at lvl 50, 71pts at lvl 80 — verify against server config)
- Talent prerequisites satisfied (tier requirements, point investment in prior tiers)
- Glyphs match class
- Faction-appropriate items where flagged

Surface validation errors with enough context to fix the preset ("bot[2] gear.chest: item 15064 requires level 54, bot is level 52"), not just "invalid."

## Open Items for Next Agent

1. **Verify item IDs in the example preset.** The example was authored from memory; some IDs may be slightly off. Cross-reference against the server's `item_template` table before treating as a canonical test fixture.
2. **Glyph encoding decision.** If we eventually want to *import* glyphs from a pasted Wowhead URL (some users will paste with embedded glyphs), we'll need to reverse the base-32-ish encoding. Defer until requested by a user.
3. **Server integration mechanism.** How does the management app actually inject bots into a running game session? Options:
   - SOAP commands to worldserver
   - Custom worldserver patch
   - Existing bot framework (Eluna, Playerbot AI fork, NPCBots)
   This determines what concrete data shape the parser hands off — character creation params, item slot assignments, talent point allocations.
4. **Enchants and gems (v2 schema).** Not in v1, but planned. Suggested shape, keeping current gear structure extendable:
   ```toml
   head = { id = 17782, name = "Crown of the Tides", enchant_id = 2563, gems = [40014, 40014] }
   ```
5. **Preset library metadata.** Once a library of presets exists, browsing needs more fields. Likely additions: `tags = ["pre-raid", "leveling", "speedrun"]`, `min_player_level`, `max_player_level`, `difficulty = "normal" | "heroic"`.
6. **Multi-target support.** Current `target` assumes one destination. A raid prep preset might cover multiple:
   ```toml
   target = [{ type = "raid", name = "MC" }, { type = "raid", name = "BWL" }]
   ```
7. **Bot AI directives.** Future scope: should preset specify behavior hints? (`tank_style = "aggressive"`, `healer_priority = "tank_first"`, `kite_threshold = 0.3`). Depends on the bot framework's capabilities.

## Reference: Full 4-bot example (BRD pre-progression, warlock as player)

Bots represent characters around level 52-55 who've cleared Maraudon, Zul'Farrak, Sunken Temple, and some Plaguelands quests, running BRD for the first time. Heavy mix of dungeon blues, quest rewards, and "of the Bear/Eagle/Monkey" greens.

Save as `examples/brd_early_warlock.toml`:

```toml
schema_version = 1

[preset_info]
name = "Warlock party - Early BRD"
target = { type = "dungeon", name = "BRD" }
author = "DiscordUsername69"

[party.player]
role = "dps"

[[party.bots]]
role = "tank"
level = 54
class = "warrior"
spec = "protection"
talents = "https://www.wowhead.com/wotlk/talent-calc/warrior/000000-203023-00000"

[party.bots.gear]
head      = { id = 17782, name = "Crown of the Tides" }
neck      = { id = 11669, name = "Pendant of the Agate Shield" }
shoulder  = { id = 12624, name = "Imperial Plate Shoulders" }
back      = { id = 11623, name = "Tempest Cloak" }
chest     = { id = 12647, name = "Imperial Plate Chest" }
wrist     = { id = 12631, name = "Imperial Plate Bracers" }
hands     = { id = 7488,  name = "Templar Gauntlets of the Bear" }
waist     = { id = 12620, name = "Imperial Plate Belt" }
legs      = { id = 12618, name = "Imperial Plate Leggings" }
feet      = { id = 12616, name = "Imperial Plate Boots" }
finger1   = { id = 11983, name = "Star Ring" }
finger2   = { id = 13160, name = "Heavy Iron Ring of the Bear" }
trinket1  = { id = 18406, name = "Sentinel's Medallion" }
trinket2  = { id = 13965, name = "Mark of Tyranny" }
main_hand = { id = 9425,  name = "Bonebiter" }
off_hand  = { id = 6622,  name = "Aegis of Stormwind" }
ranged    = { id = 2528,  name = "Heavy Throwing Dagger" }

[[party.bots]]
role = "healer"
level = 53
class = "priest"
spec = "holy"
talents = "https://www.wowhead.com/wotlk/talent-calc/priest/203020-00000-00000"

[party.bots.gear]
head      = { id = 10399, name = "Embroidered Hood of Healing" }
neck      = { id = 9395,  name = "Pendant of Wisdom" }
shoulder  = { id = 17744, name = "Cyclone Spaulders" }
back      = { id = 13386, name = "Sage's Cloak of Healing" }
chest     = { id = 10785, name = "Robes of the Royal Crown" }
wrist     = { id = 10796, name = "Magefist Bracers" }
hands     = { id = 10788, name = "Embroidered Gloves of the Eagle" }
waist     = { id = 9485,  name = "Padre's Sash" }
legs      = { id = 10780, name = "Astral Knot Skirt" }
feet      = { id = 10751, name = "Cleric's Boots" }
finger1   = { id = 11983, name = "Aquamarine Ring of the Eagle" }
finger2   = { id = 11984, name = "Pendant Ring of Healing" }
trinket1  = { id = 10781, name = "Tooth of Eranikus" }
trinket2  = { id = 11810, name = "Royal Seal of Eldre'Thalas" }
main_hand = { id = 10818, name = "Hex of Jammal'an" }
off_hand  = { id = 5202,  name = "Tome of Knowledge" }
ranged    = { id = 10797, name = "Wand of Eternal Light" }

[[party.bots]]
role = "dps"
level = 54
class = "rogue"
spec = "combat"
talents = "https://www.wowhead.com/wotlk/talent-calc/rogue/00000-203023-00000"

[party.bots.gear]
head      = { id = 9405,  name = "Bad Mojo Mask" }
neck      = { id = 11923, name = "Heroic Choker" }
shoulder  = { id = 7397,  name = "Buzzard Spaulders of the Monkey" }
back      = { id = 13386, name = "Wolf Rider's Cloak of the Monkey" }
chest     = { id = 15064, name = "Devilsaur Tunic" }
wrist     = { id = 11825, name = "Buzzard Bracers of the Eagle" }
hands     = { id = 8198,  name = "Wolf Rider's Gloves" }
waist     = { id = 9929,  name = "Sash of the Grand Hunt" }
legs      = { id = 15063, name = "Devilsaur Leggings" }
feet      = { id = 9926,  name = "Wanderer's Boots" }
finger1   = { id = 12013, name = "Star Ring" }
finger2   = { id = 9404,  name = "Sandfury Signet" }
trinket1  = { id = 18406, name = "Insignia of the Horde" }
trinket2  = { id = 13965, name = "Mark of Tyranny" }
main_hand = { id = 17744, name = "Distracting Dagger" }
off_hand  = { id = 10761, name = "Coldrage Dagger" }
ranged    = { id = 2491,  name = "Heavy Bronze Crossbow" }

[[party.bots]]
role = "dps"
level = 53
class = "mage"
spec = "frost"
talents = "https://www.wowhead.com/wotlk/talent-calc/mage/00000-00000-203023"

[party.bots.gear]
head      = { id = 10399, name = "Wizard's Crown of Arcane Wrath" }
neck      = { id = 9395,  name = "Pendant of Wisdom" }
shoulder  = { id = 10406, name = "Magician's Mantle" }
back      = { id = 13386, name = "Spritekin Cloak of Arcane Wrath" }
chest     = { id = 10785, name = "Astral Knot Robes" }
wrist     = { id = 10796, name = "Magefist Bracers" }
hands     = { id = 10788, name = "Astral Knot Gloves" }
waist     = { id = 10789, name = "Astral Knot Sash" }
legs      = { id = 10780, name = "Astral Knot Pants" }
feet      = { id = 10751, name = "Astral Knot Slippers" }
finger1   = { id = 11983, name = "Burning Star Ring" }
finger2   = { id = 11984, name = "Mageweave Band of Arcane Wrath" }
trinket1  = { id = 18406, name = "Insignia of the Horde" }
trinket2  = { id = 13965, name = "Mark of Tyranny" }
main_hand = { id = 17713, name = "Resurgence Rod" }
ranged    = { id = 10797, name = "Greater Magic Wand" }
```

Item IDs in this example were authored from memory and need verification against the server's `item_template` table before being treated as canonical test data. Talent strings are placeholders — replace with real builds during validation testing.

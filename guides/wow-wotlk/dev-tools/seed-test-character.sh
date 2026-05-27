#!/bin/bash
# ============================================================
# seed-test-character.sh — pad a fresh character with rows in
# every table the Character Backup feature touches, so a
# backup → delete → restore round-trip has something to verify.
#
# Usage:
#   ./seed-test-character.sh <character_guid>
#
# The character should be freshly created in-game (level 1). The
# script boosts a few stats + scatters rows across:
#   characters (level, money, totals)
#   character_inventory + item_instance (5 bag items)
#   character_skills (4 skills: first aid / cooking / fishing / riding)
#   character_reputation (4 factions)
#   character_talent (5 spec rows)
#   character_spell (8 known spells)
#   character_homebind (Stormwind)
#   character_action (3 hotbar bindings)
#   character_aura (2 buffs)
#   character_queststatus (2 active quests)
#   character_queststatus_rewarded (3 completed quests)
#   mail + mail_items (1 mail with 1 attachment)
#
# All IDs used are well-known AC defaults that exist in the
# default-world DB so the character won't break on login.
# Re-running for the same guid is idempotent (INSERT IGNORE +
# unique keys mean dupes silently skip).
# ============================================================

set -euo pipefail

GUID="${1:?Usage: $0 <character_guid>}"

CONTAINER=""
for name in $(docker ps --format '{{.Names}}'); do
    case "$(echo "$name" | tr '[:upper:]' '[:lower:]')" in
        *database*) CONTAINER="$name"; break;;
    esac
done
if [ -z "$CONTAINER" ]; then
    echo "ERR: ac-database container not found — is the server running?" >&2
    exit 1
fi

mysql_exec() {
    docker exec -i "$CONTAINER" mysql -uroot -ppassword acore_characters
}

mysql_query() {
    docker exec "$CONTAINER" mysql -uroot -ppassword -N -B -e "$1"
}

# ── Sanity: character exists, not a bot ────────────────────────────
NAME=$(mysql_query "SELECT name FROM acore_characters.characters WHERE guid = $GUID;")
if [ -z "$NAME" ]; then
    echo "ERR: character $GUID not found" >&2
    exit 1
fi
IS_BOT=$(mysql_query "
    SELECT COUNT(*) FROM acore_characters.characters c
    JOIN acore_playerbots.playerbots_account_type t ON t.account_id = c.account
    WHERE c.guid = $GUID;
")
if [ "$IS_BOT" != "0" ]; then
    echo "ERR: $NAME (guid $GUID) is a bot account character — pick a real one" >&2
    exit 1
fi
echo "Seeding $NAME (guid $GUID)..."

# ── characters: level + money + totals ─────────────────────────────
mysql_exec <<EOF
UPDATE characters SET
    level = 60,
    money = 5000000,                 -- 500g
    totalKills = 250,
    totalHonorPoints = 1500,
    arenaPoints = 200
WHERE guid = $GUID;
EOF

# ── Items: 5 stack of common items in bag 0 slots 23-27 ────────────
# item_instance.guid is auto-incremented in default AC. Reserve a
# high baseline tied to the char guid to avoid clashes if seed is
# rerun for multiple chars.
ITEM_BASE=$((90000000 + GUID * 100))
mysql_exec <<EOF
-- item_instance rows: itemEntry uses well-known AC item IDs.
INSERT IGNORE INTO item_instance
    (guid, itemEntry, owner_guid, count, creatorGuid, giftCreatorGuid, duration, charges, flags, enchantments, randomPropertyId, durability, playedTime)
VALUES
    ($ITEM_BASE+1, 6948, $GUID, 1, 0, 0, 0, 0, 0, '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ', 0, 0, 0),  -- Hearthstone
    ($ITEM_BASE+2, 159,  $GUID, 5, 0, 0, 0, 0, 0, '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ', 0, 0, 0),  -- Refreshing Spring Water x5
    ($ITEM_BASE+3, 4540, $GUID, 5, 0, 0, 0, 0, 0, '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ', 0, 0, 0),  -- Tough Hunk of Bread x5
    ($ITEM_BASE+4, 2589, $GUID, 10,0, 0, 0, 0, 0, '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ', 0, 0, 0),  -- Linen Cloth x10
    ($ITEM_BASE+5, 117,  $GUID, 3, 0, 0, 0, 0, 0, '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ', 0, 0, 0);  -- Tough Jerky x3

INSERT IGNORE INTO character_inventory (guid, bag, slot, item) VALUES
    ($GUID, 0, 23, $ITEM_BASE+1),
    ($GUID, 0, 24, $ITEM_BASE+2),
    ($GUID, 0, 25, $ITEM_BASE+3),
    ($GUID, 0, 26, $ITEM_BASE+4),
    ($GUID, 0, 27, $ITEM_BASE+5);
EOF

# ── Skills: First Aid, Cooking, Fishing, Riding ───────────────────
mysql_exec <<EOF
INSERT IGNORE INTO character_skills (guid, skill, value, max) VALUES
    ($GUID, 129, 225, 300),   -- First Aid
    ($GUID, 185, 250, 300),   -- Cooking
    ($GUID, 356, 225, 300),   -- Fishing
    ($GUID, 762, 150, 150);   -- Riding (apprentice)
EOF

# ── Reputation: 4 factions ────────────────────────────────────────
mysql_exec <<EOF
INSERT IGNORE INTO character_reputation (guid, faction, standing, flags) VALUES
    ($GUID, 47,  3000, 0),    -- Ironforge
    ($GUID, 54,  2500, 0),    -- Gnomeregan Exiles
    ($GUID, 21,  6000, 0),    -- Booty Bay
    ($GUID, 69,  -500, 0);    -- Darnassus (unfriendly)
EOF

# ── Talents: 5 generic Mage Frost rows (works for Mage chars; for
# other classes these spell IDs still insert cleanly — they just
# don't affect the actual talent grid on login until the player
# resets talents) ─────────────────────────────────────────────────
mysql_exec <<EOF
INSERT IGNORE INTO character_talent (guid, spell, specMask) VALUES
    ($GUID, 11071, 1),    -- Frost Warding
    ($GUID, 11070, 1),    -- Slow Fall improvement
    ($GUID, 11189, 1),    -- Frostbite
    ($GUID, 11207, 1),    -- Improved Frostbolt
    ($GUID, 11185, 1);    -- Improved Frost Nova
EOF

# ── Spells: 8 well-known spells ───────────────────────────────────
mysql_exec <<EOF
INSERT IGNORE INTO character_spell (guid, spell, specMask) VALUES
    ($GUID, 81,    255),    -- Dodge
    ($GUID, 522,   255),    -- SPELLDEFENSE (DND)
    ($GUID, 668,   255),    -- Language Common
    ($GUID, 2382,  255),    -- Generic
    ($GUID, 3050,  255),    -- Detect
    ($GUID, 5009,  255),    -- Wands
    ($GUID, 7266,  255),    -- Duel
    ($GUID, 8386,  255);    -- Attacking
EOF

# ── Homebind: Stormwind Trade District ────────────────────────────
mysql_exec <<EOF
INSERT IGNORE INTO character_homebind (guid, mapId, zoneId, posX, posY, posZ) VALUES
    ($GUID, 0, 1519, -8833.38, 628.628, 94.0066);
EOF

# ── Action bar: 3 bindings ────────────────────────────────────────
mysql_exec <<EOF
INSERT IGNORE INTO character_action (guid, spec, button, action, type) VALUES
    ($GUID, 0, 0, 6603, 0),   -- Attack
    ($GUID, 0, 1, 81,   0),   -- Dodge
    ($GUID, 0, 2, 522,  0);   -- SPELLDEFENSE
EOF

# ── Auras: 2 buffs ────────────────────────────────────────────────
mysql_exec <<EOF
-- Use real buff spells with no movement/control side-effects. Earlier
-- placeholders (spell 25, 79) turned out to be stun effects — the
-- char logged in immobilized and surrounded by ice. These are visible
-- but harmless cosmetic buffs.
INSERT IGNORE INTO character_aura (guid, casterGuid, itemGuid, spell, effectMask, recalculateMask, stackCount, amount0, amount1, amount2, base_amount0, base_amount1, base_amount2, maxDuration, remainTime, remainCharges) VALUES
    ($GUID, $GUID, 0, 1126,  7, 0, 1, 0, 0, 0, 0, 0, 0, -1, -1, 0),    -- Mark of the Wild (rank 1)
    ($GUID, $GUID, 0, 21562, 1, 0, 1, 0, 0, 0, 0, 0, 0, -1, -1, 0);    -- Power Word: Fortitude (rank 6)
EOF

# ── Quests: 2 active + 3 rewarded ─────────────────────────────────
mysql_exec <<EOF
INSERT IGNORE INTO character_queststatus (guid, quest, status, explored, timer, mobcount1, mobcount2, mobcount3, mobcount4, itemcount1, itemcount2, itemcount3, itemcount4, itemcount5, itemcount6, playercount) VALUES
    ($GUID, 3, 3, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),  -- A Threat Within
    ($GUID, 36, 3, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0); -- The Dwarven Spy

INSERT IGNORE INTO character_queststatus_rewarded (guid, quest, active) VALUES
    ($GUID, 1, 1),     -- A Threat Within (turned in)
    ($GUID, 2, 1),     -- The Killing Fields
    ($GUID, 14, 1);    -- A New Threat
EOF

# ── Mail: 1 mail with 1 item attachment ───────────────────────────
MAIL_ID=$((50000000 + GUID))
mysql_exec <<EOF
INSERT IGNORE INTO mail
    (id, messageType, stationery, mailTemplateId, sender, receiver, subject, body, has_items, expire_time, deliver_time, money, cod, checked)
VALUES
    ($MAIL_ID, 0, 41, 0, $GUID, $GUID, 'Test: seed mail', 'Sent by seed-test-character.sh — body for backup test.', 1, $(($(date +%s) + 2592000)), $(date +%s), 100000, 0, 0);

-- Allocate one more item_instance for the mail attachment.
INSERT IGNORE INTO item_instance
    (guid, itemEntry, owner_guid, count, creatorGuid, giftCreatorGuid, duration, charges, flags, enchantments, randomPropertyId, durability, playedTime)
VALUES
    ($ITEM_BASE+6, 6948, $GUID, 1, 0, 0, 0, 0, 0, '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ', 0, 0, 0);

INSERT IGNORE INTO mail_items (mail_id, item_guid, receiver) VALUES
    ($MAIL_ID, $ITEM_BASE+6, $GUID);
EOF

# ── Summary ───────────────────────────────────────────────────────
echo
echo "Done. Row counts for $NAME:"
docker exec "$CONTAINER" mysql -uroot -ppassword -N -B -e "
SELECT 'characters'             AS tbl, COUNT(*) FROM acore_characters.characters WHERE guid = $GUID
UNION ALL SELECT 'character_inventory',         COUNT(*) FROM acore_characters.character_inventory WHERE guid = $GUID
UNION ALL SELECT 'item_instance',               COUNT(*) FROM acore_characters.item_instance WHERE owner_guid = $GUID
UNION ALL SELECT 'character_skills',            COUNT(*) FROM acore_characters.character_skills WHERE guid = $GUID
UNION ALL SELECT 'character_reputation',        COUNT(*) FROM acore_characters.character_reputation WHERE guid = $GUID
UNION ALL SELECT 'character_talent',            COUNT(*) FROM acore_characters.character_talent WHERE guid = $GUID
UNION ALL SELECT 'character_spell',             COUNT(*) FROM acore_characters.character_spell WHERE guid = $GUID
UNION ALL SELECT 'character_homebind',          COUNT(*) FROM acore_characters.character_homebind WHERE guid = $GUID
UNION ALL SELECT 'character_action',            COUNT(*) FROM acore_characters.character_action WHERE guid = $GUID
UNION ALL SELECT 'character_aura',              COUNT(*) FROM acore_characters.character_aura WHERE guid = $GUID
UNION ALL SELECT 'character_queststatus',       COUNT(*) FROM acore_characters.character_queststatus WHERE guid = $GUID
UNION ALL SELECT 'character_queststatus_rewarded',COUNT(*) FROM acore_characters.character_queststatus_rewarded WHERE guid = $GUID
UNION ALL SELECT 'mail',                        COUNT(*) FROM acore_characters.mail WHERE receiver = $GUID
UNION ALL SELECT 'mail_items',                  COUNT(*) FROM acore_characters.mail_items WHERE receiver = $GUID;
"

echo
echo "Now in The Lab:"
echo "  1. Settings → Character Management → Back up characters"
echo "  2. Pick $NAME, save the .dmlbak file"
echo "  3. Delete $NAME in-game (or via your preferred method)"
echo "  4. Settings → Character Management → Restore characters"
echo "  5. Re-run this script's row-count query above to verify everything came back"

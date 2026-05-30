#!/usr/bin/env bash
#
# fetch-talent-backgrounds.sh — one-off asset grabber
#
# Downloads the WotLK talent-tree spec background art from Wowhead's CDN
# into src/assets/talent-spec-backgrounds/, named <class>_<spec>.jpg so a
# human (and the TS background map) can tell which goes where.
#
# The numbers below ARE Wowhead's talent "tabId" — the same value our
# bundled talent-trees.json stores per tree, so talent-spec-backgrounds.ts
# can key off tab.tabId with zero translation.
#
# Run from anywhere:  bash scripts/fetch-talent-backgrounds.sh
#
set -o pipefail

BASE="https://wow.zamimg.com/images/wow/talents/backgrounds/wrath"
DEST="$(cd "$(dirname "$0")/.." && pwd)/src/assets/talent-spec-backgrounds"
mkdir -p "$DEST"

# <output name>=<wowhead tabId / filename number>
declare -A SPECS=(
  [warrior_arms]=161  [warrior_fury]=164  [warrior_protection]=163
  [dk_blood]=398      [dk_frost]=399      [dk_unholy]=400
  [druid_balance]=283 [druid_feral]=281   [druid_restoration]=282
  [hunter_bm]=361     [hunter_marksmanship]=363 [hunter_survival]=362
  [mage_arcane]=81    [mage_fire]=41      [mage_frost]=61
  [paladin_holy]=382  [paladin_prot]=383  [paladin_retribution]=381
  [priest_discipline]=201 [priest_holy]=202 [priest_shadow]=203
  [rogue_assassination]=182 [rogue_combat]=181 [rogue_subtlety]=183
  [shaman_elemental]=261 [shaman_enhancement]=263 [shaman_restoration]=262
  [warlock_affliction]=302 [warlock_demonology]=303 [warlock_destruction]=301
)

fail=0
for name in "${!SPECS[@]}"; do
  num="${SPECS[$name]}"
  if curl -fsSL "$BASE/$num.jpg" -o "$DEST/$name.jpg"; then
    echo "  ✓ $name.jpg  (←$num)"
  else
    echo "  ✗ $name.jpg  (←$num)  FAILED" >&2
    fail=1
  fi
done

echo "Saved to $DEST"
exit $fail

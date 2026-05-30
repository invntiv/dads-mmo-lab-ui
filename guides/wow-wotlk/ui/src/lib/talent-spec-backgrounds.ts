/**
 * Spec background art for the talent trees.
 *
 * Keyed by talent `tabId` — the same value talent-trees.json stores per
 * tree (and the same number Wowhead names its background file after), so
 * a tree column just looks up `SPEC_BACKGROUNDS[tab.tabId]`.
 *
 * Art fetched by scripts/fetch-talent-backgrounds.sh from Wowhead's CDN.
 */
import warrior_arms from "@/assets/talent-spec-backgrounds/warrior_arms.jpg"
import warrior_fury from "@/assets/talent-spec-backgrounds/warrior_fury.jpg"
import warrior_protection from "@/assets/talent-spec-backgrounds/warrior_protection.jpg"
import dk_blood from "@/assets/talent-spec-backgrounds/dk_blood.jpg"
import dk_frost from "@/assets/talent-spec-backgrounds/dk_frost.jpg"
import dk_unholy from "@/assets/talent-spec-backgrounds/dk_unholy.jpg"
import druid_balance from "@/assets/talent-spec-backgrounds/druid_balance.jpg"
import druid_feral from "@/assets/talent-spec-backgrounds/druid_feral.jpg"
import druid_restoration from "@/assets/talent-spec-backgrounds/druid_restoration.jpg"
import hunter_bm from "@/assets/talent-spec-backgrounds/hunter_bm.jpg"
import hunter_marksmanship from "@/assets/talent-spec-backgrounds/hunter_marksmanship.jpg"
import hunter_survival from "@/assets/talent-spec-backgrounds/hunter_survival.jpg"
import mage_arcane from "@/assets/talent-spec-backgrounds/mage_arcane.jpg"
import mage_fire from "@/assets/talent-spec-backgrounds/mage_fire.jpg"
import mage_frost from "@/assets/talent-spec-backgrounds/mage_frost.jpg"
import paladin_holy from "@/assets/talent-spec-backgrounds/paladin_holy.jpg"
import paladin_prot from "@/assets/talent-spec-backgrounds/paladin_prot.jpg"
import paladin_retribution from "@/assets/talent-spec-backgrounds/paladin_retribution.jpg"
import priest_discipline from "@/assets/talent-spec-backgrounds/priest_discipline.jpg"
import priest_holy from "@/assets/talent-spec-backgrounds/priest_holy.jpg"
import priest_shadow from "@/assets/talent-spec-backgrounds/priest_shadow.jpg"
import rogue_assassination from "@/assets/talent-spec-backgrounds/rogue_assassination.jpg"
import rogue_combat from "@/assets/talent-spec-backgrounds/rogue_combat.jpg"
import rogue_subtlety from "@/assets/talent-spec-backgrounds/rogue_subtlety.jpg"
import shaman_elemental from "@/assets/talent-spec-backgrounds/shaman_elemental.jpg"
import shaman_enhancement from "@/assets/talent-spec-backgrounds/shaman_enhancement.jpg"
import shaman_restoration from "@/assets/talent-spec-backgrounds/shaman_restoration.jpg"
import warlock_affliction from "@/assets/talent-spec-backgrounds/warlock_affliction.jpg"
import warlock_demonology from "@/assets/talent-spec-backgrounds/warlock_demonology.jpg"
import warlock_destruction from "@/assets/talent-spec-backgrounds/warlock_destruction.jpg"

/** talent tabId → background image url */
export const SPEC_BACKGROUNDS: Record<number, string> = {
  161: warrior_arms,
  164: warrior_fury,
  163: warrior_protection,
  398: dk_blood,
  399: dk_frost,
  400: dk_unholy,
  283: druid_balance,
  281: druid_feral,
  282: druid_restoration,
  361: hunter_bm,
  363: hunter_marksmanship,
  362: hunter_survival,
  81: mage_arcane,
  41: mage_fire,
  61: mage_frost,
  382: paladin_holy,
  383: paladin_prot,
  381: paladin_retribution,
  201: priest_discipline,
  202: priest_holy,
  203: priest_shadow,
  182: rogue_assassination,
  181: rogue_combat,
  183: rogue_subtlety,
  261: shaman_elemental,
  263: shaman_enhancement,
  262: shaman_restoration,
  302: warlock_affliction,
  303: warlock_demonology,
  301: warlock_destruction,
}

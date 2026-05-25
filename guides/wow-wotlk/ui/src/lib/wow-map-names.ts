/**
 * Map ID → display name for the WoW 3.3.5a maps a player or bot can
 * legitimately stand in. Source: AzerothCore Map.dbc rows that exist
 * in 3.3.5a. Hardcoded rather than DBC-extracted because: data never
 * changes for 3.3.5a, no setup step required, falls back gracefully
 * for any id we missed.
 *
 * If we ever target Cata+ content we'll either extend this table or
 * swap to a DBC extraction at that point.
 */

export const MAP_NAMES: Record<number, string> = {
  // Continents
  0: "Eastern Kingdoms",
  1: "Kalimdor",
  530: "Outland",
  571: "Northrend",

  // Vanilla dungeons
  33: "Shadowfang Keep",
  34: "The Stockade",
  36: "Deadmines",
  43: "Wailing Caverns",
  47: "Razorfen Kraul",
  48: "Blackfathom Deeps",
  70: "Uldaman",
  90: "Gnomeregan",
  109: "Sunken Temple",
  129: "Razorfen Downs",
  189: "Scarlet Monastery",
  209: "Zul'Farrak",
  229: "Blackrock Spire",
  230: "Blackrock Depths",
  289: "Scholomance",
  329: "Stratholme",
  349: "Maraudon",
  389: "Ragefire Chasm",
  429: "Dire Maul",

  // Vanilla raids
  249: "Onyxia's Lair",
  309: "Zul'Gurub",
  409: "Molten Core",
  469: "Blackwing Lair",
  509: "Ruins of Ahn'Qiraj",
  531: "Temple of Ahn'Qiraj",
  533: "Naxxramas",

  // Battlegrounds + arenas
  30: "Alterac Valley",
  489: "Warsong Gulch",
  529: "Arathi Basin",
  559: "Nagrand Arena",
  562: "Blade's Edge Arena",
  566: "Eye of the Storm",
  572: "Ruins of Lordaeron",
  607: "Strand of the Ancients",
  617: "Dalaran Sewers",
  618: "Ring of Valor",
  628: "Isle of Conquest",

  // TBC dungeons
  269: "Caverns of Time",
  540: "The Shattered Halls",
  542: "The Blood Furnace",
  543: "Hellfire Ramparts",
  545: "The Steamvault",
  546: "The Underbog",
  547: "The Slave Pens",
  552: "The Arcatraz",
  553: "The Botanica",
  554: "The Mechanar",
  555: "Shadow Labyrinth",
  556: "Sethekk Halls",
  557: "Mana-Tombs",
  558: "Auchenai Crypts",
  560: "Old Hillsbrad Foothills",
  585: "Magister's Terrace",
  595: "Culling of Stratholme",

  // TBC raids
  532: "Karazhan",
  534: "Battle for Mount Hyjal",
  544: "Magtheridon's Lair",
  548: "Serpentshrine Cavern",
  550: "The Eye",
  564: "Black Temple",
  565: "Gruul's Lair",
  568: "Zul'Aman",
  580: "Sunwell Plateau",

  // WotLK dungeons
  574: "Utgarde Keep",
  575: "Utgarde Pinnacle",
  576: "The Nexus",
  578: "The Oculus",
  599: "Halls of Stone",
  600: "Drak'Tharon Keep",
  601: "Ahn'kahet: The Old Kingdom",
  602: "Halls of Lightning",
  604: "Gundrak",
  608: "Violet Hold",
  619: "Azjol-Nerub",
  632: "The Forge of Souls",
  650: "Trial of the Champion",
  658: "Pit of Saron",
  668: "Halls of Reflection",

  // WotLK raids (note: WotLK's Onyxia's Lair re-uses map id 249 above)
  603: "Ulduar",
  615: "The Obsidian Sanctum",
  616: "The Eye of Eternity",
  624: "Vault of Archavon",
  631: "Icecrown Citadel",
  649: "Trial of the Crusader",
  724: "The Ruby Sanctum",

  // Class starting / special
  609: "Ebon Hold",
}

/** Look up a map name with a sane fallback. Pass `null`/`undefined`
 *  for "no map" to get an empty string (useful for pool bots that
 *  haven't been positioned yet). */
export function mapName(id: number | null | undefined): string {
  if (id == null) return ""
  return MAP_NAMES[id] ?? `Map #${id}`
}

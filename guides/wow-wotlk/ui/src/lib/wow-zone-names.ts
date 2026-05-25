/**
 * Zone ID → display name. Sourced from AreaTable.dbc, covers the
 * top-level zones a character or bot routinely occupies. Sub-zones
 * (Goldshire, etc.) are intentionally omitted — the chardb stores the
 * parent zone for bots most of the time, and a 3k-entry table would
 * be much heavier maintenance for diminishing returns.
 *
 * Zone id 0 = unset (common for pool bots that have never been in the
 * world). Caller should suppress display for 0 rather than render a
 * misleading placeholder.
 */

export const ZONE_NAMES: Record<number, string> = {
  // Eastern Kingdoms
  1: "Dun Morogh",
  3: "Badlands",
  4: "Blasted Lands",
  8: "Swamp of Sorrows",
  10: "Duskwood",
  11: "Wetlands",
  12: "Elwynn Forest",
  25: "Blackrock Mountain",
  28: "Western Plaguelands",
  33: "Stranglethorn Vale",
  36: "Alterac Mountains",
  38: "Loch Modan",
  40: "Westfall",
  41: "Deadwind Pass",
  44: "Redridge Mountains",
  45: "Arathi Highlands",
  46: "Burning Steppes",
  47: "The Hinterlands",
  51: "Searing Gorge",
  85: "Tirisfal Glades",
  130: "Silverpine Forest",
  139: "Eastern Plaguelands",
  267: "Hillsbrad Foothills",
  1497: "Undercity",
  1519: "Stormwind City",
  1537: "Ironforge",
  1581: "The Deadmines",
  3430: "Eversong Woods",
  3433: "Ghostlands",
  3487: "Silvermoon City",

  // Kalimdor
  14: "Durotar",
  15: "Dustwallow Marsh",
  16: "Azshara",
  17: "The Barrens",
  141: "Teldrassil",
  148: "Darkshore",
  215: "Mulgore",
  331: "Ashenvale",
  357: "Feralas",
  361: "Felwood",
  400: "Thousand Needles",
  405: "Desolace",
  406: "Stonetalon Mountains",
  440: "Tanaris",
  490: "Un'Goro Crater",
  493: "Moonglade",
  618: "Winterspring",
  796: "Scarlet Monastery",
  1377: "Silithus",
  1637: "Orgrimmar",
  1638: "Thunder Bluff",
  1657: "Darnassus",
  3524: "Azuremyst Isle",
  3525: "Bloodmyst Isle",
  3557: "The Exodar",

  // Outland
  3483: "Hellfire Peninsula",
  3518: "Nagrand",
  3519: "Terokkar Forest",
  3520: "Shadowmoon Valley",
  3521: "Zangarmarsh",
  3522: "Blade's Edge Mountains",
  3523: "Netherstorm",
  3703: "Shattrath City",

  // Northrend
  65: "Dragonblight",
  66: "Zul'Drak",
  67: "The Storm Peaks",
  210: "Icecrown",
  394: "Grizzly Hills",
  495: "Howling Fjord",
  2817: "Crystalsong Forest",
  3537: "Borean Tundra",
  3711: "Sholazar Basin",
  4197: "Wintergrasp",
  4395: "Dalaran",

  // Common instance-zones (zone ids that some dungeons report
  // alongside their map id)
  2017: "Stratholme",
  2057: "Scholomance",
  4196: "Dalaran",
}

/** Look up a zone name. Returns null for unset/id-0 so the caller
 *  can suppress display cleanly. Returns "Zone #N" for unknowns so
 *  the user sees the raw id rather than nothing. */
export function zoneName(id: number | null | undefined): string | null {
  if (id == null || id === 0) return null
  return ZONE_NAMES[id] ?? `Zone #${id}`
}

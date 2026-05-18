# Future-work ideas

Scratchpad for "we should build this someday" things — captured as
they come up so we don't lose them. Promote into a proper plan when
ready to execute.

---

## Skip DK Starter (one-button graduate-out-of-Acherus)

**Problem:** Death Knights spawn at level 55 in the Plaguelands: Scarlet
Enclave (map 609) and are physically blocked from leaving by AC's
`Player::TeleportTo()` Lich-King-grasp check until they finish the
~20-quest starter chain. Even GM/SOAP teleports refuse. For a server
focused on power-fantasy / endgame play, this is a real onboarding
papercut for the one class people most want to try.

**Feature:** A "Skip DK Starter" button on the character dashboard
that *only renders* when the selected character is:
- `class = 6` (Death Knight)
- `level = 55`
- `map = 609` (still in Acherus starting zone)

Clicking it:

1. `.quest complete 12801` ("The Light of Dawn") — flips the
   escaped-Lich-King flag, removing the teleport block.
2. `.quest complete 13188` (Alliance race mask 1101) **or** `13189`
   (Horde race mask 690) based on `characters.race` — the canonical
   chain finisher that sends the DK to Stormwind Keep / Orgrimmar
   Hall of Legends respectively.
3. `.tele name <char> Stormwind` or `Orgrimmar` as a safety net in
   case the quest-complete handoff doesn't auto-teleport offline
   characters.
4. **Optional toggle in the popover:** "Award starter gear too" —
   `.additem` the Acherus knight set pieces and matching tabard so
   the player isn't naked at level 55. Quest 12801's natural reward
   is one of two choice items (entry 38632 / 38633) plus 3.33g
   (`RewardMoney = 33300` copper), which we'd grant via `.send items`
   + `.modify money 33300`. Items earlier in the chain are the full
   green-quality "Acherus" gear set — also automatable.

**Why it's a great Dad-MMO-Lab feature:** the user already explicitly
chose to skip the leveling experience (they're on a private offline
server with bots + GM tools). Forcing them through a 30-min
phased-zone questline before they can play with friends is the
opposite of what this app is for.

**Race → faction mapping** (already in `wow-character-enums.ts`):
- Alliance: Human, Dwarf, Night Elf, Gnome, Draenei
- Horde: Orc, Undead, Tauren, Troll, Blood Elf

**Implementation notes:**
- All four commands go through the existing SOAP plumbing in
  [`soap.rs`](guides/wow-wotlk/ui/src-tauri/src/soap.rs).
- Backend command shape: `gm_skip_dk_starter(guid, include_gear: bool)`.
- New Tauri command + a popover on the paperdoll status header that
  shows up only when the character meets the criteria above.
- Refresh the character paperdoll after success so the new
  location + items appear immediately.

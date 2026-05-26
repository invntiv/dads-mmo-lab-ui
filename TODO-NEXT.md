# TODO — next session

## ✅ Done at end of last session
- Final syntax check on install-wow.sh — `bash -n` clean
- Added 13 `AC_AI_PLAYERBOT_*` env vars to both install-wow.sh's
  override.yml heredoc AND the user's live override
  (~/wow-server-playerbots/docker-compose.override.yml)
- Worldserver recreated, original 13 warnings (AutoPickTalents,
  AltMaintenance*, LimitTalentsExpansion, botActiveAloneSmartScale*,
  HealerDPSMap*) are now silent

## ⚠️ Surprise finding: ~250 OTHER properties are also "missing"

When I ran the worldserver after the env-var fix, the original 13
warnings stopped — but the log still has hundreds more `> Config:
Missing property AiPlayerbot.*` lines. The user's original paste
only showed a window of the log; the full picture is that
**`playerbots.conf.dist` is not being read at runtime AT ALL**.

Every single one of the ~250 mod-playerbots properties is falling
back to its code-level default and printing a warning. Functionally
this is fine — the code defaults match the .dist defaults — but it's
a lot of log noise and a real misconfiguration.

### Hypothesis to investigate

AzerothCore module configs usually want both:
- `<module>.conf.dist` (template, shipped with the mod)
- `<module>.conf` (the active config; user/installer creates it)

The standard pattern is `cp <module>.conf.dist <module>.conf` during
install. mod-ale needed this too (we worked around it with env vars).
mod-playerbots likely needs the same: copy `playerbots.conf.dist` →
`playerbots.conf` so the config loader actually reads it.

### Action

1. Inside the worldserver container, check whether `playerbots.conf`
   exists at `/azerothcore/env/dist/etc/modules/`. Likely missing.
2. If missing:
   - Quick fix for current install: `cp` inside the container, restart.
   - Permanent fix for install-wow.sh: either copy at install time
     OR mount the .dist as .conf via the override (bind-mount trick).
3. Once playerbots.conf is loaded, the 13 env vars become redundant
   (the conf has the same values). Can leave them as belt-and-
   suspenders or remove. Recommend: leave them — they're documented
   and prevent silent regressions if the user nukes their .conf.
4. Same audit needed for mod-ale and any other module installed —
   apply the same .conf.dist → .conf pattern at install time.

## 🚧 Other things parked

- **Phase 2c.6b** — "Install Eluna" retrofit action in
  `manage-wow-modules.sh`. Lower priority; HOWTO covers manual retrofit.
- **Phase 2e** — Backend `add_bot_to_party` Tauri command (pick bot
  from AddClass pool → set level → Eluna whispers → summon → .group
  join). The wizard's `onConfirm` currently just `console.log`s.
- **Phase 2f** — Remove-from-party via `.group remove`.

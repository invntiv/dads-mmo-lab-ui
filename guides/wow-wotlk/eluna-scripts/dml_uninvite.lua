--[[ ============================================================
  dml_uninvite.lua — Dad's MMO Lab kick-from-party relay
  --------------------------------------------------------------

  Registers a single console/SOAP-callable command:

      dml_uninvite <botName>

  Removes `<botName>` from whatever group they're in by calling
  `bot:RemoveFromGroup()` via Eluna's Player method binding.

  Why we need it:
    The natural in-game equivalent (`/uninvite <name>`) is a chat
    slash command handled at the opcode layer, not the GM chat
    command layer — so `Player:RunCommand` can't drive it. The mod
    also has no `.kick from group` SOAP-accessible command.
    Eluna's `Player:RemoveFromGroup` calls AC's
    `Player::RemoveFromGroup()` directly, which detaches the bot
    from its group, fires the appropriate group-update packet to
    remaining members, and clears the bot's group state.

  How it's invoked (from SOAP):
      dml_uninvite Vallonian

  No `player` arg needed — the bot knows its own group; we just tell
  the bot to leave it. Both the leader's frame and remaining members
  receive the leave packet automatically.

  Security:
    Gated to console / SOAP origin (`player == nil`). SOAP creds
    already grant arbitrary command execution, so this doesn't
    widen any attack surface.
============================================================ --]]

-- PLAYER_EVENT_ON_COMMAND = 42.

local function OnUninviteCommand(event, player, command)
    if player ~= nil then return end

    local bname = command:match("^dml_uninvite%s+(%S+)$")
    if not bname then return end

    local b = GetPlayerByName(bname)
    if not b then
        print(string.format("[dml_uninvite] bot not found: %s", bname))
        return false
    end

    b:RemoveFromGroup()
    print(string.format("[dml_uninvite] removed %s from group", bname))
    return false
end

RegisterPlayerEvent(42, OnUninviteCommand)
print("[dml_uninvite] loaded — group-remove relay ready")

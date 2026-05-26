--[[ ============================================================
  dml_addclass.lua — Dad's MMO Lab addclass relay
  --------------------------------------------------------------

  Registers a single console/SOAP-callable command:

      dml_addclass <playerName> <classname> [gender]

  When fired, it runs `.playerbots addclass <classname> [gender]`
  AS IF `<playerName>` typed it in-game, which is the only way the
  command works — `.playerbots` requires `m_session->GetPlayer()`
  to be set, so it can't be invoked directly via SOAP (no player
  session is attached to a SOAP execution).

  Why we need it:
    The Lab's "Add to Party" wizard picks a class + spec + build
    + level and wants to spawn a bot from the mod's AddClass pool.
    The pool is internal to playerbots and not exposed via SOAP
    or Eluna directly — but the `.playerbots addclass` chat
    command is the canonical entry point, and Eluna's
    `Player:RunCommand` lets us execute that command from the
    player's own session without the user typing anything in-game.

  How it's invoked (from SOAP):
      dml_addclass Joshua warrior
      dml_addclass Joshua druid female

  Security:
    Gated to console/SOAP origin only (`player == nil` branch).
    No widening of attack surface — anyone with SOAP credentials
    can already invoke any AC command, and `.playerbots addclass`
    itself is gated by mod config (`AiPlayerbot.AddClassCommand`).
============================================================ --]]

-- PLAYER_EVENT_ON_COMMAND = 42.
-- https://www.azerothcore.org/eluna/Hooks.html#Player

local function OnAddclassCommand(event, player, command)
    -- Only console / SOAP origin.
    if player ~= nil then return end

    -- Match: dml_addclass <pname> <classname> [gender]
    -- The third capture is optional; if absent, classname captures
    -- the trailing word and gender stays nil.
    local pname, classname, gender =
        command:match("^dml_addclass%s+(%S+)%s+(%S+)%s+(%S+)$")
    if not pname then
        pname, classname = command:match("^dml_addclass%s+(%S+)%s+(%S+)$")
        gender = nil
    end
    if not pname then
        -- Not our command — leave for other handlers.
        return
    end

    local p = GetPlayerByName(pname)
    if not p then
        print(string.format("[dml_addclass] player not found: %s", pname))
        return false
    end

    -- Player:RunCommand strips the leading `.` if present and runs
    -- the rest through ChatHandler::_ParseCommands as if the player
    -- typed it — full security context, full mod-playerbots support.
    --
    -- Path nuance: mod-playerbots registers `.playerbots bot` (not
    -- `.playerbots`) as the entry point for PlayerbotMgr's
    -- HandlePlayerbotCommand, which is the function that owns the
    -- `addclass` sub-keyword. So the actual command we issue is
    --     .playerbots bot addclass <classname> [gender]
    -- not the (intuitive but wrong) `.playerbots addclass <classname>`,
    -- which the AC chat framework rejects with a USAGE message
    -- because `addclass` isn't a registered top-level subcommand.
    -- See: mod-playerbots/src/Script/PlayerbotCommandScript.cpp.
    local cmd
    if gender then
        cmd = string.format("playerbots bot addclass %s %s", classname, gender)
    else
        cmd = string.format("playerbots bot addclass %s", classname)
    end
    p:RunCommand(cmd)

    print(string.format(
        "[dml_addclass] %s ran: .%s", pname, cmd
    ))
    return false
end

RegisterPlayerEvent(42, OnAddclassCommand)
print("[dml_addclass] loaded — addclass relay ready")

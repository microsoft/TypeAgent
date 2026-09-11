# Command Executor MCP Server

An MCP (Model Context Protocol) server that connects to the TypeAgent dispatcher to execute user commands like playing music, managing lists, working with calendars, and more.

## Overview

This MCP server acts as a bridge between Claude Code (or other MCP clients) and the TypeAgent system. It accepts natural language commands and forwards them to the TypeAgent dispatcher for execution.

## Prerequisites

1. **Built Package**: Build this package before using:

   ```bash
   pnpm run build
   ```

2. **TypeAgent Server** (optional at startup): The TypeAgent dispatcher server at `ws://localhost:8999`. The MCP server will automatically connect when the TypeAgent server becomes available and reconnect if the connection is lost.

   Start the TypeAgent server with:

   ```bash
   pnpm run start:agent-server
   ```

## Configuration

The server can be configured via environment variables or constructor parameters:

- **AGENT_SERVER_URL**: WebSocket URL of the TypeAgent dispatcher (default: `ws://localhost:8999`)
- **TYPEAGENT_CONVERSATION_ID**: Optional existing conversation for structured
  actions. When omitted, this process creates a dedicated conversation and
  keeps its private resume capability in memory so pending interactions can
  continue across reconnects.

`connection_status` exposes the separate `structuredActions` binding metadata,
never its private capability. This does not change the legacy natural-language
connection selected by `AGENT_SERVER_CONVERSATION` (or its existing default).
An independent process cannot reclaim another process's operation using a
public conversation ID. Resume rejection is not permission to create a new
owner and replay work.

You can set this in the `.env` file at the root of the TypeAgent repository.

## Installation

### For Claude Code Users

1. **Build the package** from the TypeAgent repository root:

   ```bash
   cd ts
   pnpm run build
   ```

2. **Configure Claude Code** to use the MCP server. Add the following to your `.mcp.json` file in the TypeAgent repository root (create it if it doesn't exist):

   ```json
   {
     "mcpServers": {
       "command-executor": {
         "command": "node",
         "args": ["packages/commandExecutor/dist/server.js"]
       }
     }
   }
   ```

3. **Restart Claude Code** to load the MCP server configuration.

4. **Start the TypeAgent server** (can be done before or after starting Claude Code):

   ```bash
   pnpm run start:agent-server
   ```

5. **Test it** by sending commands through Claude Code:
   - "play bohemian rhapsody by queen"
   - "what's on my grocery list"
   - "add milk to my shopping list"

### For Other MCP Clients

The server is configured in `.mcp.json`:

```json
{
  "mcpServers": {
    "command-executor": {
      "command": "node",
      "args": ["packages/commandExecutor/dist/server.js"]
    }
  }
}
```

### Available Tools

The MCP server exposes the existing natural-language `execute_command` path and
a separate structured-action path:

See the [canonical structured-action design](../../docs/plans/copilot-direct-actions/director-actions.md).

1. `discover_agents` searches compact action summaries and availability.
2. `get_action_contract` returns one closed contract, its fingerprint, and its
   conversation scope.
3. `execute_action` accepts the exact protocol version, scope, identity,
   fingerprint, and structured parameters.
4. `continue_action` sends the user's exact response to a pending interaction.
5. `cancel_action` cancels a pending structured operation.

Structured calls return the complete service result in both readable JSON text
and `structuredContent`. `requires_interaction` is pending, not a tool error.
Callers must show the complete prompt or form to the user and must not choose
defaults or approvals for them. A timeout or disconnect can produce
`execution_uncertain`; do not automatically replay it.

#### execute_command

Execute user commands including music playback, list management, calendar operations, and VSCode automation using natural language.

**Parameters:**

- `request` (string): The natural language command to execute
- `cacheCheck` (boolean, optional): Check cache before executing
- `confirmed` (boolean, optional): Set to true if user has confirmed yes/no prompts

**Examples:**

**Music & Media:**

- "play sweet emotion by aerosmith"
- "play bohemian rhapsody by queen"

**Lists & Tasks:**

- "add jelly beans to my grocery list"
- "what's on my shopping list"

**Calendar:**

- "schedule a meeting for tomorrow at 2pm"

**VSCode Automation:**

- "switch to monokai theme"
- "change theme to dark+"
- "open the explorer view"
- "create a new folder called components"
- "open file app.ts"
- "split editor to the right"
- "toggle zen mode"
- "open integrated terminal"
- "show output panel"

The generic structured path does not translate natural language, populate the
natural-language cache, remap aliases, infer a scope, or retry calls. A caller
that already knows an action may request its contract directly without a
mandatory discovery chain.

`system.config.toggleAgent` and
`system.config.enterAgentPriorityMode` are intentionally reported as
unsupported by structured discovery and rejected before execution because their
legacy command bridge can enter interactive agent setup with unsafe unquoted
arguments. Other deterministic internal command bridges remain supported. Use
`execute_command` for the two unsupported setup operations; the ordinary
natural-language setup and choice flow remains available. Raw flow script steps
are also unavailable through structured execution until they have a
discoverable action contract; use their existing natural-language or command
path instead.

`get_user_context` and `run_workspace_command` also use this service internally.
The workspace convenience tool adds its familiar command result fields only
when a completed action returns a valid workspace result. Pending and failed
calls retain the full structured-action status and error instead of fabricating
a zero-duration failed command.

#### ping (debug mode)

Test server connectivity.

**Parameters:**

- `message` (string): Message to echo back

## Architecture

```
Claude Code (MCP Client)
    ↓
Command Executor MCP Server
    ↓
TypeAgent Dispatcher (WebSocket)
    ↓
    ├─ TypeAgent Agents (Music, Lists, Calendar, etc.)
    └─ Coda VSCode Extension (via WebSocket; port discovered through agent-server)
       └─ VSCode APIs (theme, editor, files, terminal, etc.)
```

The MCP server:

1. Receives commands from the MCP client
2. Connects to the TypeAgent dispatcher via WebSocket
3. Forwards commands to the dispatcher's `submitCommand` method (and awaits the resulting completion promise)
4. Returns results back to the client

## Connection & Reconnection

The MCP server includes automatic reconnection capabilities:

- **Startup**: The server starts immediately, even if the TypeAgent dispatcher is not running
- **Lazy Connection**: When you send the first command, it will attempt to connect if not already connected
- **Auto-Reconnect**: Every 5 seconds, the server checks the connection and reconnects if needed
- **Error Recovery**: If a command fails due to connection loss, the dispatcher is marked as disconnected and will automatically reconnect

**Recommended workflow:**

1. Start Claude Code (the MCP server starts automatically)
2. Start the TypeAgent server: `pnpm run start:agent-server`
3. Send commands - the MCP server will connect automatically

You can also start the TypeAgent server first, or restart it at any time without restarting the MCP server.

## Debugging and Logs

The MCP server automatically logs all activity to both console and a log file for debugging.

### Log File Location

Logs are written to: `/tmp/typeagent-mcp/mcp-server-<timestamp>.log`

### Viewing Logs

Use the provided helper script to view the most recent log file:

```bash
# View the entire log
./packages/commandExecutor/view-logs.sh

# Follow the log in real-time
./packages/commandExecutor/view-logs.sh -f
```

### What Gets Logged

- Server initialization and configuration
- Connection attempts to TypeAgent dispatcher
- Connection success/failure with error details
- Reconnection attempts
- All incoming user requests
- Command execution results
- Errors with stack traces

This is particularly useful for debugging connection issues between the MCP server and the TypeAgent dispatcher.

## Development

### Building

```bash
pnpm run build
```

### Running Standalone

```bash
pnpm run start
```

### Testing

Use the MCP client (like Claude Code) to test commands, or use the TypeAgent CLI to verify the dispatcher is working.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.

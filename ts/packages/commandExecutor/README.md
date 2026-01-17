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

#### execute_command

Execute user commands such as playing music, managing lists, or working with calendars.

**Parameters:**

- `request` (string): The natural language command to execute

**Examples:**

- "play sweet emotion by aerosmith"
- "add jelly beans to my grocery list"
- "schedule a meeting for tomorrow at 2pm"

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
TypeAgent Agents (Music, Lists, Calendar, etc.)
```

The MCP server:

1. Receives commands from the MCP client
2. Connects to the TypeAgent dispatcher via WebSocket
3. Forwards commands to the dispatcher's `processCommand` method
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

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft trademarks or logos is subject to and must follow [Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general). Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship. Any use of third-party trademarks or logos are subject to those third-party's policies.

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

The MCP server provides four main tool categories:

1. **Natural Language Execution** - Execute commands via natural language (`execute_command`)
2. **Schema Discovery** - Discover available TypeAgent capabilities (`discover_schemas`)
3. **Dynamic Loading** - Load new schemas at runtime (`load_schema`)
4. **Direct Action Invocation** - Execute structured actions directly (`typeagent_action`)

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

#### discover_schemas

Check if TypeAgent has capabilities for a user request that isn't covered by existing tools. Use this BEFORE telling the user a capability isn't available.

**Parameters:**

- `query` (string): Natural language description of what the user wants (e.g., "weather", "send email", "analyze code")
- `includeActions` (boolean, optional): If true, return detailed action schemas and TypeScript source. If false, just return agent names and descriptions (default: false)

**Examples:**

- User asks "What's the weather?" → Call `discover_schemas({query: "weather"})`
- Explore weather actions → Call `discover_schemas({query: "weather", includeActions: true})`

**Mock Implementation:**

Currently includes a mock weather agent with 3 actions:

- `getCurrentConditions`: Get current weather for a location
- `getForecast`: Get multi-day forecast
- `getAlerts`: Get weather alerts

#### load_schema

Load a TypeAgent schema dynamically and register its actions as tools. After loading, the agent's actions become available for direct invocation in this session.

**Parameters:**

- `schemaName` (string): The schema/agent name returned by discover_schemas (e.g., "weather", "email")
- `exposeAs` (string, optional): How to expose actions - "individual" or "composite" (default: "composite")
  - `individual`: Creates one tool per action (e.g., `weather_getCurrentConditions`, `weather_getForecast`)
  - `composite`: Creates one tool (e.g., `weather_action`) with action as a parameter

**Examples:**

- Load weather schema: `load_schema({schemaName: "weather"})`
- Load with individual tools: `load_schema({schemaName: "weather", exposeAs: "individual"})`

**Note:** Currently mock implementation - prints interactions but doesn't register real tools yet.

#### typeagent_action

Generic execution tool for any TypeAgent action not available as a direct tool. Use this as a fallback when:

1. An action exists but isn't exposed as an individual tool
2. You want to invoke an action from a newly discovered schema before loading it
3. The action is rarely used and doesn't warrant a dedicated tool

**Parameters:**

- `agent` (string): The agent/schema name (e.g., "player", "list", "calendar", "weather")
- `action` (string): The action name (e.g., "playTrack", "addItem", "getCurrentConditions")
- `parameters` (object, optional): Action-specific parameters
- `naturalLanguage` (string, optional): Natural language description for cache population

**Examples:**

- Get weather: `typeagent_action({agent: "weather", action: "getCurrentConditions", parameters: {location: "Seattle"}})`
- With cache population: `typeagent_action({agent: "weather", action: "getCurrentConditions", parameters: {location: "Seattle"}, naturalLanguage: "what's the weather in Seattle"})`

**Mock Implementation:**

Returns mock weather data and prints interaction details to logs. In production, this will call the real TypeAgent dispatcher with structured actions.

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
    └─ Coda VSCode Extension (via WebSocket on port 8082)
       └─ VSCode APIs (theme, editor, files, terminal, etc.)
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

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.

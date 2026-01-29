<!--
Copyright (c) Microsoft Corporation.
Licensed under the MIT License.
-->

# Testing Discovery Flow

This document explains how to test the TypeAgent MCP discovery mechanism with Claude Code.

## Overview

The discovery mechanism allows Claude to:

1. **Discover** what capabilities are available via `discover_schemas`
2. **Load** schemas dynamically via `load_schema` (optional)
3. **Execute** actions directly via `typeagent_action`

Currently implemented with a **mock weather agent** for testing.

## Setup

1. Build the command-executor package:

   ```bash
   cd packages/commandExecutor
   pnpm run build
   ```

2. Make sure your `.mcp.json` includes the command-executor:

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

3. Restart Claude Code to load the new tools

4. Check the logs to verify tools are registered:
   ```bash
   tail -f ~/.tmp/typeagent-mcp/mcp-server-*.log
   ```

## Test Scenarios

### Scenario 1: Basic Discovery

**User asks:** "What's the weather in Seattle?"

**Expected Claude behavior:**

1. Doesn't see a `weather_*` tool
2. Calls `discover_schemas({query: "weather"})`
3. Gets response showing weather agent is available
4. Calls `typeagent_action` with:
   - `agent: "weather"`
   - `action: "getCurrentConditions"` (or similar)
   - `parameters: {location: "Seattle"}`

**What to check:**

- Did Claude call `discover_schemas` before saying "not available"?
- Did Claude correctly extract agent name, action name, and parameters?
- Check logs: `~/.tmp/typeagent-mcp/mcp-server-*.log`

### Scenario 2: Discovery with Action Details

**User asks:** "What weather capabilities do you have?"

**Expected Claude behavior:**

1. Calls `discover_schemas({query: "weather", includeActions: true})`
2. Gets full action list with TypeScript schema
3. Summarizes available actions to user

**What to check:**

- Did Claude set `includeActions: true`?
- Did Claude interpret the TypeScript schema correctly?
- Can Claude explain what parameters each action takes?

### Scenario 3: Multi-Step Flow

**User asks:** "What's the 5-day forecast for Portland?"

**Expected Claude behavior:**

1. Discovery: `discover_schemas({query: "weather"})`
2. Execution: `typeagent_action({agent: "weather", action: "getForecast", parameters: {location: "Portland", days: 5}})`

**What to check:**

- Did Claude use `getForecast` instead of `getCurrentConditions`?
- Did Claude pass correct parameters (location + days)?

### Scenario 4: Schema Loading (Optional)

**User says:** "I'll be asking about weather a lot, can you load the weather capabilities?"

**Expected Claude behavior:**

1. Discovery: `discover_schemas({query: "weather"})`
2. Loading: `load_schema({schemaName: "weather", exposeAs: "individual"})`

**What to check:**

- Did Claude understand the request to load capabilities?
- Did Claude choose `individual` or `composite` exposure?
- Note: Tools won't actually be registered yet (mock implementation)

## Log Analysis

Check the MCP server logs at `~/.tmp/typeagent-mcp/mcp-server-*.log`:

```bash
# View recent logs
tail -n 100 ~/.tmp/typeagent-mcp/mcp-server-*.log

# Follow logs in real-time
tail -f ~/.tmp/typeagent-mcp/mcp-server-*.log
```

Look for log entries like:

```
[DISCOVERY] Query: "weather", includeActions: false
[DISCOVERY] Found 1 schema(s): weather
[TYPEAGENT_ACTION] Agent: "weather", Action: "getCurrentConditions"
[TYPEAGENT_ACTION] Parameters: {"location": "Seattle"}
```

## What We're Testing

### Claude's Ability To:

1. **Recognize unknown domains** - Does Claude call `discover_schemas` when asked about weather?
2. **Parse TypeScript schemas** - Can Claude interpret the schema to understand action names and parameters?
3. **Extract structured data** - Does Claude correctly identify:
   - Agent name: "weather"
   - Action name: "getCurrentConditions" vs "getForecast" vs "getAlerts"
   - Parameters: location, days, units
4. **Infer action choice** - Does Claude pick the right action for the user's request?
5. **Parameter mapping** - Can Claude map natural language to structured parameters?

### Example Mappings to Test:

| User Request                               | Expected Action      | Expected Parameters                    |
| ------------------------------------------ | -------------------- | -------------------------------------- |
| "What's the weather in Seattle?"           | getCurrentConditions | {location: "Seattle"}                  |
| "What's the 3-day forecast for Portland?"  | getForecast          | {location: "Portland", days: 3}        |
| "Are there any weather alerts for Miami?"  | getAlerts            | {location: "Miami"}                    |
| "What's the weather in London in celsius?" | getCurrentConditions | {location: "London", units: "celsius"} |

## Success Criteria

✅ **Discovery works if:**

- Claude calls `discover_schemas` before saying capability doesn't exist
- Claude doesn't hallucinate that weather tools exist before discovery

✅ **Schema interpretation works if:**

- Claude correctly identifies all 3 actions (getCurrentConditions, getForecast, getAlerts)
- Claude understands optional vs required parameters
- Claude can explain what each action does

✅ **Execution works if:**

- Claude passes correct agent name ("weather", not "Weather" or "weather_agent")
- Claude passes correct action name (matches schema exactly)
- Claude structures parameters as objects with correct field names
- Claude chooses the right action for the user's intent

## Next Steps

After confirming Claude can:

1. Discover the weather schema
2. Interpret the TypeScript schema
3. Execute actions with correct parameters

We'll move to:

1. **Real dispatcher integration** - Replace mock responses with actual dispatcher calls
2. **Cache population** - Populate NL cache when using direct actions
3. **Dynamic tool registration** - Make `load_schema` actually register MCP tools
4. **Core agent compilation** - Pre-compile player/list/calendar as individual tools

## Questions for Analysis

1. **Does Claude need more guidance?** Should the TypeScript schema be in a different format?
2. **Does includeActions help?** Is the full schema useful or does Claude do better with just action names?
3. **How does Claude choose actions?** Does it match keywords or reason about intent?
4. **Parameter extraction accuracy?** How often does Claude get location/days/units correct?
5. **Error recovery?** What happens if Claude passes wrong parameters?

---

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft trademarks or logos is subject to and must follow [Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks). Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship. Any use of third-party trademarks or logos are subject to those third-party's policies.

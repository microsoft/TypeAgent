<!--
Copyright (c) Microsoft Corporation.
Licensed under the MIT License.
-->

# Testing Discovery Flow with agentSdkWrapper

## Quick Start

```bash
# From TypeAgent/ts directory
cd packages/agentSdkWrapper
pnpm run start
```

## Test Queries

Try these queries to test Claude's discovery behavior:

### 1. Basic Weather Query

```
What's the weather in Seattle?
```

**Expected behavior:**

- Claude should call `discover_schemas({query: "weather"})`
- Then call `typeagent_action({agent: "weather", action: "getCurrentConditions", parameters: {location: "Seattle"}})`
- Should return mock weather data

### 2. Forecast Query

```
What's the 5-day forecast for Portland?
```

**Expected behavior:**

- Claude discovers weather schema
- Chooses `getForecast` action (not `getCurrentConditions`)
- Passes correct parameters: `{location: "Portland", days: 5}`

### 3. Complex Parameters

```
What's the 3-day forecast for Miami in celsius?
```

**Expected behavior:**

- All three parameters: `{location: "Miami", days: 3, units: "celsius"}`

### 4. Capability Exploration

```
What weather capabilities do you have?
```

**Expected behavior:**

- Claude calls `discover_schemas({query: "weather", includeActions: true})`
- Lists all 3 actions with descriptions

### 5. Weather Alerts

```
Are there any weather alerts for New York?
```

**Expected behavior:**

- Claude chooses `getAlerts` action
- Parameters: `{location: "New York"}`

## What to Look For

### ✅ Good Discovery Behavior

- Claude calls `discover_schemas` **before** saying capability doesn't exist
- Claude correctly parses TypeScript schema
- Claude extracts exact agent name: "weather" (not "Weather" or "weather_agent")
- Claude extracts exact action name from schema
- Claude maps natural language to structured parameters correctly

### ❌ Bad Discovery Behavior

- Claude says "I can't check weather" without calling `discover_schemas`
- Claude hallucinate that weather tools exist before discovering them
- Claude gets agent/action names wrong
- Claude can't parse the TypeScript schema
- Claude passes wrong parameter structure

## Checking Logs

The command-executor MCP server logs all interactions:

```bash
# View most recent log
tail -100 ~/.tmp/typeagent-mcp/mcp-server-*.log

# Or on Windows
type %USERPROFILE%\.tmp\typeagent-mcp\mcp-server-*.log
```

Look for entries like:

```
[DISCOVERY] Query: "weather", includeActions: false
[DISCOVERY] Found 1 schema(s): weather
[TYPEAGENT_ACTION] Agent: "weather", Action: "getCurrentConditions"
[TYPEAGENT_ACTION] Parameters: {"location":"Seattle"}
```

## Testing Matrix

| User Query                                | Expected Action      | Expected Parameters                              |
| ----------------------------------------- | -------------------- | ------------------------------------------------ |
| "What's the weather in Seattle?"          | getCurrentConditions | `{location: "Seattle"}`                          |
| "What's the 5-day forecast for Portland?" | getForecast          | `{location: "Portland", days: 5}`                |
| "3-day forecast for Miami in celsius"     | getForecast          | `{location: "Miami", days: 3, units: "celsius"}` |
| "Are there weather alerts for Boston?"    | getAlerts            | `{location: "Boston"}`                           |
| "Current conditions in London"            | getCurrentConditions | `{location: "London"}`                           |

## Success Criteria

The POC is successful if Claude:

1. ✅ Calls `discover_schemas` proactively (doesn't just use execute_command)
2. ✅ Interprets TypeScript schema correctly
3. ✅ Extracts correct agent name ("weather")
4. ✅ Chooses correct action based on intent (getCurrentConditions vs getForecast vs getAlerts)
5. ✅ Maps NL to structured parameters accurately
6. ✅ Handles optional parameters (days, units)

## Next Steps After Successful Test

Once confirmed working:

1. Implement real dispatcher integration (replace mock responses)
2. Add cache population for direct actions
3. Implement dynamic tool registration for `load_schema`
4. Add more test schemas (email, code analysis, etc.)
5. Compile core agents (player, list, calendar) as individual tools

## Troubleshooting

### Claude doesn't call discover_schemas

- Check if tools are registered: Look for `discover_schemas` in startup
- Check MCP server logs for tool registration

### Claude can't parse TypeScript schema

- Check if `includeActions: true` shows the schema
- May need to convert to JSON Schema format instead

### Wrong agent/action names

- Check exact capitalization in logs
- May need to add examples to tool description

### Wrong parameters

- Check if TypeScript schema shows parameter types clearly
- May need to add parameter descriptions to action definitions

## Debug Mode

Enable debug logging for more details:

```bash
cd packages/agentSdkWrapper
pnpm run start -- --debug
```

This will show:

- All MCP tool calls
- Cache hits/misses
- Full request/response flow

---

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft trademarks or logos is subject to and must follow [Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks). Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship. Any use of third-party trademarks or logos are subject to those third-party's policies.

# Agent Server Configuration

This document describes the configuration system for the TypeAgent command executor MCP server and agent server.

## Overview

The command executor MCP server can be configured using a JSON configuration file. This allows you to:

- Select which grammar system to use for request matching (completionBased or NFA)
- Configure cache behavior
- Enable/disable specific agents
- Set dispatcher options

## Configuration File Locations

The configuration loader searches for `agentServerConfig.json` in the following locations (in order):

1. **Environment variable**: Path specified in `AGENT_SERVER_CONFIG`
2. **Current directory**: `./agentServerConfig.json` or `./.agentServerConfig.json`
3. **User config directory**: `~/.typeagent/agentServerConfig.json`
4. **User home directory**: `~/.agentServerConfig.json`
5. **TypeAgent instance directory**: `$TYPEAGENT_INSTANCE_DIR/agentServerConfig.json` (if set)

The first configuration file found is used. If no configuration file is found, default values are used.

## Configuration Structure

### Complete Example

```json
{
  "version": "1.0",
  "cache": {
    "enabled": true,
    "grammarSystem": "nfa",
    "matchWildcard": false,
    "matchEntityWildcard": false,
    "mergeMatchSets": true,
    "cacheConflicts": false
  },
  "agents": [
    {
      "name": "player",
      "enabled": true,
      "grammarFile": "../agents/player/src/agent/playerSchema.agr"
    },
    {
      "name": "calendar",
      "enabled": true,
      "grammarFile": "../agents/calendar/dist/calendarSchema.agr"
    }
  ],
  "dispatcher": {
    "persistSession": true,
    "persistDir": "~/.typeagent",
    "metrics": true,
    "dbLogging": false,
    "conversationMemory": {
      "requestKnowledgeExtraction": false,
      "actionResultKnowledgeExtraction": false
    }
  }
}
```

### Configuration Sections

#### `version`

**Type**: `string`
**Default**: `"1.0"`

Configuration format version. Currently only `"1.0"` is supported.

#### `cache`

Cache configuration options.

- **`enabled`** (boolean, default: `true`)
  Enable or disable the cache system entirely.

- **`grammarSystem`** (string: `"completionBased"` | `"nfa"`, default: `"completionBased"`)
  Select which grammar system to use:

  - `"completionBased"`: Use the existing completion-based construction cache system
  - `"nfa"`: Use the new NFA-based agent grammar registry

- **`matchWildcard`** (boolean, default: `false`)
  Enable wildcard matching in cache queries.

- **`matchEntityWildcard`** (boolean, default: `false`)
  Enable entity wildcard matching in cache queries.

- **`mergeMatchSets`** (boolean, default: `true`)
  Merge multiple match sets when multiple patterns match.

- **`cacheConflicts`** (boolean, default: `false`)
  Cache conflicting translations for debugging/analysis.

#### `agents`

Array of agent-specific configurations.

Each agent entry has:

- **`name`** (string, required)
  Agent identifier (e.g., `"player"`, `"calendar"`, `"email"`).

- **`enabled`** (boolean, default: `true`)
  Enable or disable this specific agent.

- **`grammarFile`** (string, optional)
  Path to agent grammar file (for NFA system). If not specified, will look in standard locations based on agent name.

- **`options`** (object, optional)
  Agent-specific initialization options (structure varies by agent).

#### `dispatcher`

Dispatcher configuration options.

- **`persistSession`** (boolean, default: `true`)
  Enable session persistence across restarts.

- **`persistDir`** (string, default: `"~/.typeagent"`)
  Directory for persisting session data.

- **`metrics`** (boolean, default: `true`)
  Enable metrics collection.

- **`dbLogging`** (boolean, default: `false`)
  Enable database logging.

- **`conversationMemory`** (object)
  Knowledge extraction settings:
  - **`requestKnowledgeExtraction`** (boolean, default: `false`)
    Extract knowledge from user requests.
  - **`actionResultKnowledgeExtraction`** (boolean, default: `false`)
    Extract knowledge from action results.

## Using the NFA Grammar System

To use the new NFA-based grammar system:

1. Set `cache.grammarSystem` to `"nfa"` in your configuration file:

```json
{
  "cache": {
    "enabled": true,
    "grammarSystem": "nfa"
  }
}
```

2. Specify grammar files for each agent:

```json
{
  "agents": [
    {
      "name": "player",
      "enabled": true,
      "grammarFile": "../agents/player/src/agent/playerSchema.agr"
    }
  ]
}
```

3. Ensure the agent grammar files (.agr) are available at the specified paths.

## Environment Variables

The configuration system respects the following environment variables:

- **`AGENT_SERVER_CONFIG`**: Path to configuration file (highest priority)
- **`TYPEAGENT_INSTANCE_DIR`**: TypeAgent instance directory for per-instance configuration
- **`AGENT_SERVER_URL`**: Agent server WebSocket URL (default: `ws://localhost:8999`)

## Creating a Configuration File

### Using the Example

Copy the example configuration file:

```bash
cp agentServerConfig.example.json ~/.typeagent/agentServerConfig.json
```

Then edit the file to customize your settings.

### Minimal Configuration

You can provide only the settings you want to override. All other settings will use defaults:

```json
{
  "cache": {
    "grammarSystem": "nfa"
  }
}
```

## Validation

The configuration loader validates the configuration structure and reports errors:

- Invalid version format
- Unknown grammar system
- Missing agent names
- Grammar files that don't exist

Validation warnings are logged but don't prevent the server from starting. Invalid settings will fall back to defaults.

## Logging

Configuration loading is logged to:

- **Console**: Startup messages about configuration source and settings
- **Log file**: `~/.tmp/typeagent-mcp/mcp-server-{timestamp}.log`

Example log output:

```
[2026-01-25T19:00:00.000Z] [INFO] Loaded configuration from: /home/user/.typeagent/agentServerConfig.json
[2026-01-25T19:00:00.001Z] [INFO] Grammar system: nfa
[2026-01-25T19:00:00.001Z] [INFO] Cache enabled: true
[2026-01-25T19:00:00.001Z] [INFO] Configured agents: player, calendar
```

## Troubleshooting

### Configuration not loading

1. Check file exists at one of the search paths
2. Verify JSON syntax is valid
3. Check file permissions are readable
4. Look for validation errors in logs

### Grammar files not found

1. Verify paths are correct relative to the command executor location
2. Check that .agr files exist at specified paths
3. For calendar agent, ensure `dist/calendarSchema.agr` is built

### NFA system not working

1. Ensure `grammarSystem` is set to `"nfa"`
2. Verify agent grammar files are specified and exist
3. Check logs for parsing or compilation errors
4. Ensure entities are registered (if using entity types)

## Future Enhancements

Planned configuration features:

- Hot reloading of configuration changes
- Per-agent cache settings
- Grammar rule override/extension
- DFA compilation options
- Performance tuning parameters

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.

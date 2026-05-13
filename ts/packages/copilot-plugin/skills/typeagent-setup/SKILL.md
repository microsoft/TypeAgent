---
name: typeagent-setup
description: Configure TypeAgent integration mode and settings
user-invocable: true
---

# TypeAgent Setup

Configure the TypeAgent integration for Copilot CLI.

## Current Configuration

Read the config file at `${PLUGIN_DATA}/config.json` (create if it doesn't exist).

## Options

Ask the user which integration mode they'd like:

1. **direct** (default) - Hook handles requests directly, bypassing the LLM. Fastest response time (~2-3s) but no streaming.
2. **mcp** - Hook redirects to MCP tool, allowing the LLM to call TypeAgent. Adds ~1-2s for LLM overhead but enables streaming and LLM formatting.

Also ask for:

- **TypeAgent host** (default: localhost) - The host where the TypeAgent agent-server is running
- **TypeAgent port** (default: 8999) - The port for the agent-server

## Save Configuration

Write the configuration to `${PLUGIN_DATA}/config.json`:

```json
{
  "mode": "direct",
  "host": "localhost",
  "port": 8999
}
```

Tell the user to restart Copilot CLI for changes to take effect.
They can also override temporarily with environment variables:

- `TYPEAGENT_MODE=mcp` or `TYPEAGENT_MODE=direct`
- `TYPEAGENT_HOST=hostname`
- `TYPEAGENT_PORT=port`

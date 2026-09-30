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
2. **mcp** - Choose a routing policy: **delegate** (default) sends the original request to TypeAgent; **mixed** lets Copilot choose whole-request delegation or own the task and use structured TypeAgent tools for intermediate steps.
3. **dev** - Hook tries registered PowerShell development actions first and lets Copilot handle misses.
4. **bypass** - Disable TypeAgent routing and reject TypeAgent MCP calls.

The `typeagent-workspace` read/glob/grep/fetch tools are available in direct,
mcp, and dev modes. They do not require a separate macro mode.

Use `@typeagent mode mcp mixed` or `/typeagent-mode mcp mixed` to opt in;
use `mcp delegate` to restore the existing policy. Plain `mcp` preserves the
saved policy. `@typeagent mode`, `@typeagent status`, and `/typeagent-status`
report the effective policy. Mixed mode is not search-first: user requests
such as "show my lists" still delegate intact via `processCommand`. Copilot
uses `searchActions`/`executeAction` for TypeAgent steps it selects while
coordinating broader work **only under MCP mixed routing**, not the default
delegate policy. Structured tools remain available in both policies; switching
policy changes routing guidance, not the tool catalog or permissions.
Recording prefixes always preserve natural-language
delegation. MCP tool-card titles distinguish natural-language delegation from
structured discovery/execution in both policies, without relying on model
narration or claiming action success.

Also ask for:

- **TypeAgent host** (default: localhost) - The host where the TypeAgent agent-server is running
- **TypeAgent port** (default: 8999) - The port for the agent-server

## Save Configuration

Write the configuration to `${PLUGIN_DATA}/config.json`:

```json
{
  "mode": "direct",
  "mcpRouting": "delegate",
  "host": "localhost",
  "port": 8999
}
```

Mode and MCP routing policy changes take effect on subsequent prompts without
restarting an up-to-date plugin. After updating the installed plugin snapshot,
start a fresh Copilot session to load its extension and MCP tools; switching
repository branches alone does not update that snapshot.
These settings persist and are shared by sessions using this config.
Restart Copilot CLI after changing connection settings or environment variables.
They can also override temporarily with environment variables:

- `TYPEAGENT_MODE=direct`, `mcp`, `dev`, or `bypass`
- `TYPEAGENT_HOST=hostname`
- `TYPEAGENT_PORT=port`

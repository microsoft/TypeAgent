<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=5649e446b0baf71e5d13f269967efe7af4c6af0fe98244ef5cd22c53ba6d184f -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/copilot-plugin — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/copilot-plugin` package is a TypeAgent integration plugin for the GitHub Copilot CLI. It enables action requests such as calendar, email, music, and browser automation to be routed to TypeAgent before reaching the Copilot LLM.

## What it does

This plugin intercepts user inputs submitted through the `copilot-dev` CLI and determines whether the input is an action request or a question. Action requests are routed to TypeAgent, which can handle them directly or via the MCP server. Questions fall through to the Copilot LLM. The plugin supports two modes: direct mode and MCP mode. In direct mode, the plugin connects to TypeAgent over WebSocket and handles recognized actions directly. In MCP mode, the plugin injects directives into the prompt context, instructing the LLM to call TypeAgent's MCP tools.

## Setup

To set up the `@typeagent/copilot-plugin`, you need to configure several environment variables:

- `CLAUDE_PLUGIN_DATA`
- `HOOK_TYPE`
- `TYPEAGENT_HOST`
- `TYPEAGENT_MODE`
- `TYPEAGENT_PLUGIN_DATA`
- `TYPEAGENT_PORT`

Additionally, ensure you have Node.js 24+ installed and the TypeAgent server running. The plugin connects to TypeAgent at `ws://localhost:8999` by default. You can override the connection settings using the `TYPEAGENT_PORT` and `TYPEAGENT_HOST` environment variables.

For detailed setup instructions, see the hand-written README.

## Key Files

The plugin's architecture consists of several key components:

- **Hooks**: Located in the `src/hooks` directory, these files handle various stages of user input processing. Notable hooks include:

  - [hook-agent-stop.ts](./src/hooks/hook-agent-stop.ts): Handles the agent stop event.
  - [hook-debug.ts](./src/hooks/hook-debug.ts): Logs input for debugging purposes.
  - [hook-direct.ts](./src/hooks/hook-direct.ts): Processes commands directly via TypeAgent.
  - [hook-history.ts](./src/hooks/hook-history.ts): Tracks Copilot interactions in TypeAgent history.
  - [hook-mcp-redirect.ts](./src/hooks/hook-mcp-redirect.ts): Redirects action requests to the MCP server.
  - [hook-post-tool.ts](./src/hooks/hook-post-tool.ts): Tracks non-TypeAgent tool results in TypeAgent history.
  - [hook-powershell.ts](./src/hooks/hook-powershell.ts): Integrates TypeAgent PowerShell guidance.

- **Configuration**: The plugin configuration is stored in `%USERPROFILE%\.typeagent-copilot\config.json` (Windows) or `~/.typeagent-copilot/config.json` (WSL/Linux). Environment variables can override the configuration file settings.

## How to extend

To extend the `@typeagent/copilot-plugin`, follow these steps:

1. **Open the relevant hook file**: Depending on the functionality you want to add or modify, open the corresponding hook file in the `src/hooks` directory.

2. **Follow the existing patterns**: Each hook file follows a specific pattern for processing input and interacting with TypeAgent. Review the existing code to understand the structure and logic.

3. **Implement your changes**: Add your new functionality or modify the existing code as needed. Ensure your changes align with the overall architecture and flow of the plugin.

4. **Test your changes**: Use the test scripts provided in the `package.json` to simulate hook invocation and verify your changes. For example, to test the direct mode hook, run:

   ```bash
   cd /mnt/d/repos/SecretAgents/ts/packages/typeagent-plugin
   pnpm run test:hook-direct
   ```

5. **Run the plugin**: Launch the `copilot-dev` CLI with the plugin to test your changes in a real-world scenario:

   ```powershell
   copilot-dev --plugin-dir D:\repos\SecretAgents\ts\packages\typeagent-plugin
   ```

By following these steps, you can effectively extend the functionality of the `@typeagent/copilot-plugin` and ensure it integrates smoothly with the GitHub Copilot CLI and TypeAgent.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

_No public exports declared in `package.json`._

### Dependencies

Workspace:

- [@typeagent/agent-sdk](../../packages/agentSdk/README.md)
- [@typeagent/agent-server-client](../../packages/agentServer/client/README.md)
- [@typeagent/dispatcher-types](../../packages/dispatcher/types/README.md)

External: `@modelcontextprotocol/sdk`, `html-to-text`, `zod`

### Files of interest

`./src/hooks/hook-agent-stop.ts`, `./src/hooks/hook-debug.ts`, `./src/hooks/hook-direct.ts`, …and 11 more under `./src/`.

### Environment variables

_6 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `CLAUDE_PLUGIN_DATA`
- `HOOK_TYPE`
- `TYPEAGENT_HOST`
- `TYPEAGENT_MODE`
- `TYPEAGENT_PLUGIN_DATA`
- `TYPEAGENT_PORT`

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T19:00:56.375Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/copilot-plugin docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

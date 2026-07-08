<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=ded13032b748700e08274f1ce1d068b1f3508bdeecb10de21a910854c7f1ade6 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/copilot-plugin — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/copilot-plugin` package is a TypeAgent integration plugin for the GitHub Copilot CLI. It enables the routing of action requests (e.g., calendar, email, music, browser automation) to TypeAgent for handling before they are passed to the Copilot LLM.

## What it does

This plugin acts as a bridge between the GitHub Copilot CLI and TypeAgent. It intercepts user inputs and determines whether they are action requests or general questions. Based on the input type, the plugin routes the request as follows:

- **Action Requests**: These are routed to TypeAgent, which can handle them directly or via the MCP server. If TypeAgent recognizes the action, it processes the request and returns a response, bypassing the Copilot LLM.
- **General Questions**: These are passed through to the Copilot LLM for processing.

The plugin supports two integration modes:

1. **Direct Mode**: The plugin connects directly to TypeAgent over WebSocket. Recognized actions are handled by TypeAgent, and the response is returned directly to the user. This mode is faster and does not consume LLM tokens but does not support streaming output.
2. **MCP Mode**: The plugin modifies the prompt to instruct the LLM to call the `typeagent-processCommand` MCP tool. This mode allows for streaming output and LLM-formatted responses but is slower and consumes LLM tokens.

The plugin also provides hooks for various stages of user input processing, such as logging, debugging, and tracking interactions in TypeAgent history.

## Setup

To set up the `@typeagent/copilot-plugin`, follow these steps:

1. **Install Node.js and pnpm**:

   - Use Node.js 22+ and pnpm 10+ as specified in the workspace's `package.json` engines.
   - On Windows, install Node.js via tools like `nvm-windows` or the Node.js installer.
   - On WSL, use `nvm` to install and manage Node.js versions.

2. **Start the TypeAgent Server**:

   - The plugin connects to TypeAgent at `ws://localhost:8999` by default.
   - Start the TypeAgent server from the workspace root:
     ```bash
     cd D:\repos\TypeAgent\ts
     pnpm run start:agent-server
     ```
   - Optionally, override the connection settings using the `TYPEAGENT_PORT` and `TYPEAGENT_HOST` environment variables.

3. **Set Environment Variables**:
   Configure the following environment variables as needed:

   - `CLAUDE_PLUGIN_DATA`
   - `HOOK_TYPE`
   - `TYPEAGENT_DEMO_STATE_PATH`
   - `TYPEAGENT_HOST`
   - `TYPEAGENT_MODE`
   - `TYPEAGENT_PLUGIN_DATA`
   - `TYPEAGENT_PORT`

   Refer to the hand-written README for details on obtaining and setting these values.

4. **Build the Plugin**:

   - Install dependencies and build the plugin:
     ```bash
     cd /mnt/d/repos/TypeAgent/ts
     pnpm install
     pnpm run build
     ```
   - Alternatively, build only the plugin:
     ```bash
     cd /mnt/d/repos/TypeAgent/ts/packages/copilot-plugin
     pnpm run build
     ```

5. **Test the Plugin**:
   - Launch the Copilot CLI with the plugin:
     ```powershell
     copilot --plugin-dir D:\repos\TypeAgent\ts\packages\copilot-plugin
     ```
   - Verify the plugin is loaded by running:
     ```powershell
     copilot plugin list
     ```

## Key Files

The `@typeagent/copilot-plugin` package is organized into several key files and directories:

- **[src/hooks](./src/hooks)**: Contains the main hook implementations for the plugin. Key files include:

  - [hook-agent-stop.ts](./src/hooks/hook-agent-stop.ts): Handles the `agentStop` event and updates TypeAgent history.
  - [hook-debug.ts](./src/hooks/hook-debug.ts): Logs input for debugging purposes.
  - [hook-direct.ts](./src/hooks/hook-direct.ts): Processes commands directly via TypeAgent, bypassing the Copilot LLM.
  - [hook-mcp-redirect.ts](./src/hooks/hook-mcp-redirect.ts): Redirects action requests to the MCP server.
  - [hook-post-tool.ts](./src/hooks/hook-post-tool.ts): Tracks non-TypeAgent tool results in TypeAgent history.
  - [hook-powershell.ts](./src/hooks/hook-powershell.ts): Integrates TypeAgent PowerShell guidance for Windows.

- **[src/shared](./src/shared)**: Contains shared utilities and helper functions used across hooks, such as `typeagent-client.js` for managing connections to the TypeAgent server.

- **Configuration Files**:
  - `%USERPROFILE%\.typeagent-copilot\config.json` (Windows) or `~/.typeagent-copilot/config.json` (WSL/Linux): Stores plugin configuration.
  - Environment variables can override settings in the configuration file.

## How to extend

To extend the functionality of the `@typeagent/copilot-plugin`, follow these steps:

1. **Identify the Relevant Hook**:

   - Determine which hook corresponds to the functionality you want to modify or extend. For example:
     - Use [hook-direct.ts](./src/hooks/hook-direct.ts) for direct handling of commands via TypeAgent.
     - Use [hook-mcp-redirect.ts](./src/hooks/hook-mcp-redirect.ts) for MCP mode modifications.

2. **Understand the Existing Code**:

   - Review the existing code in the relevant hook file to understand its structure and logic.
   - Refer to shared utilities in the [src/shared](./src/shared) directory for reusable components.

3. **Implement Changes**:

   - Add or modify functionality in the identified hook file. Follow the established patterns and ensure compatibility with the plugin's architecture.

4. **Test Your Changes**:

   - Use the test scripts provided in the `package.json` to simulate hook invocation and verify your changes. For example:
     ```bash
     pnpm run test:hook-direct
     ```
   - Launch the Copilot CLI with the plugin to test your changes in a real-world scenario:
     ```powershell
     copilot --plugin-dir D:\repos\TypeAgent\ts\packages\copilot-plugin
     ```

5. **Update Documentation**:
   - Document your changes in the appropriate files and update the hand-written README if necessary.

By following these steps, you can effectively extend and customize the `@typeagent/copilot-plugin` to meet your specific requirements.

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

`./src/hooks/demo-state.ts`, `./src/hooks/hook-agent-stop.ts`, `./src/hooks/hook-debug.ts`, …and 13 more under `./src/`.

### Environment variables

_7 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `CLAUDE_PLUGIN_DATA`
- `HOOK_TYPE`
- `TYPEAGENT_DEMO_STATE_PATH`
- `TYPEAGENT_HOST`
- `TYPEAGENT_MODE`
- `TYPEAGENT_PLUGIN_DATA`
- `TYPEAGENT_PORT`

---

_Auto-generated against commit `366aaf867a7e8e5d130b6c87a365516bab725269` on `2026-07-07T09:05:05.703Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/copilot-plugin docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

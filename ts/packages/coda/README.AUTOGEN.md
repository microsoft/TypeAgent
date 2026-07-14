<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=0924ac6bee0218efaab1241cde8d1872f762a55c13b3f6f88b304e937d8ee864 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# agent-coda — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `agent-coda` package is a TypeScript library that powers the Coda Operated Assistance (CODA) system, enabling voice-controlled coding assistance within Visual Studio Code (VSCode). By integrating with the TypeAgent shell or CLI, this package allows users to perform a wide range of coding and workspace management tasks using natural language commands. It is designed to enhance productivity and accessibility for developers.

## What it does

The `agent-coda` package provides a set of actions that enable users to interact with VSCode through voice commands. These actions are executed via the TypeAgent shell or CLI and cover a variety of use cases:

- **File Management**: Actions like `createFile` and `openFile` allow users to create, open, and manage files directly from voice commands.
- **Editor Layout Management**: The `changeEditorColumns` action enables users to adjust the editor layout to single, double, or triple columns.
- **Extension Management**: Actions such as `checkExtensionAvailable` allow users to search for, install, and manage VSCode extensions.
- **Debugging**: The `startDebugging` action facilitates the initiation of debugging sessions with specific configurations.
- **Workbench Operations**: Actions like managing workspace folders and opening files are handled by `handleWorkBenchActions`.

These features make it possible to perform common development tasks hands-free, improving accessibility and streamlining workflows.

## Setup

To use the `agent-coda` package, you need to configure the following environment variables:

- `AGENT_SERVER_URL`: The URL of the agent server. This is required for the package to communicate with the TypeAgent server.
- `CODE_WEBSOCKET_HOST`: The WebSocket host for connecting to the TypeAgent shell or CLI.

You can set these variables in your shell environment or in a `.env` file located in the `ts/` directory. For more details on obtaining these values, refer to the hand-written README.

### Building and Deploying the Extension

1. **Build the Extension**: Run the following command in the package directory to build the VSCode extension:

   ```bash
   pnpm run build
   ```

2. **Deploy Locally**: To deploy the extension in your local VSCode environment, use:

   ```bash
   pnpm run deploy:local
   ```

3. **Verify Installation**: After deployment, verify that the extension is installed by running:

   ```bash
   code --list-extensions
   ```

   You should see `aisystems.copilot-coda` in the list of installed extensions.

4. **Uninstall the Extension**: If needed, you can uninstall the extension using:
   ```bash
   code --uninstall-extension aisystems.copilot-coda
   ```

### Additional Requirements

The `agent-coda` extension is designed to work in conjunction with the TypeAgent shell or CLI. Ensure that the TypeAgent shell or CLI is running and properly configured to enable communication with the extension.

## Key Files

The `agent-coda` package is organized into several key files, each responsible for specific functionalities:

- [codeUtils.ts](./src/codeUtils.ts): Provides utility functions for code manipulation, such as ensuring proper syntax closures and generating documentation comments.
- [commandAliasMgr.ts](./src/commandAliasMgr.ts): Manages command aliases to simplify the recognition and execution of voice commands.
- [extension.ts](./src/extension.ts): The main entry point for the VSCode extension, responsible for activation, command registration, and initializing WebSocket connections.
- [handleDebugActions.ts](./src/handleDebugActions.ts): Implements debugging-related actions, such as starting debugging sessions with specific configurations.
- [handleEditorCodeActions.ts](./src/handleEditorCodeActions.ts): Handles actions related to code editing, including creating files, inserting code snippets, and managing file content.
- [handleExtensionActions.ts](./src/handleExtensionActions.ts): Manages VSCode extensions, including searching, installing, and verifying their availability.
- [handleVSCodeActions.ts](./src/handleVSCodeActions.ts): Handles general VSCode actions, such as changing editor layouts and managing settings.
- [handleWorkBenchActions.ts](./src/handleWorkBenchActions.ts): Focuses on workbench-related actions, such as opening files and managing workspace folders.

## How to extend

To add new features or modify existing functionality in the `agent-coda` package, follow these steps:

1. **Identify the Action to Modify or Add**:

   - Review the existing actions in the handler files, such as [handleEditorCodeActions.ts](./src/handleEditorCodeActions.ts), [handleVSCodeActions.ts](./src/handleVSCodeActions.ts), or others.
   - Determine whether you need to enhance an existing action or create a new one.

2. **Implement the Action Logic**:

   - For new actions, create a function in the appropriate handler file. For example, if the action involves debugging, add it to [handleDebugActions.ts](./src/handleDebugActions.ts).
   - Ensure the function processes input parameters correctly and performs the desired operation in VSCode.

3. **Register the Action**:

   - Add the new action to the appropriate handler file and ensure it is registered in [extension.ts](./src/extension.ts).

4. **Test the Action**:

   - Write unit tests to validate the new or modified action. Test the action in a VSCode environment to ensure it behaves as expected.

5. **Update Documentation**:
   - Document the new or modified action, including its parameters, expected behavior, and any relevant examples. Update the hand-written README if necessary.

By following these steps, you can extend the `agent-coda` package to support additional voice commands and enhance its functionality.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./out/extension.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/agent-server-client](../../packages/agentServer/client/README.md)
- [@typeagent/agent-server-protocol](../../packages/agentServer/protocol/README.md)

External: `body-parser`, `chalk`, `cors`, `debug`, `dotenv`, `ws`

### Files of interest

`./src/codeUtils.ts`, `./src/commandAliasMgr.ts`, `./src/extension.ts`, …and 10 more under `./src/`.

### Environment variables

_2 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `AGENT_SERVER_URL`
- `CODE_WEBSOCKET_HOST`

---

_Auto-generated against commit `defc71271dc68db47e0d376be7aa9f755da0ac91` on `2026-07-14T08:47:00.044Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter agent-coda docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

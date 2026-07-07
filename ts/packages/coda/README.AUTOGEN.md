<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=affeeed1f2557004b63f4c956995588a284fc5b5d5f289e588dd89c27dcd0861 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# agent-coda — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `agent-coda` package is a TypeScript library that enables voice-controlled coding assistance through the Coda Operated Assistance (CODA) system. It integrates with Visual Studio Code (VSCode) to allow users to perform various coding tasks using voice commands, enhancing productivity and accessibility.

## What it does

The `agent-coda` package provides a range of actions that can be executed within VSCode, triggered by commands issued through the TypeAgent shell or CLI. These actions cover a variety of coding and workspace management tasks, including:

- **File Management**: Actions like `createFile` and `openFile` allow users to create new files, open existing ones, and manage file content.
- **Editor Layout**: The `changeEditorColumns` action adjusts the editor layout to single, double, or triple columns.
- **Extension Management**: Actions such as `checkExtensionAvailable` enable users to search for, install, and manage VSCode extensions.
- **Debugging**: The `startDebugging` action initiates debugging sessions with specified configurations.
- **Workbench Operations**: Actions like managing workspace folders and opening files are handled by `handleWorkBenchActions`.

These capabilities are designed to streamline coding workflows and make VSCode more accessible for users who prefer or require voice-based interaction.

## Setup

To use the `agent-coda` package, you need to configure the following environment variables:

- `AGENT_SERVER_URL`: The URL of the agent server. This is required for the package to communicate with the TypeAgent server.
- `CODE_WEBSOCKET_HOST`: The WebSocket host for connecting to the TypeAgent shell or CLI.

Set these variables in your shell environment or in a `.env` file located in the `ts/` directory. For additional setup details, refer to the hand-written README.

To build the VSCode extension, run the following command in the package directory:

```bash
pnpm run build
```

To deploy the extension locally in your VSCode environment, use:

```bash
pnpm run deploy:local
```

After deployment, verify that the extension is installed by running:

```bash
code --list-extensions
```

You should see `aisystems.copilot-coda` in the list of installed extensions. If needed, you can uninstall the extension using:

```bash
code --uninstall-extension aisystems.copilot-coda
```

## Key Files

The `agent-coda` package is organized into several key files, each responsible for specific functionalities:

- [codeUtils.ts](./src/codeUtils.ts): Contains utility functions for code manipulation, such as ensuring proper syntax closures and generating documentation comments.
- [commandAliasMgr.ts](./src/commandAliasMgr.ts): Manages command aliases to simplify voice command recognition and execution.
- [extension.ts](./src/extension.ts): The main entry point for the VSCode extension, responsible for activation and command registration.
- [handleDebugActions.ts](./src/handleDebugActions.ts): Implements actions related to debugging, such as starting debugging sessions.
- [handleEditorCodeActions.ts](./src/handleEditorCodeActions.ts): Handles actions for code editing, including creating files and inserting code snippets.
- [handleExtensionActions.ts](./src/handleExtensionActions.ts): Manages VSCode extensions, including searching, installing, and verifying their availability.
- [handleVSCodeActions.ts](./src/handleVSCodeActions.ts): Handles general VSCode actions, such as changing editor layouts and managing settings.
- [handleWorkBenchActions.ts](./src/handleWorkBenchActions.ts): Focuses on workbench-related actions, such as opening files and managing workspace folders.

## How to extend

To extend the functionality of the `agent-coda` package, follow these steps:

1. **Identify the action to modify or add**:

   - Review the existing actions in files like [handleEditorCodeActions.ts](./src/handleEditorCodeActions.ts), [handleVSCodeActions.ts](./src/handleVSCodeActions.ts), or other handler files.
   - Determine whether you need to enhance an existing action or create a new one.

2. **Implement the action logic**:

   - For new actions, create a function in the appropriate handler file. For example, if the action involves file management, add it to [handleEditorCodeActions.ts](./src/handleEditorCodeActions.ts).
   - Ensure the function processes input parameters correctly and performs the desired VSCode operation.

3. **Register the action**:

   - Add the new action to the appropriate handler file and ensure it is registered in [extension.ts](./src/extension.ts).

4. **Test the action**:

   - Write unit tests to validate the new or modified action. Test the action in a VSCode environment to ensure it behaves as expected.

5. **Update documentation**:
   - Document the new or modified action, including its parameters, expected behavior, and any relevant examples. Update the hand-written README if necessary.

By following these steps, you can enhance the `agent-coda` package to support additional voice commands and coding workflows.

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

_Auto-generated against commit `366aaf867a7e8e5d130b6c87a365516bab725269` on `2026-07-07T09:05:05.703Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter agent-coda docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=5af77e4ff4664550315aa7731993925c1fdd1559dd470c712b1ba44410110adf -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# agent-shell â€” AI-generated documentation

> ðŸ¤– **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h â€” see the staleness footer at the end of this file.

## Overview

The `agent-shell` package is a TypeScript library that serves as the UI entry point for the TypeAgent sample code. It explores architectures for building interactive agents with natural language interfaces using structured prompting and large language models (LLMs). The shell acts as a personal agent that processes user requests, performs actions, answers questions, and engages in conversations using an extensible set of agents.

## What it does

The `agent-shell` package provides a graphical interface for interacting with TypeAgent. It supports various actions such as managing conversations, processing speech input, and handling commands. Key functionalities include:

- **Conversation Management**: Create, switch, rename, and delete conversations using commands like `conversation list`, `conversation new [name]`, `conversation switch <id|name>`, `conversation rename <id> <name>`, and `conversation delete <id|name>`.
- **Speech Processing**: Utilize Azure Speech Services or Local Whisper Service for voice input.
- **Command Handling**: Execute various commands through the shell interface.
- **Multi-client Notifications**: Display status messages when multiple clients are connected to the same conversation.

## Setup

To set up the `agent-shell` package, you need to configure several environment variables and follow specific instructions for building and running the shell. The required environment variables are:

- `ELECTRON_RENDERER_URL`: URL for the Electron renderer.
- `SPEECH_SDK_ENDPOINT`: Service URL or speech API resource ID for Azure Speech Services.
- `SPEECH_SDK_KEY`: API key for Azure Speech Services.
- `SPEECH_SDK_REGION`: Region of the Azure Speech Services (e.g., `westus2`).

Additionally, you need to install the necessary libraries for building and using Electron in a Linux/WSL environment. Follow the instructions provided in the Electron documentation (`https://www.electronjs.org/docs/latest/development/build-instructions-linux`) to complete this setup.

For detailed setup steps, including keyless API access for Azure Speech Services, refer to the hand-written README.

## Key Files
The `agent-shell` package is organized into several key components:

- **Main Entry Point**: The main entry point is located at [./src/main/index.ts](./src/main/index.ts), which initializes the shell and sets up the necessary configurations.
- **Command Handlers**: Command handlers are defined in files like [localWhisperCommandHandler.ts](./src/main/localWhisperCommandHandler.ts) and [commands/pen.ts](./src/main/commands/pen.ts). These handlers process specific commands and actions.
- **Speech Processing**: Speech processing functionalities are implemented in [azureSpeech.ts](./src/main/azureSpeech.ts), which handles interactions with Azure Speech Services.
- **Browser IPC**: The browser IPC component, defined in [browserIpc.ts](./src/main/browserIpc.ts), manages inter-process communication between the shell and the browser.
- **Chat Server**: The chat server, implemented in [chatServer.ts](./src/main/chatServer.ts), handles WebSocket connections and serves the HTML page for the shell interface.

## How to extend

To extend the `agent-shell` package, follow these steps:

1. **Open the main entry point**: Start by examining [index.ts](./src/main/index.ts) to understand the initialization process and overall structure.
2. **Add new command handlers**: Implement new command handlers in appropriate files, such as [commands/pen.ts](./src/main/commands/pen.ts). Follow the existing patterns for defining and registering command handlers.
3. **Integrate new services**: If you need to integrate new services (e.g., speech processing), modify or add files like [azureSpeech.ts](./src/main/azureSpeech.ts) to handle interactions with the new service.
4. **Test your changes**: Ensure that your changes are thoroughly tested. Run the shell using `pnpm run shell` and verify that the new functionalities work as expected.

By following these steps, you can effectively extend the capabilities of the `agent-shell` package and contribute to its development.

## Reference

> âš™ï¸ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default â†’ [./out/main/index.js](./out/main/index.js)

### Dependencies

Workspace:

- [@typeagent/agent-rpc](../../packages/agentRpc/README.md)
- [@typeagent/agent-sdk](../../packages/agentSdk/README.md)
- [@typeagent/agent-server-client](../../packages/agentServer/client/README.md)
- [@typeagent/common-utils](../../packages/utils/commonUtils/README.md)
- [@typeagent/completion-ui](../../packages/completionUI/README.md)
- [@typeagent/dispatcher-rpc](../../packages/dispatcher/rpc/README.md)
- [agent-dispatcher](../../packages/dispatcher/dispatcher/README.md)
- [aiclient](../../packages/aiclient/README.md)
- [browser-typeagent](../../packages/agents/browser/README.md)
- [default-agent-provider](../../packages/defaultAgentProvider/README.md)
- [dispatcher-node-providers](../../packages/dispatcher/nodeProviders/README.md)
- [typeagent](../../packages/typeagent/README.md)
- [typechat-utils](../../packages/utils/typechatUtils/README.md)
- [websocket-utils](../../packages/utils/webSocketUtils/README.md)

External: `@azure/identity`, `@azure/msal-node-extensions`, `@electron-toolkit/preload`, `ansi_up`, `debug`, `dompurify`, `dotenv`, `electron-updater`, `jose`, `markdown-it`, `microsoft-cognitiveservices-speech-sdk`, `typechat`, `ws`

### Files of interest

`./src/main/index.ts`, `./src/main/localWhisperCommandHandler.ts`, `./src/main/speechProcessingSchema.ts`, â€¦and 83 more under `./src/`.

### Environment variables

_4 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `ELECTRON_RENDERER_URL`
- `SPEECH_SDK_ENDPOINT`
- `SPEECH_SDK_KEY`
- `SPEECH_SDK_REGION`

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T10:06:08.874Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter agent-shell docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

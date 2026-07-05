<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=a790433dc1e16c4346ebef2cb2e7382c7c6bf068262305c6b46ebb112db2b634 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# agent-shell — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `agent-shell` package is a TypeScript library that serves as the UI entry point for the TypeAgent sample code. It demonstrates architectures for building interactive agents with natural language interfaces using structured prompting and large language models (LLMs). The shell functions as a personal agent, capable of processing user requests, performing actions, answering questions, and engaging in conversations through an extensible set of agents.

## What it does

The `agent-shell` package provides a graphical interface for interacting with TypeAgent. Its key features include:

- **Conversation Management**: Users can create, switch, rename, and delete conversations. Commands such as `conversation list`, `conversation new [name]`, `conversation switch <id|name>`, `conversation rename <id> <name>`, and `conversation delete <id|name>` allow for flexible conversation handling. Conversations persist across sessions, and the shell supports multi-conversation management when connected to an agent server.
- **Speech Input**: The shell supports voice input through Azure Speech Services or a Local Whisper Service, enabling users to interact with the system using speech in addition to text input.
- **Command Execution**: The shell processes various commands, including natural language inputs, to perform tasks or retrieve information.
- **Multi-client Notifications**: When multiple clients are connected to the same conversation, the shell displays status messages to inform users of client activity.
- **Local Mode**: In the absence of an agent server, the shell operates in local mode, hosting a WebSocket for in-process port discovery and enabling external clients to connect to in-process agents.

The shell integrates with other components of the TypeAgent ecosystem, such as the dispatcher and agent server, to provide an interactive user experience.

## Setup

To set up the `agent-shell` package, follow these steps:

1. **Install Dependencies**: Ensure you have all required dependencies installed. The shell is built using Electron, so you may need to install additional libraries for your operating system. For Linux/WSL users, refer to the build instructions provided in the Electron documentation (`https://www.electronjs.org/docs/latest/development/build-instructions-linux`).

2. **Configure Environment Variables**: Set the following environment variables in your `.env` file or system environment:

   - `ELECTRON_RENDERER_URL`: The URL for the Electron renderer.
   - `SPEECH_SDK_ENDPOINT`: The service URL or speech API resource ID for Azure Speech Services.
   - `SPEECH_SDK_KEY`: The API key for Azure Speech Services.
   - `SPEECH_SDK_REGION`: The region of the Azure Speech Services (e.g., `westus2`).
   - `WEBSOCKET_HOST`: The host for WebSocket connections.

3. **Run the Shell**: Use the following command to start the shell:

   ```shell
   pnpm run shell
   ```

4. **Optional Configuration for Azure Speech Services**: To enable voice input via Azure Speech Services, additional setup is required:
   - Set `SPEECH_SDK_KEY` to `identity` in your `.env` file or `config.local.yaml` for keyless API access.
   - Replace the `SPEECH_SDK_ENDPOINT` value with the Azure resource ID of your cognitive service instance (e.g., `/subscriptions/<your-subscription-guid>/resourceGroups/myResourceGroup/providers/Microsoft.CognitiveServices/accounts/speechapi`).
   - Configure your Azure Speech API to support identity-based authentication.

For more details on setup, including troubleshooting tips for Windows users, refer to the hand-written README.

## Key Files

The `agent-shell` package is organized into several key components:

- **Main Entry Point**: The primary entry point is [index.ts](./src/main/index.ts), which initializes the shell and sets up configurations.
- **Command Handlers**: Command processing is implemented in files such as [localWhisperCommandHandler.ts](./src/main/localWhisperCommandHandler.ts) and [commands/pen.ts](./src/main/commands/pen.ts). These files define the logic for handling specific commands.
- **Speech Processing**: The [azureSpeech.ts](./src/main/azureSpeech.ts) file manages interactions with Azure Speech Services, including token handling and speech-to-text processing.
- **Browser IPC**: The [browserIpc.ts](./src/main/browserIpc.ts) file handles inter-process communication between the shell and the browser.
- **Chat Server**: The [chatServer.ts](./src/main/chatServer.ts) file implements the WebSocket server for managing chat interactions and serving the shell's HTML interface.

## How to extend

To extend the `agent-shell` package, follow these steps:

1. **Understand the Initialization Process**: Start by reviewing [index.ts](./src/main/index.ts) to understand how the shell is initialized and configured.
2. **Add New Command Handlers**: Implement new command handlers in files like [commands/pen.ts](./src/main/commands/pen.ts). Use the existing patterns for defining and registering handlers.
3. **Integrate Additional Services**: If you need to add new services (e.g., for speech processing or external APIs), modify or create files such as [azureSpeech.ts](./src/main/azureSpeech.ts) to handle the integration.
4. **Test Your Changes**: Run the shell using `pnpm run shell` and verify that your changes work as intended. Ensure that all new functionality is thoroughly tested.
5. **Follow Existing Patterns**: Adhere to the established coding conventions and patterns in the project to maintain consistency and readability.

By following these guidelines, you can effectively contribute to the development and enhancement of the `agent-shell` package.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./out/main/index.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/agent-rpc](../../packages/agentRpc/README.md)
- [@typeagent/agent-sdk](../../packages/agentSdk/README.md)
- [@typeagent/agent-server-client](../../packages/agentServer/client/README.md)
- [@typeagent/agent-server-protocol](../../packages/agentServer/protocol/README.md)
- [@typeagent/aiclient](../../packages/aiclient/README.md)
- [@typeagent/common-utils](../../packages/utils/commonUtils/README.md)
- [@typeagent/completion-ui](../../packages/completionUI/README.md)
- [@typeagent/config](../../packages/config/README.md)
- [@typeagent/dispatcher-rpc](../../packages/dispatcher/rpc/README.md)
- [@typeagent/dispatcher-types](../../packages/dispatcher/types/README.md)
- [@typeagent/websocket-utils](../../packages/utils/webSocketUtils/README.md)
- [agent-dispatcher](../../packages/dispatcher/dispatcher/README.md)
- [agent-server](../../packages/agentServer/server/README.md)
- [browser-typeagent](../../packages/agents/browser/README.md)
- [chat-ui](../../packages/chat-ui/README.md)
- [default-agent-provider](../../packages/defaultAgentProvider/README.md)
- [dispatcher-node-providers](../../packages/dispatcher/nodeProviders/README.md)
- [typeagent](../../packages/typeagent/README.md)
- [typechat-utils](../../packages/utils/typechatUtils/README.md)
- [websocket-channel-server](../../packages/utils/webSocketChannelServer/README.md)

External: `@azure/identity`, `@azure/msal-node-extensions`, `@electron-toolkit/preload`, `ansi_up`, `debug`, `dompurify`, `dotenv`, `electron-updater`, `jose`, `js-yaml`, `markdown-it`, `microsoft-cognitiveservices-speech-sdk`, `typechat`, `ws`

### Files of interest

`./src/main/index.ts`, `./src/main/localWhisperCommandHandler.ts`, `./src/main/speechProcessingSchema.ts`, …and 65 more under `./src/`.

### Environment variables

_5 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `ELECTRON_RENDERER_URL`
- `SPEECH_SDK_ENDPOINT`
- `SPEECH_SDK_KEY`
- `SPEECH_SDK_REGION`
- `WEBSOCKET_HOST`

---

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-05T09:01:32.154Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter agent-shell docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

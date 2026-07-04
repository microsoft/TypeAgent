<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=a790433dc1e16c4346ebef2cb2e7382c7c6bf068262305c6b46ebb112db2b634 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# agent-shell — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `agent-shell` package is a TypeScript library that serves as the graphical user interface (GUI) for the TypeAgent framework. It is designed to demonstrate how interactive agents with natural language interfaces can be built using structured prompting and large language models (LLMs). The shell acts as a personal agent, enabling users to issue requests, perform actions, ask questions, and engage in conversations. It integrates with other components of the TypeAgent ecosystem, such as the dispatcher and agent server, to provide a cohesive and interactive experience.

## What it does

The `agent-shell` package provides a rich set of features to facilitate interaction with the TypeAgent framework:

### Conversation Management

- **Multi-Conversation Support**: Users can create, switch, rename, and delete conversations. Conversations persist across sessions, and the shell supports managing multiple conversations when connected to an agent server.
- **Default Conversation**: Upon connecting to the agent server, the shell automatically joins a default conversation named `"Shell"`. This conversation is persistent, and its history is replayed on reconnect.
- **Commands for Conversation Management**: Users can manage conversations using commands such as:
  - `/conversation list` to list all conversations.
  - `/conversation new [name]` to create a new conversation.
  - `/conversation switch <id|name>` to switch to a specific conversation.
  - `/conversation rename [id|name] <newName>` to rename a conversation.
  - `/conversation delete <id|name>` to delete a conversation.

### Speech Input

The shell supports voice input through:

- **Azure Speech Services**: Allows users to interact with the shell using voice commands. Requires configuration of Azure Speech API credentials.
- **Local Whisper Service**: An alternative to Azure Speech Services for local speech-to-text processing.

### Local Mode

In the absence of an agent server, the shell operates in local mode:

- A single default conversation is available.
- The shell hosts an in-process WebSocket on `ws://localhost:8999/` for port discovery, enabling external clients to connect to in-process agents.

### Multi-Client Notifications

The shell provides real-time notifications when multiple clients (e.g., another shell or CLI) connect to or disconnect from the same conversation.

### Request Queue Management

The shell manages a queue of user requests:

- Requests are queued if another request is already in progress.
- Users can cancel queued or running requests directly from the UI.

## Setup

To set up and run the `agent-shell` package, follow these steps:

1. **Install Dependencies**:

   - The shell is built using Electron. Linux/WSL users should follow the build instructions provided in the Electron documentation (`https://www.electronjs.org/docs/latest/development/build-instructions-linux`) to install the necessary libraries.

2. **Set Environment Variables**:
   Configure the following environment variables in your `.env` file or system environment:

   - `ELECTRON_RENDERER_URL`: The URL for the Electron renderer.
   - `SPEECH_SDK_ENDPOINT`: The service URL or speech API resource ID for Azure Speech Services.
   - `SPEECH_SDK_KEY`: The API key for Azure Speech Services.
   - `SPEECH_SDK_REGION`: The region of the Azure Speech Services (e.g., `westus2`).
   - `WEBSOCKET_HOST`: The host for WebSocket connections.

3. **Run the Shell**:
   Start the shell using the following command:

   ```shell
   pnpm run shell
   ```

4. **Optional: Configure Azure Speech Services**:

   - To enable voice input via Azure Speech Services, set `SPEECH_SDK_KEY` to `identity` in your `.env` file or `config.local.yaml` for keyless API access.
   - Replace the `SPEECH_SDK_ENDPOINT` value with the Azure resource ID of your cognitive service instance (e.g., `/subscriptions/<your-subscription-guid>/resourceGroups/myResourceGroup/providers/Microsoft.CognitiveServices/accounts/speechapi`).
   - Configure your Azure Speech API to support identity-based authentication.

5. **Windows-Specific Notes**:
   - If you experience lag during startup, consider adding the source code folder to the exclusions list for Windows Defender. Refer to the Windows support documentation for instructions.
   - If using MS Graph-based sample agents (e.g., Calendar or Email), you may need to clear the identity cache if the authentication token becomes corrupted. Run the following command to delete the cache:
     ```shell
     del %LOCALAPPDATA%\.IdentityService\typeagent-tokencache
     ```

## Key Files

The `agent-shell` package is organized into several key files, each responsible for specific functionality:

- **[index.ts](./src/main/index.ts)**: The main entry point for initializing the shell and setting up configurations.
- **[localWhisperCommandHandler.ts](./src/main/localWhisperCommandHandler.ts)**: Handles commands related to the Local Whisper Service for speech-to-text processing.
- **[azureSpeech.ts](./src/main/azureSpeech.ts)**: Manages interactions with Azure Speech Services, including token handling and speech-to-text processing.
- **[browserIpc.ts](./src/main/browserIpc.ts)**: Handles inter-process communication (IPC) between the shell and the browser.
- **[chatServer.ts](./src/main/chatServer.ts)**: Implements the WebSocket server for managing chat interactions and serving the shell's HTML interface.
- **[commands/pen.ts](./src/main/commands/pen.ts)**: Contains logic for handling pen-related commands and events, including integration with a local endpoint for pen events.

## How to extend

To extend the functionality of the `agent-shell` package, follow these steps:

1. **Familiarize Yourself with the Codebase**:

   - Start by reviewing [index.ts](./src/main/index.ts) to understand the initialization process and overall architecture.

2. **Add New Commands**:

   - Create new command handlers in the `commands` directory (e.g., [commands/pen.ts](./src/main/commands/pen.ts)).
   - Use the `CommandHandler` and `CommandHandlerTable` utilities from `@typeagent/agent-sdk` to define and register new commands.

3. **Enhance Speech Processing**:

   - To add new speech processing capabilities, extend the logic in [azureSpeech.ts](./src/main/azureSpeech.ts) or [localWhisperCommandHandler.ts](./src/main/localWhisperCommandHandler.ts).

4. **Modify or Add IPC Functionality**:

   - If you need to enable new forms of inter-process communication, extend the [browserIpc.ts](./src/main/browserIpc.ts) file.

5. **Test Your Changes**:

   - Use `pnpm run shell` to test your changes in the shell environment.
   - Ensure that all new features are thoroughly tested and do not introduce regressions.

6. **Follow Coding Standards**:
   - Adhere to the existing patterns and conventions in the codebase to maintain consistency and readability.

By following these steps, you can effectively contribute to the development and enhancement of the `agent-shell` package.

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

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-04T08:54:09.388Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter agent-shell docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

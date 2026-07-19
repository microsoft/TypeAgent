<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=f3163713b44484c5dcdabee1cc1d7c587a97b13b528ae69e10819fd1270b1de6 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# agent-shell — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `agent-shell` package is a TypeScript library that serves as the graphical user interface (GUI) entry point for the TypeAgent ecosystem. It provides a personal agent interface for processing user requests, performing actions, answering questions, and managing conversations. Built on Electron, the shell integrates with other TypeAgent components, such as the dispatcher and agent server, to deliver an interactive and extensible experience. It supports both text and voice input, multi-conversation management, and local or remote operation modes.

## What it does

The `agent-shell` package offers a variety of features to enable interactive and conversational agent experiences:

### Conversation Management

- **Multi-Conversation Support**: Users can create, switch, rename, and delete conversations. Conversations persist across sessions, and history is replayed on reconnect.
- **Default Conversation**: Automatically joins a default conversation named `"Shell"` when connected to the agent server. This conversation is persistent and serves as the starting point for interactions.
- **Commands for Conversation Management**: Users can manage conversations using commands like `/conversation list`, `/conversation new [name]`, `/conversation switch <id|name>`, and more. These commands can also be executed via natural language inputs.
- **Request Queue Management**: Visual indicators for queued and running requests allow users to manage and cancel requests directly from the chat interface.

### Speech Input

- **Azure Speech Services**: Enables speech-to-text functionality using Azure's cloud-based service.
- **Local Whisper Service**: Provides an alternative for speech-to-text processing using a local service.

### Multi-Client Notifications

- The shell notifies users when other clients join or leave the same conversation, facilitating collaborative interactions.

### Local Mode

- In the absence of an agent server, the shell operates in local mode, providing a single default conversation and hosting an in-process WebSocket for port discovery. This allows external clients, such as the browser agent, to connect to in-process agents.

### Integration with TypeAgent Ecosystem

- The shell integrates with the TypeAgent dispatcher and agent server to route user requests to the appropriate agents for processing. It also supports external clients via WebSocket connections.

## Setup

To set up and run the `agent-shell` package, follow these steps:

1. **Install Dependencies**:

   - The shell is built using Electron. If you are using Linux or WSL, you may need to install additional libraries. Refer to the Electron build instructions for Linux at `https://www.electronjs.org/docs/latest/development/build-instructions-linux`.

2. **Set Environment Variables**:

   - Configure the following environment variables in your `.env` file or system environment:
     - `ELECTRON_RENDERER_URL`: The URL for the Electron renderer.
     - `SPEECH_SDK_ENDPOINT`: The service URL or speech API resource ID for Azure Speech Services.
     - `SPEECH_SDK_KEY`: The API key for Azure Speech Services.
     - `SPEECH_SDK_REGION`: The region of the Azure Speech Services (e.g., `westus2`).
     - `TYPEAGENT_MODEL_PROVIDER`: Specifies the model provider for TypeAgent.
     - `WEBSOCKET_HOST`: The host for WebSocket connections.

3. **Run the Shell**:

   - Start the shell using the following command:
     ```shell
     pnpm run shell
     ```

4. **Optional: Configure Azure Speech Services**:

   - To enable voice input via Azure Speech Services, additional setup is required:
     - Set `SPEECH_SDK_KEY` to `identity` in your `.env` file or `config.local.yaml` for keyless API access.
     - Replace the `SPEECH_SDK_ENDPOINT` value with the Azure resource ID of your cognitive service instance (e.g., `/subscriptions/<your-subscription-guid>/resourceGroups/myResourceGroup/providers/Microsoft.CognitiveServices/accounts/speechapi`).
     - Configure your Azure Speech API to support identity-based authentication.

5. **Windows-Specific Notes**:
   - If you experience lag during startup, consider adding the source code folder to the exclusions list for Windows Defender. Instructions can be found in the hand-written README.
   - For MS Graph-based sample agents (e.g., Calendar and Email), you may need to clear the identity cache if the authentication token becomes corrupted. Use the following command:
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
- **[commands/pen.ts](./src/main/commands/pen.ts)**: Contains the implementation of the `pen` command, which interacts with a local endpoint for pen events and speech recognition.

## How to extend

To extend the functionality of the `agent-shell` package, follow these steps:

1. **Understand the Codebase**:

   - Begin by reviewing [index.ts](./src/main/index.ts) to understand the initialization and configuration process of the shell.

2. **Add New Commands**:

   - To introduce new commands, create a new file in the `commands` directory (e.g., `./src/main/commands/yourCommand.ts`).
   - Use the existing command handler pattern as a reference. For example, see [commands/pen.ts](./src/main/commands/pen.ts).

3. **Integrate New Services**:

   - If you need to add support for additional services (e.g., new APIs or external integrations), create or modify files like [azureSpeech.ts](./src/main/azureSpeech.ts) to handle the integration.

4. **Enhance Conversation Management**:

   - To extend conversation-related features, review the existing implementation in [chatServer.ts](./src/main/chatServer.ts) and [browserIpc.ts](./src/main/browserIpc.ts). Add new functionality as needed.

5. **Test Your Changes**:

   - Use the `pnpm run shell` command to test your changes in the shell environment. Ensure that all new features are thoroughly tested and do not introduce regressions.

6. **Follow Established Patterns**:
   - Maintain consistency with the existing codebase by adhering to the established coding conventions and patterns.

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

_6 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `ELECTRON_RENDERER_URL`
- `SPEECH_SDK_ENDPOINT`
- `SPEECH_SDK_KEY`
- `SPEECH_SDK_REGION`
- `TYPEAGENT_MODEL_PROVIDER`
- `WEBSOCKET_HOST`

---

_Auto-generated against commit `c97eb42726a9196c7ac72138faa0777c5cbc1aab` on `2026-07-18T09:48:36.613Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter agent-shell docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

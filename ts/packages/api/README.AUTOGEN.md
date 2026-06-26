<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=dae6c8179adc679d05668ab4a615670c991ae7f1ea83adb5cbf65ad5f1b9f47c -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# agent-api — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `agent-api` package is a TypeScript library that provides a HTTP and WebSocket API server for the TypeAgent sample code. It is designed to facilitate the development of distributed interactive agents with natural language interfaces using structured prompting and large language models (LLMs). This package enables developers to extend the reach of agents to web-enabled devices such as internet browsers, mobile phones, and IoT connected devices.

## What it does

The `agent-api` package offers several key functionalities:

- **HTTP and WebSocket Server**: It provides a server that can handle HTTP and WebSocket connections, allowing for real-time communication with agents.
- **Storage Providers**: It supports multiple storage providers, including AWS S3 and Azure Blob Storage, for managing remote files.
- **Web Dispatcher**: It includes a web dispatcher for handling actions and commands sent to the agents.
- **Configuration Management**: It uses environment variables to configure the server and storage providers.

The package includes actions such as `listRemoteFiles`, `downloadFile`, and `uploadFile` for interacting with remote storage, and it integrates with other TypeAgent packages like `agent-cache`, `agent-dispatcher`, and `telemetry`.

## Setup

To set up the `agent-api` package, you need to configure several environment variables related to AWS S3:

- `AWS_ACCESS_KEY_ID`: Your AWS access key ID.
- `AWS_S3_BUCKET_NAME`: The name of your AWS S3 bucket.
- `AWS_S3_REGION`: The region where your AWS S3 bucket is located.
- `AWS_SECRET_ACCESS_KEY`: Your AWS secret access key.

These environment variables are essential for the package to interact with AWS S3 for storage purposes. Ensure that these variables are set in your `.env` file or your shell environment.

For detailed setup instructions, including how to obtain these values, see the hand-written README.

## Key Files

The `agent-api` package is structured into several key components:

- **[index.ts](./src/index.ts)**: The entry point of the package, which initializes and starts the TypeAgent server.
- **[storageProvider.ts](./src/storageProvider.ts)**: Defines the interface for storage providers, including methods for listing, downloading, and uploading files.
- **[awsStorageProvider.ts](./src/storageProviders/awsStorageProvider.ts)**: Implements the storage provider interface for AWS S3.
- **[azureStorageProvider.ts](./src/storageProviders/azureStorageProvider.ts)**: Implements the storage provider interface for Azure Blob Storage.
- **[typeAgentServer.ts](./src/typeAgentServer.ts)**: Manages the initialization and configuration of the TypeAgent server, including the web dispatcher and storage providers.
- **[webDispatcher.ts](./src/webDispatcher.ts)**: Handles actions and commands sent to the agents via WebSocket.
- **[webServer.ts](./src/webServer.ts)**: Implements the HTTP and HTTPS server for handling incoming requests.

## How to extend

To extend the `agent-api` package, follow these steps:

1. **Add a new storage provider**:

   - Create a new file in the `src/storageProviders` directory.
   - Implement the `TypeAgentStorageProvider` interface defined in [storageProvider.ts](./src/storageProvider.ts).
   - Ensure that the new storage provider handles methods like `listRemoteFiles`, `downloadFile`, and `uploadFile`.

2. **Modify the server configuration**:

   - Update [typeAgentServer.ts](./src/typeAgentServer.ts) to include your new storage provider.
   - Adjust the server configuration as needed to support additional features or integrations.

3. **Handle new actions**:

   - Extend the web dispatcher in [webDispatcher.ts](./src/webDispatcher.ts) to handle new actions.
   - Implement the logic for processing these actions and interacting with the agents.

4. **Test your changes**:
   - Write unit tests for your new storage provider and actions.
   - Run the tests to ensure that your changes work as expected.

By following these steps, you can extend the functionality of the `agent-api` package to support additional storage providers, actions, and configurations.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)

### Dependencies

Workspace:

- [@typeagent/agent-rpc](../../packages/agentRpc/README.md)
- [@typeagent/agent-sdk](../../packages/agentSdk/README.md)
- [@typeagent/aiclient](../../packages/aiclient/README.md)
- [@typeagent/config](../../packages/config/README.md)
- [@typeagent/dispatcher-rpc](../../packages/dispatcher/rpc/README.md)
- [agent-cache](../../packages/cache/README.md)
- [agent-dispatcher](../../packages/dispatcher/dispatcher/README.md)
- [default-agent-provider](../../packages/defaultAgentProvider/README.md)
- [dispatcher-node-providers](../../packages/dispatcher/nodeProviders/README.md)
- [telemetry](../../packages/telemetry/README.md)
- [typeagent](../../packages/typeagent/README.md)
- [typechat-utils](../../packages/utils/typechatUtils/README.md)

External: `@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, `@azure/identity`, `@azure/storage-blob`, `chalk`, `debug`, `dotenv`, `find-config`, `ws`

### Files of interest

`./src/index.ts`, `./src/storageProvider.ts`, `./src/storageProviders/awsStorageProvider.ts`, …and 6 more under `./src/`.

### Environment variables

_4 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `AWS_ACCESS_KEY_ID`
- `AWS_S3_BUCKET_NAME`
- `AWS_S3_REGION`
- `AWS_SECRET_ACCESS_KEY`

---

_Auto-generated against commit `127a36a95a15e918be533d6eaaf08adebe9070d9` on `2026-06-26T03:01:52.873Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter agent-api docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=b4fe216fb0ab98157efb5b355bbbde9f85ae494ff7a85aef7774bf4c83a9c522 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# agent-api — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `agent-api` package is a TypeScript library that provides an HTTP and WebSocket API server for the TypeAgent ecosystem. It is designed to enable distributed interactive agents with natural language interfaces, extending their functionality to web-enabled devices such as browsers, mobile devices, and IoT systems. This package is a key component of the TypeAgent architecture, facilitating communication, storage, and configuration for agent-based applications.

## What it does

The `agent-api` package offers the following capabilities:

- **HTTP and WebSocket API Server**: Serves as the main interface for interacting with agents, supporting both HTTP and WebSocket protocols for real-time communication.
- **Storage Provider Integration**: Includes support for multiple storage backends, such as AWS S3 and Azure Blob Storage, enabling actions like `listRemoteFiles`, `downloadFile`, and `uploadFile`.
- **Web Dispatcher**: Manages WebSocket connections and processes actions sent to agents, allowing dynamic interaction and command execution.
- **Configuration Management**: Uses environment variables to configure the server and storage providers, ensuring flexibility across different deployment environments.
- **Static File Hosting**: Serves static files, such as the Shell interface (`chatView.html`), for browser-based interaction with agents.

The package integrates with other components in the TypeAgent ecosystem, such as `agent-cache`, `agent-dispatcher`, and `telemetry`, to provide a cohesive framework for building and managing interactive agents.

## Setup

To use the `agent-api` package, you need to configure the following environment variables for AWS S3 integration:

- `AWS_ACCESS_KEY_ID`: Your AWS access key ID.
- `AWS_S3_BUCKET_NAME`: The name of your AWS S3 bucket.
- `AWS_S3_REGION`: The AWS region where your S3 bucket is located.
- `AWS_SECRET_ACCESS_KEY`: Your AWS secret access key.

These variables are required for the package to interact with AWS S3 for storage operations. You can set these variables in a `.env` file or directly in your shell environment. For more details on obtaining these values, refer to the hand-written README.

### Running the Server

1. **Locally**: Start the server with `npm run start` in the package directory. The server will be accessible at `http://localhost:3000`. To access the Shell interface, navigate to `http://localhost:3000/chatView.html`.

2. **Using Docker**: Deploy the server using the provided Docker image. This allows you to host the API locally or in a cloud environment, such as Azure App Service.

## Key Files

The `agent-api` package is organized into several key files, each responsible for specific functionality:

- **[index.ts](./src/index.ts)**: The main entry point of the package. It initializes and starts the TypeAgent server.
- **[storageProvider.ts](./src/storageProvider.ts)**: Defines the `TypeAgentStorageProvider` interface, which specifies methods for interacting with remote storage, such as `listRemoteFiles`, `downloadFile`, and `uploadFile`.
- **[storageProviders/awsStorageProvider.ts](./src/storageProviders/awsStorageProvider.ts)**: Implements the `TypeAgentStorageProvider` interface for AWS S3, enabling file operations like listing, downloading, and uploading files.
- **[storageProviders/azureStorageProvider.ts](./src/storageProviders/azureStorageProvider.ts)**: Implements the `TypeAgentStorageProvider` interface for Azure Blob Storage.
- **[typeAgentServer.ts](./src/typeAgentServer.ts)**: Manages the initialization and configuration of the TypeAgent server, including the integration of storage providers and the web dispatcher.
- **[webDispatcher.ts](./src/webDispatcher.ts)**: Handles actions and commands sent to agents via WebSocket connections. It processes actions such as `listRemoteFiles`, `downloadFile`, and `uploadFile`.
- **[webServer.ts](./src/webServer.ts)**: Implements the HTTP and HTTPS server for handling incoming requests and serving static files.

## How to extend

To extend the functionality of the `agent-api` package, follow these steps:

1. **Add a New Storage Provider**:

   - Create a new file in the `src/storageProviders` directory.
   - Implement the `TypeAgentStorageProvider` interface defined in [storageProvider.ts](./src/storageProvider.ts).
   - Ensure the new storage provider supports methods like `listRemoteFiles`, `downloadFile`, and `uploadFile`.

2. **Update the Server Configuration**:

   - Modify [typeAgentServer.ts](./src/typeAgentServer.ts) to include your new storage provider.
   - Update the server initialization logic to accommodate any new features or configurations.

3. **Add New Actions**:

   - Extend the web dispatcher in [webDispatcher.ts](./src/webDispatcher.ts) to handle additional actions.
   - Implement the logic for processing these actions and interacting with the agents.

4. **Test Your Changes**:
   - Write unit tests for your new features, including storage providers and actions.
   - Run the tests to verify that your changes work as expected.

By following these guidelines, you can customize the `agent-api` package to meet your specific requirements and integrate it with additional systems or services.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/index.js` _(not found on disk)_

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

_Auto-generated against commit `10c156699bb8436ffeeb5042da164ea166f9eb74` on `2026-07-22T11:31:33.221Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter agent-api docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

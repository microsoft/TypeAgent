<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=02523b371926f453474515dbaa3064af29cb1eb79239c49c1fd42a6e194f5ad1 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# telemetry — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `telemetry` package is a TypeScript library that provides logging and monitoring capabilities for the TypeAgent project. It enables the collection, storage, and analysis of telemetry data, such as events, logs, and performance metrics. By offering a variety of logger sinks and utilities, the package supports both development and production use cases, making it a core dependency for many other packages and examples in the TypeAgent monorepo.

## What it does

The `telemetry` package is designed to handle diverse logging and monitoring needs through a modular and extensible architecture. Its primary features include:

- **Database Logging**:

  - `createMongoDBLoggerSink`: Logs events to a MongoDB collection.
  - `createCosmosDBLoggerSink`: Logs events to an Azure Cosmos DB container.
  - `createDatabaseLoggerSink`: Dynamically selects between MongoDB and Cosmos DB based on the configured environment variables.

- **Console Logging**:

  - `createDebugLoggerSink`: Logs events to the console using the `debug` library.

- **Specialized Loggers**:

  - `createPromptLogger`: Captures and logs prompts and related data for Large Language Models (LLMs).
  - `createProfileLogger`: Captures and logs profiling data for performance analysis.

- **Multi-Sink Logging**:
  - `MultiSinkLogger`: Combines multiple logger sinks, enabling simultaneous logging to different destinations.

These features allow the `telemetry` package to support a wide range of use cases, from debugging during development to monitoring and analyzing production systems. The package is used extensively across the TypeAgent monorepo, including in components like `agent-api`, `agent-cache`, and `chat-agent`.

## Setup

To use the `telemetry` package, you need to configure the following environment variables:

- `COSMOSDB_CONNECTION_STRING`: The connection string for Azure Cosmos DB. This is required if you plan to use the `createCosmosDBLoggerSink` or `createDatabaseLoggerSink` with Cosmos DB as the backend.
- `MONGODB_CONNECTION_STRING`: The connection string for MongoDB. This is required if you plan to use the `createMongoDBLoggerSink` or `createDatabaseLoggerSink` with MongoDB as the backend.

These environment variables can be set in your shell or in a `.env` file located at the root of the project. For detailed instructions on obtaining these values, refer to the hand-written README.

## Key Files

The `telemetry` package is organized into several key files, each responsible for specific functionality:

- [indexNode.ts](./src/indexNode.ts): The main entry point of the package, exporting all logger sinks, utilities, and core components.
- [logger/logger.ts](./src/logger/logger.ts): Defines the core logging interfaces and classes, such as `Logger`, `LoggerSink`, `ChildLogger`, and `MultiSinkLogger`.
- [logger/cosmosDBLoggerSink.ts](./src/logger/cosmosDBLoggerSink.ts): Implements the `CosmosDBLoggerSink`, which logs events to an Azure Cosmos DB container.
- [logger/mongoLoggerSink.ts](./src/logger/mongoLoggerSink.ts): Implements the `MongoDBLoggerSink`, which logs events to a MongoDB collection.
- [logger/databaseLoggerSink.ts](./src/logger/databaseLoggerSink.ts): Implements the `DatabaseLoggerSink`, which dynamically selects between MongoDB and Cosmos DB based on the configured environment variables.
- [logger/debugLoggerSink.ts](./src/logger/debugLoggerSink.ts): Implements the `DebugLoggerSink`, which logs events to the console using the `debug` library.
- [logger/promptLogger.ts](./src/logger/promptLogger.ts): Implements the `PromptLogger`, a specialized logger for capturing and logging LLM prompts.
- [profiler/profileLogger.ts](./src/profiler/profileLogger.ts): Implements the `ProfileLogger`, which captures and logs profiling data for performance analysis.

## How to extend

The `telemetry` package is designed to be extensible, allowing contributors to add new functionality or modify existing components. Below are some guidelines for extending the package:

### Adding a New Logger Sink

1. **Create a New File**:

   - Add a new file in the `logger` directory, e.g., `customLoggerSink.ts`.

2. **Implement the `LoggerSink` Interface**:

   - Define a new class that implements the `LoggerSink` interface. This interface requires a `logEvent` method to handle logging events.

   ```ts
   import { LoggerSink, LogEvent } from "./logger.js";

   class CustomLoggerSink implements LoggerSink {
     public logEvent(event: LogEvent) {
       // Implement your custom logging logic here
       console.log("Custom log event:", event);
     }
   }

   export function createCustomLoggerSink(): LoggerSink {
     return new CustomLoggerSink();
   }
   ```

3. **Export the New Logger Sink**:
   - Add an export statement for your new logger sink in [indexNode.ts](./src/indexNode.ts).

### Modifying Existing Logger Sinks

1. **Locate the Relevant File**:

   - Identify the file corresponding to the logger sink you want to modify (e.g., [cosmosDBLoggerSink.ts](./src/logger/cosmosDBLoggerSink.ts) for the Cosmos DB logger).

2. **Make Your Changes**:

   - Modify the implementation as needed, ensuring that it still adheres to the `LoggerSink` interface.

3. **Test Your Changes**:
   - Add or update unit tests in the `tests` directory to verify the functionality of your changes.

### Adding New Features

1. **Identify the Entry Point**:

   - Start by reviewing [indexNode.ts](./src/indexNode.ts) to understand how the package's components are exported and used.

2. **Follow Existing Patterns**:

   - Use the existing logger sinks and utilities as a reference for implementing new features.

3. **Write Tests**:
   - Ensure your new feature is thoroughly tested by adding unit tests in the `tests` directory.

By following these guidelines, you can extend the `telemetry` package to meet new requirements or improve its existing functionality.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/indexNode.js](./dist/indexNode.js)

### Dependencies

Workspace:

- [@typeagent/common-utils](../../packages/utils/commonUtils/README.md)

External: `chalk`, `debug`, `dotenv`, `find-config`, `mongodb`

### Used by

- [agent-api](../../packages/api/README.md)
- [agent-cache](../../packages/cache/README.md)
- [agent-cli](../../packages/cli/README.md)
- [agent-dispatcher](../../packages/dispatcher/dispatcher/README.md)
- [azure-ai-foundry](../../packages/azure-ai-foundry/README.md)
- [cache-rest-endpoint](../../examples/cacheRESTEndpoint/README.md)
- [chat-agent](../../packages/agents/chat/README.md)
- [chat-example](../../examples/chat/README.md)
- [code-agent](../../packages/agents/code/README.md)
- [default-agent-provider](../../packages/defaultAgentProvider/README.md)
- _…and 10 more workspace consumers._

### Files of interest

`./src/indexNode.ts`, `./src/logger/cosmosDBLoggerSink.ts`, `./src/logger/databaseLoggerSink.ts`, …and 9 more under `./src/`.

### Environment variables

_2 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `COSMOSDB_CONNECTION_STRING`
- `MONGODB_CONNECTION_STRING`

---

_Auto-generated against commit `5cbcf613f047f08749d0451296eb1cdc610ae414` on `2026-07-17T18:24:18.404Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter telemetry docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

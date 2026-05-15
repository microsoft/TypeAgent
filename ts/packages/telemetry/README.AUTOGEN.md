<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=3c94d842df1fb2e958a0d4cbdaf3a7ec82b9a0933c80a35d13564b98fe7adfbe -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# telemetry — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `telemetry` package is a telemetry provider for the TypeAgent project. It facilitates logging and monitoring by providing various logger sinks that can be used to record events and metrics to different storage backends such as MongoDB and Azure Cosmos DB.

## What it does

The `telemetry` package offers several logger sinks that can be used to log events to different storage systems. The main capabilities include:

- `createMongoDBLoggerSink`: Logs events to a MongoDB collection.
- `createCosmosDBLoggerSink`: Logs events to an Azure Cosmos DB container.
- `createDatabaseLoggerSink`: Automatically selects between MongoDB and Cosmos DB based on environment variables.
- `createDebugLoggerSink`: Logs events to the console using the `debug` library.
- `createPromptLogger`: Specialized logger for logging LLM prompts.
- `createProfileLogger`: Logs profiling data for performance measurement.

These logger sinks can be combined using the `MultiSinkLogger` to log events to multiple destinations simultaneously.

## Setup

To use the `telemetry` package, you need to set up the following environment variables:

- `COSMOSDB_CONNECTION_STRING`: Connection string for Azure Cosmos DB.
- `MONGODB_CONNECTION_STRING`: Connection string for MongoDB.

These environment variables are required for the respective logger sinks to function correctly. For detailed setup instructions, see the hand-written README.

## Key Files
The `telemetry` package is structured into several key components:

- [indexNode.ts](./src/indexNode.ts): The main entry point that exports various logger sinks and utilities.
- [logger/cosmosDBLoggerSink.ts](./src/logger/cosmosDBLoggerSink.ts): Implements the `CosmosDBLoggerSink` for logging events to Azure Cosmos DB.
- [logger/databaseLoggerSink.ts](./src/logger/databaseLoggerSink.ts): Implements the `DatabaseLoggerSink` that selects between MongoDB and Cosmos DB based on environment variables.
- [logger/debugLoggerSink.ts](./src/logger/debugLoggerSink.ts): Implements the `DebugLoggerSink` for logging events to the console.
- [logger/logger.ts](./src/logger/logger.ts): Defines the core logging interfaces and classes such as `Logger`, `LoggerSink`, `ChildLogger`, and `MultiSinkLogger`.
- [logger/mongoLoggerSink.ts](./src/logger/mongoLoggerSink.ts): Implements the `MongoDBLoggerSink` for logging events to MongoDB.
- [logger/promptLogger.ts](./src/logger/promptLogger.ts): Implements the `PromptLogger` for logging LLM prompts.
- [profiler/profileLogger.ts](./src/profiler/profileLogger.ts): Implements the `ProfileLogger` for logging profiling data.

## How to extend

To extend the `telemetry` package, follow these steps:

1. **Add a new logger sink**:

   - Create a new file in the `logger` directory, e.g., `customLoggerSink.ts`.
   - Implement the `LoggerSink` interface in your new file.
   - Export your new logger sink from [indexNode.ts](./src/indexNode.ts).

2. **Modify existing logger sinks**:

   - Locate the relevant file in the `logger` directory.
   - Make your changes and ensure they conform to the `LoggerSink` interface.

3. **Testing**:
   - Add unit tests for your new or modified logger sink in the `tests` directory.
   - Run the tests using the project's test runner to ensure your changes work as expected.

By following these steps, you can extend the `telemetry` package to support additional logging backends or modify existing functionality to better suit your needs.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/indexNode.js](./dist/indexNode.js)

### Dependencies

Workspace: _None._

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

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T10:06:08.858Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter telemetry docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

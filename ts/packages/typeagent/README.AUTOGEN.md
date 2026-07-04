<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=836213ee01d600092065077416ef836f104d37f2e783c281ea88a0a14dbac854 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# typeagent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `typeagent` package is a sample library designed to support the development of agents and applications within the TypeAgent project. It provides a collection of utilities and components for common tasks such as asynchronous processing, vector and embedding operations, storage management, text processing, and collection utilities. While it is primarily intended for internal use within the TypeAgent ecosystem, it serves as a foundational library for many other packages and examples in the project.

## What it does

The `typeagent` package provides a variety of utilities and tools that are essential for building and running agents. Its key functionalities include:

- **Async Processing**: Utilities like `mapAsync` (in [arrayAsync.ts](./src/arrayAsync.ts)) and `callWithRetry` (in [async.ts](./src/async.ts)) enable efficient handling of concurrent and retryable asynchronous operations.
- **Vectors and Embeddings**: A suite of tools for working with vectors and embeddings, such as `vectorIndex` and `semanticMap`, located in the `vector` directory.
- **Storage Management**: Components for managing data storage, including `objectFolder`, `objectPage`, and `embeddingFS`, which are implemented in the `storage` directory.
- **Text Processing**: Functions for text-related tasks, such as `createTypeChat` (in [chat.ts](./src/chat.ts)) for chat interactions and `createTextClassifier` (in [textClassifier.ts](./src/classifier/textClassifier.ts)) for text classification.
- **Collections**: A variety of collection utilities, such as `binarySearch` and `isUndefinedOrEmpty`, provided in [lib/array.ts](./src/lib/array.ts).

These features are widely used across the TypeAgent project, making `typeagent` a critical dependency for other packages and examples.

## Setup

The `typeagent` package does not require any special setup beyond installing its dependencies. To get started, run the following command in the root of the TypeAgent monorepo:

```sh
pnpm install
```

For additional details, refer to the hand-written README.

## Key Files

The `typeagent` package is organized into several key files and directories, each serving a specific purpose:

- **[src/index.ts](./src/index.ts)**: The main entry point that re-exports the package's modules and components.
- **[src/arrayAsync.ts](./src/arrayAsync.ts)**: Contains utilities for asynchronous array processing, such as `mapAsync`, which supports concurrent operations.
- **[src/async.ts](./src/async.ts)**: Provides `callWithRetry`, a utility for retrying asynchronous operations with optional timeouts and error handling.
- **[src/chat.ts](./src/chat.ts)**: Implements `createTypeChat`, a function for managing chat interactions with context, history, and instructions.
- **[src/classifier/textClassifier.ts](./src/classifier/textClassifier.ts)**: Defines `createTextClassifier`, a utility for classifying text based on predefined schemas and classes.
- **[src/constraints.ts](./src/constraints.ts)**: Implements `createConstraintsValidator`, a utility for validating objects against custom constraints.
- **[src/dateTime.ts](./src/dateTime.ts)**: Provides functions for handling and formatting date and time values, such as `timestampString` and `parseTimestamped`.
- **[src/lib/array.ts](./src/lib/array.ts)**: Includes collection utilities like `binarySearch` and `isUndefinedOrEmpty` for array manipulation.
- **[src/vector/**](./src/vector/): A directory containing utilities for vector and embedding operations, such as `vectorIndex` and `semanticMap`.
- **[src/storage/**](./src/storage/): A directory with components for managing storage, including `objectFolder`, `objectPage`, and `embeddingFS`.

## How to extend

To extend the `typeagent` package, follow these steps:

1. **Identify the area to extend**: Determine which functionality you want to add or modify. For example, if you need to add a new text processing utility, start by examining [textProcessing.ts](./src/textProcessing.ts).

2. **Modify or add new files**: Implement your changes in the appropriate file or create a new file in the relevant directory. For instance, if you're adding a new vector operation, place it in the `vector` directory.

3. **Update exports**: Ensure that your new functionality is exported in [index.ts](./src/index.ts) so it can be accessed by other parts of the TypeAgent project.

4. **Write tests**: Create or update test files to cover your new functionality. Tests should be placed in the corresponding test files or in new test files if necessary.

5. **Run tests**: Use the following command to run the test suite and verify that your changes work as expected:

```sh
pnpm test
```

6. **Document your changes**: Update the hand-written README or other relevant documentation to describe your new functionality and how to use it.

By following these steps, you can contribute to the `typeagent` package and enhance its capabilities for the TypeAgent ecosystem.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/index.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/aiclient](../../packages/aiclient/README.md)
- [@typeagent/config](../../packages/config/README.md)

External: `async`, `cheerio`, `debug`, `typechat`, `typescript`

### Used by

- [agent-api](../../packages/api/README.md)
- [agent-dispatcher](../../packages/dispatcher/dispatcher/README.md)
- [agent-shell](../../packages/shell/README.md)
- [azure-ai-foundry](../../packages/azure-ai-foundry/README.md)
- [browser-typeagent](../../packages/agents/browser/README.md)
- [cache-rest-endpoint](../../examples/cacheRESTEndpoint/README.md)
- [chat-agent](../../packages/agents/chat/README.md)
- [chat-example](../../examples/chat/README.md)
- classify
- [code-processor](../../packages/codeProcessor/README.md)
- _…and 28 more workspace consumers._

### Files of interest

`./src/index.ts`, `./src/lib/index.ts`, `./src/arrayAsync.ts`, …and 32 more under `./src/`.

---

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-04T08:54:09.388Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter typeagent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

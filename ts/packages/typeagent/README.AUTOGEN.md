<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=836213ee01d600092065077416ef836f104d37f2e783c281ea88a0a14dbac854 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# typeagent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `typeagent` package is a sample library designed to support the development of agents and applications within the TypeAgent project. It provides a collection of utilities and components for tasks such as asynchronous processing, vector and embedding operations, storage management, text processing, and collection utilities. While it is primarily intended for internal use within the TypeAgent ecosystem, it serves as a foundational library for many other packages and examples in the project.

## What it does

The `typeagent` package offers a variety of utilities and components that are essential for building and running agents. These include:

- **Async Processing**: Functions like `mapAsync` (in [arrayAsync.ts](./src/arrayAsync.ts)) and `callWithRetry` (in [async.ts](./src/async.ts)) provide tools for concurrent and retryable asynchronous operations.
- **Vectors and Embeddings**: A suite of utilities for working with vectors and embeddings, such as `vectorIndex` and `semanticMap`, located in the `vector` directory.
- **Storage Management**: Tools for managing data storage, including `objectFolder`, `objectPage`, and `embeddingFS`, which are implemented in the `storage` directory.
- **Text Processing**: Functions for text-related tasks, such as `createTypeChat` (in [chat.ts](./src/chat.ts)) for chat interactions and `createTextClassifier` (in [textClassifier.ts](./src/classifier/textClassifier.ts)) for text classification.
- **Collections**: A variety of collection utilities, such as `binarySearch` and `isUndefinedOrEmpty`, provided in [lib/array.ts](./src/lib/array.ts).

These components are widely used across the TypeAgent project, making `typeagent` a critical dependency for other packages and examples.

## Setup

The `typeagent` package does not require any special setup beyond installing its dependencies. To get started, simply run:

```sh
pnpm install
```

For additional details, refer to the hand-written README.

## Key Files

The `typeagent` package is organized into several key files and directories, each serving a specific purpose:

- **[src/index.ts](./src/index.ts)**: The main entry point that exports the package's modules and components.
- **[src/arrayAsync.ts](./src/arrayAsync.ts)**: Contains utilities for asynchronous array processing, such as `mapAsync`.
- **[src/async.ts](./src/async.ts)**: Provides functions for retrying asynchronous operations, including `callWithRetry`.
- **[src/chat.ts](./src/chat.ts)**: Implements the `createTypeChat` function, which facilitates chat interactions with context and history.
- **[src/classifier/textClassifier.ts](./src/classifier/textClassifier.ts)**: Defines the `createTextClassifier` function for text classification tasks.
- **[src/constraints.ts](./src/constraints.ts)**: Contains the `createConstraintsValidator` function for validating constraints.
- **[src/dateTime.ts](./src/dateTime.ts)**: Provides utilities for handling and formatting date and time values.
- **[src/lib/array.ts](./src/lib/array.ts)**: Includes various array utilities, such as `binarySearch` and `isUndefinedOrEmpty`.

Additionally, the `vector` and `storage` directories contain specialized utilities for vector operations and storage management, respectively.

## How to extend

To extend the `typeagent` package, follow these steps:

1. **Identify the area to extend**: Determine which component or utility you need to modify or add to. For example, if you need to add a new text processing function, start with [textProcessing.ts](./src/textProcessing.ts).

2. **Create or modify files**: Add new functions or modify existing ones in the appropriate file. Follow the established patterns and coding conventions in the package.

3. **Update exports**: Ensure that your new functions or components are exported in [index.ts](./src/index.ts) so they can be accessed by other parts of the TypeAgent project.

4. **Write tests**: Create tests for your new functionality to ensure it works as expected. Add these tests to the corresponding test files or create new ones if necessary.

5. **Run tests**: Use the following command to execute the test suite and verify that your changes do not introduce any regressions:

```sh
pnpm test
```

6. **Document your changes**: Update the hand-written README or other relevant documentation to reflect your additions or modifications.

By following these steps, you can contribute to the `typeagent` package and enhance its functionality for the TypeAgent ecosystem.

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

_Auto-generated against commit `88f04471002e27f82ae1ddf73a7ae8acdfe09b5d` on `2026-07-03T09:02:51.801Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter typeagent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

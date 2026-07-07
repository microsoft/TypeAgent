<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=c97e0c3404b5430bcb9ddac5763968954fb7bd1703ecc9d277884773ecdb3167 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# typeagent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `typeagent` package is a sample library designed to support the development of example agents and applications within the TypeAgent project. It provides a collection of utilities and components for common tasks such as asynchronous processing, vector and embedding operations, storage management, text processing, and collection utilities. While not intended for standalone use, it serves as a foundational library for other packages and examples in the TypeAgent ecosystem.

## What it does

The `typeagent` package provides a wide range of utilities and components that are essential for building and running agents. These include:

- **Async Processing**: Functions like `mapAsync` in [arrayAsync.ts](./src/arrayAsync.ts) and `callWithRetry` in [async.ts](./src/async.ts) enable efficient handling of concurrent and retryable asynchronous operations.
- **Vectors and Embeddings**: Tools for managing vector operations and embeddings, such as `vectorIndex` and `semanticMap`, are located in the `vector` directory. These utilities are useful for tasks like similarity searches and semantic indexing.
- **Storage**: Components for managing data storage, including `objectFolder`, `objectPage`, and `embeddingFS`, are found in the `storage` directory. These utilities help manage structured data and embeddings in a file system-like manner.
- **Text Processing**: Utilities for text-related tasks, such as `createTypeChat` in [chat.ts](./src/chat.ts) for chat interactions and `createTextClassifier` in [textClassifier.ts](./src/classifier/textClassifier.ts) for text classification.
- **Collections**: A variety of collection utilities, such as `binarySearch` and `isUndefinedOrEmpty`, are provided in [lib/array.ts](./src/lib/array.ts). These utilities simplify operations on arrays and collections.

These features are widely used across the TypeAgent project, making `typeagent` a critical component for enabling the functionality of other agents and applications.

## Setup

The `typeagent` package does not require any special setup beyond installing its dependencies. To get started, navigate to the package directory and run:

```sh
pnpm install
```

For additional setup details, refer to the hand-written README.

## Key Files

The `typeagent` package is organized into several key files and directories, each serving a specific purpose:

- **[src/index.ts](./src/index.ts)**: The main entry point that re-exports modules and components from various parts of the library.
- **[src/arrayAsync.ts](./src/arrayAsync.ts)**: Contains utilities for asynchronous array processing, such as `mapAsync`, which supports concurrent operations.
- **[src/async.ts](./src/async.ts)**: Provides utilities for retrying asynchronous operations, including `callWithRetry`.
- **[src/chat.ts](./src/chat.ts)**: Implements the `createTypeChat` function, which facilitates chat interactions with context-aware capabilities.
- **[src/classifier/textClassifier.ts](./src/classifier/textClassifier.ts)**: Defines the `createTextClassifier` function for text classification tasks.
- **[src/constraints.ts](./src/constraints.ts)**: Implements the `createConstraintsValidator` function for validating constraints on objects.
- **[src/dateTime.ts](./src/dateTime.ts)**: Offers utilities for handling date and time operations, such as `stringifyTimestamped` and `timestampString`.
- **[src/lib/array.ts](./src/lib/array.ts)**: Includes collection utilities like `binarySearch` and `isUndefinedOrEmpty`.

Additionally, the `vector` and `storage` directories contain specialized utilities for vector operations and data storage, respectively:

- **Vector Utilities**: Files such as [vectorIndex.ts](./src/vector/vectorIndex.ts) and [semanticMap.ts](./src/vector/semanticMap.ts) provide tools for managing and querying vector data.
- **Storage Utilities**: Files like [objectFolder.ts](./src/storage/objectFolder.ts) and [embeddingFS.ts](./src/storage/embeddingFS.ts) handle structured data storage and retrieval.

## How to extend

To extend the `typeagent` package, follow these steps:

1. **Identify the area to extend**: Determine which component or utility you need to modify or add to. For example, if you need to add a new text processing utility, start with [textProcessing.ts](./src/textProcessing.ts).

2. **Create or modify files**: Add new functions or modify existing ones in the appropriate file. Ensure that your code adheres to the existing patterns and conventions.

3. **Export your additions**: Update [index.ts](./src/index.ts) to export your new functions or components, making them accessible to other parts of the TypeAgent project.

4. **Write tests**: Add tests for your new functionality to ensure it works as expected. Place your tests in the corresponding test files or create new ones if necessary.

5. **Run tests**: Execute the test suite to verify that your changes do not break existing functionality. Use the following command:

```sh
pnpm test
```

By following these steps, you can effectively extend the `typeagent` package and contribute to the TypeAgent project.

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

_Auto-generated against commit `366aaf867a7e8e5d130b6c87a365516bab725269` on `2026-07-07T09:05:05.703Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter typeagent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

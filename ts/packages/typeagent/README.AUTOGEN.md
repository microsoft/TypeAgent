<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=6b6edf651fc922c9b601eb3335628ad1c8f01ae5e2530fbcda62752e6971d4cd -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# typeagent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `typeagent` package is a sample library code used by and intended only for the example agents and apps in the TypeAgent project. It provides various utilities and components that facilitate async processing, vectors and embeddings, storage, text processing, and collections.

## What it does

The `typeagent` package offers a range of functionalities that are essential for building and running agents within the TypeAgent ecosystem. Key capabilities include:

- **Async Processing**: Functions like `mapAsync` in [arrayAsync.ts](./src/arrayAsync.ts) and `callWithRetry` in [async.ts](./src/async.ts) enable concurrent and retryable async operations.
- **Vectors and Embeddings**: Utilities for handling vector operations and embeddings, such as `vectorIndex` and `semanticMap`, found in the `vector` directory.
- **Storage**: Components for managing storage, including `objectFolder`, `objectPage`, and `embeddingFS`, located in the `storage` directory.
- **Text Processing**: Tools for processing text, including `textClassifier` in [textClassifier.ts](./src/classifier/textClassifier.ts) and `createTypeChat` in [chat.ts](./src/chat.ts).
- **Collections**: Various collection utilities provided in [lib/index.ts](./src/lib/index.ts).

These components are used by multiple packages and examples within the TypeAgent project, making `typeagent` a foundational library for the ecosystem.

## Setup

The `typeagent` package does not require any special setup beyond installing its dependencies. To get started, simply run:

```sh
pnpm install
```

For detailed setup instructions, see the hand-written README.

## Key Files

The `typeagent` package is organized into several key files and directories, each responsible for different aspects of the library:

- **[src/index.ts](./src/index.ts)**: The main entry point that exports various modules and components.
- **[src/arrayAsync.ts](./src/arrayAsync.ts)**: Contains functions for async array processing, such as `mapAsync`.
- **[src/async.ts](./src/async.ts)**: Provides utilities for retrying async operations with `callWithRetry`.
- **[src/chat.ts](./src/chat.ts)**: Implements the `createTypeChat` function for handling chat interactions.
- **[src/classifier/textClassifier.ts](./src/classifier/textClassifier.ts)**: Defines the `createTextClassifier` function for text classification.
- **[src/constraints.ts](./src/constraints.ts)**: Contains the `createConstraintsValidator` function for validating constraints.
- **[src/dateTime.ts](./src/dateTime.ts)**: Provides utilities for handling date and time operations.
- **[src/lib/array.ts](./src/lib/array.ts)**: Includes various array utilities, such as `binarySearch`.

## How to extend

To extend the `typeagent` package, follow these steps:

1. **Identify the area to extend**: Determine which component or utility you need to modify or add to. For example, if you need to add a new async processing function, start with [arrayAsync.ts](./src/arrayAsync.ts).

2. **Create or modify files**: Add new functions or modify existing ones in the appropriate file. Ensure that your code follows the existing patterns and conventions.

3. **Export your additions**: Make sure to export your new functions or components in [index.ts](./src/index.ts) so they are accessible to other parts of the TypeAgent project.

4. **Write tests**: Add tests for your new functionality to ensure it works as expected. Place your tests in the corresponding test files or create new ones if necessary.

5. **Run tests**: Execute the test suite to verify that your changes do not break existing functionality. Use the following command:

```sh
pnpm test
```

By following these steps, you can effectively extend the `typeagent` package and contribute to the TypeAgent project.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)

### Dependencies

Workspace:

- [aiclient](../../packages/aiclient/README.md)

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

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T10:06:08.874Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter typeagent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

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

The `typeagent` package provides a variety of utilities and components that are essential for building and running agents. Its key functionalities include:

- **Async Processing**: Utilities like `mapAsync` (in [arrayAsync.ts](./src/arrayAsync.ts)) and `callWithRetry` (in [async.ts](./src/async.ts)) enable efficient handling of concurrent and retryable asynchronous operations.
- **Vectors and Embeddings**: Tools for working with vector operations and embeddings, such as `vectorIndex` and `semanticMap`, are located in the `vector` directory.
- **Storage Management**: Components like `objectFolder`, `objectPage`, and `embeddingFS` (in the `storage` directory) provide mechanisms for managing data storage and retrieval.
- **Text Processing**: Functions for text classification and chat interactions, such as `createTextClassifier` (in [textClassifier.ts](./src/classifier/textClassifier.ts)) and `createTypeChat` (in [chat.ts](./src/chat.ts)), are included.
- **Collections**: A variety of collection utilities, such as `binarySearch` and `isUndefinedOrEmpty`, are available in [lib/array.ts](./src/lib/array.ts).

These features are widely used across the TypeAgent project, making `typeagent` a critical dependency for other packages and examples.

## Setup

The `typeagent` package does not require any special setup beyond installing its dependencies. To get started, simply run the following command in the package directory:

```sh
pnpm install
```

For additional details, refer to the hand-written README.

## Key Files

The `typeagent` package is organized into several key files and directories, each serving a specific purpose:

- **[src/index.ts](./src/index.ts)**: The main entry point that re-exports modules and components from various parts of the library.
- **[src/arrayAsync.ts](./src/arrayAsync.ts)**: Contains utilities for asynchronous array processing, such as `mapAsync`, which supports concurrent operations.
- **[src/async.ts](./src/async.ts)**: Provides utilities for retrying asynchronous operations, including the `callWithRetry` function.
- **[src/chat.ts](./src/chat.ts)**: Implements the `createTypeChat` function, which facilitates chat interactions with context-aware capabilities.
- **[src/classifier/textClassifier.ts](./src/classifier/textClassifier.ts)**: Defines the `createTextClassifier` function for text classification tasks.
- **[src/constraints.ts](./src/constraints.ts)**: Implements the `createConstraintsValidator` function for validating constraints on objects.
- **[src/dateTime.ts](./src/dateTime.ts)**: Offers utilities for handling date and time, such as `stringifyTimestamped` and `timestampString`.
- **[src/lib/array.ts](./src/lib/array.ts)**: Provides array utilities, including `binarySearch` and `isUndefinedOrEmpty`.

Additionally, the `vector` and `storage` directories contain specialized utilities for vector operations and storage management, respectively.

## How to extend

To contribute to or extend the `typeagent` package, follow these steps:

1. **Identify the area to extend**: Determine which functionality you want to add or modify. For example, if you need to enhance text processing, you might start with [textClassifier.ts](./src/classifier/textClassifier.ts) or [chat.ts](./src/chat.ts).

2. **Modify or add files**: Implement your changes in the appropriate file or create a new file in the relevant directory. Follow the existing code style and structure for consistency.

3. **Update exports**: Ensure that your new functions or components are exported in [index.ts](./src/index.ts) so they can be accessed by other parts of the project.

4. **Write tests**: Create or update test cases to validate your changes. Tests should be placed in the corresponding test files or in new test files if necessary.

5. **Run tests**: Use the following command to run the test suite and verify that your changes work as expected:

   ```sh
   pnpm test
   ```

6. **Document your changes**: Update the hand-written README or other relevant documentation to reflect your additions or modifications.

By following these steps, you can effectively contribute to the `typeagent` package and ensure that your changes integrate smoothly with the rest of the TypeAgent project.

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

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-05T09:01:32.154Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter typeagent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

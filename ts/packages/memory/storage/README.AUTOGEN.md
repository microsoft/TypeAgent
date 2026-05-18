<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=72569ed2b459407b12cc2e3effc17c007a5f07e77e40696f5d7e5d81f80675b0 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# memory-storage — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `memory-storage` package is a TypeScript library designed to provide memory storage and indexing capabilities. It serves as a backing store for the `KnowPro` system, utilizing SQLite and Azure Search for flexible and efficient data storage solutions. This package is actively developed and subject to frequent changes as the APIs evolve.

## What it does

The `memory-storage` package offers functionalities for storing and indexing data using SQLite and Azure Search. It supports various actions that enable interaction with the stored data, such as `createMessage`, `getMessage`, and `deleteMessage`. These actions facilitate operations like querying, updating, and deleting records. The package is used by other components in the system, including `conversation-memory`, `image-memory`, and `website-memory`.

## Setup

To set up the `memory-storage` package, you need to configure environment variables for Azure Search. Specifically, you need to set the `AZURE_SEARCH_ENDPOINT` environment variable. This can be done by obtaining the endpoint from your Azure Search service and setting it in your environment.

For detailed setup instructions, including how to obtain the necessary values, please refer to the hand-written README.

## Key Files

The `memory-storage` package is organized into several key components:

- **SQLite Integration**: Located in the [sqlite](./src/sqlite/index.ts) directory, this component handles storage operations using SQLite.
- **Azure Search Integration**: Found in the [azSearch](./src/azSearch/index.ts) directory, this component manages indexing and querying using Azure Search.
- **Common Utilities**: Shared functions and settings for Azure Search are defined in [azSearchCommon.ts](./src/azSearch/azSearchCommon.ts).
- **Query Compilation**: The logic for compiling search queries is implemented in [azQuery.ts](./src/azSearch/azQuery.ts).
- **Index Management**: Classes for managing Azure Search indexes are provided in [azSearchIndex.ts](./src/azSearch/azSearchIndex.ts) and [azSemanticRefIndex.ts](./src/azSearch/azSemanticRefIndex.ts).

### Key Files and Their Responsibilities

- **[index.ts](./src/index.ts)**: The main entry point that exports modules for SQLite and Azure Search.
- **[azSearchCommon.ts](./src/azSearch/azSearchCommon.ts)**: Contains common utilities and settings for Azure Search.
- **[azQuery.ts](./src/azSearch/azQuery.ts)**: Implements the logic for compiling search queries.
- **[azSearchIndex.ts](./src/azSearch/azSearchIndex.ts)**: Manages Azure Search indexes and handles search operations.
- **[azSemanticRefIndex.ts](./src/azSearch/azSemanticRefIndex.ts)**: Extends `AzSearchIndex` to handle semantic references.
- **[azTermsVectorIndex.ts](./src/azSearch/azTermsVectorIndex.ts)**: Implements vector-based search for terms.

## How to extend

To extend the `memory-storage` package, follow these steps:

1. **Identify the Component**: Determine whether you need to extend the SQLite or Azure Search functionality.
2. **Open the Relevant File**: For SQLite, start with [sqlite/index.ts](./src/sqlite/index.ts). For Azure Search, begin with [azSearch/index.ts](./src/azSearch/index.ts).
3. **Add Your Logic**: Implement your new functionality by following the existing patterns in the code. For example, if you are adding a new query type, you might extend [azQuery.ts](./src/azSearch/azQuery.ts).
4. **Test Your Changes**: Ensure your new functionality works correctly by writing tests. You can find existing tests in the `test` directory.

By following these steps, you can effectively extend the capabilities of the `memory-storage` package.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)

### Dependencies

Workspace:

- [aiclient](../../../packages/aiclient/README.md)
- [knowledge-processor](../../../packages/knowledgeProcessor/README.md)
- [knowpro](../../../packages/knowPro/README.md)
- [test-lib](../../../packages/testLib/README.md)
- [typeagent](../../../packages/typeagent/README.md)

External: `@azure/search-documents`, `better-sqlite3`, `debug`

### Used by

- [chat-example](../../../examples/chat/README.md)
- [conversation-memory](../../../packages/memory/conversation/README.md)
- [image-memory](../../../packages/memory/image/README.md)
- [website-memory](../../../packages/memory/website/README.md)

### Files of interest

`./src/azSearch/index.ts`, `./src/index.ts`, `./src/sqlite/index.ts`, …and 13 more under `./src/`.

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T09:44:30.178Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter memory-storage docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=cf52a8410f83d10ccd012df236b274d030ce69aa8b7ac6de7db4f1aff59a49fb -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# memory-storage — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `memory-storage` package is a TypeScript library that provides memory storage and indexing capabilities. It is designed as a backing store for the `KnowPro` system, leveraging SQLite and Azure Search to handle data storage and retrieval efficiently. This package is under active development and may undergo frequent changes as the APIs evolve.

## What it does

The `memory-storage` package enables the storage, indexing, and retrieval of data using two primary backends: SQLite and Azure Search. It supports a range of actions, such as `createMessage`, `getMessage`, and `deleteMessage`, which allow for creating, retrieving, and deleting records. These actions are foundational for managing data in systems like `conversation-memory`, `image-memory`, and `website-memory`, which depend on this package.

Key features include:

- **SQLite Integration**: Provides a lightweight, file-based database for local storage needs.
- **Azure Search Integration**: Offers advanced indexing and querying capabilities, including support for semantic and vector-based searches.
- **Query Compilation**: Converts high-level query structures into formats compatible with Azure Search, such as Lucene syntax.
- **Index Management**: Handles the creation, updating, and querying of indexes in Azure Search.

This package is used by other components in the system to manage and query structured data efficiently.

## Setup

To use the `memory-storage` package, you need to configure the following environment variable:

- `AZURE_SEARCH_ENDPOINT`: This should be set to the endpoint of your Azure Search service. You can obtain this value from the Azure portal when setting up your Azure Search resource.

For additional details on obtaining and configuring this value, refer to the hand-written README.

## Key Files

The `memory-storage` package is organized into several key modules, each responsible for specific functionality:

### SQLite Integration

- **[sqlite/index.ts](./src/sqlite/index.ts)**: Implements storage operations using SQLite. This module is ideal for local, lightweight storage needs.

### Azure Search Integration

- **[azSearch/index.ts](./src/azSearch/index.ts)**: The main entry point for Azure Search-related functionality. It re-exports modules for query compilation, index management, and vector-based search.
- **[azSearchCommon.ts](./src/azSearch/azSearchCommon.ts)**: Contains shared utilities and settings for Azure Search, such as environment variable handling and client creation.
- **[azQuery.ts](./src/azSearch/azQuery.ts)**: Implements query compilation logic, converting high-level query structures into Lucene or OData filter syntax.
- **[azSearchIndex.ts](./src/azSearch/azSearchIndex.ts)**: Provides classes for managing Azure Search indexes, including methods for ensuring index existence and retrieving search results.
- **[azSemanticRefIndex.ts](./src/azSearch/azSemanticRefIndex.ts)**: Extends `AzSearchIndex` to handle semantic references, enabling advanced search capabilities for knowledge documents.
- **[azTermsVectorIndex.ts](./src/azSearch/azTermsVectorIndex.ts)**: Implements vector-based search for terms, supporting operations like nearest-neighbor search.

### Utilities

- **[fileSystem.ts](./src/fileSystem.ts)**: Provides utility functions for file system operations, such as reading JSON files, ensuring directories exist, and managing file paths.

## How to extend

To extend the `memory-storage` package, follow these steps:

1. **Determine the Area of Extension**:

   - If you need to add or modify SQLite functionality, start with [sqlite/index.ts](./src/sqlite/index.ts).
   - For Azure Search-related extensions, focus on the files in the [azSearch](./src/azSearch/) directory.

2. **Follow Existing Patterns**:

   - For query-related changes, review and extend [azQuery.ts](./src/azSearch/azQuery.ts).
   - To add new index types or modify existing ones, consider extending [azSearchIndex.ts](./src/azSearch/azSearchIndex.ts) or [azSemanticRefIndex.ts](./src/azSearch/azSemanticRefIndex.ts).

3. **Implement Your Changes**:

   - Add your logic while adhering to the existing structure and conventions. For example, if you are introducing a new type of search, you might create a new class similar to `AzTermsVectorIndex`.

4. **Write Tests**:

   - Ensure your changes are well-tested. Add or update tests in the `test` directory to validate your implementation.

5. **Document Your Changes**:
   - Update relevant documentation or comments to reflect your additions or modifications.

By following these steps, you can effectively contribute to and extend the functionality of the `memory-storage` package.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/index.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/aiclient](../../../packages/aiclient/README.md)
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

_Auto-generated against commit `366aaf867a7e8e5d130b6c87a365516bab725269` on `2026-07-07T09:05:05.703Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter memory-storage docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

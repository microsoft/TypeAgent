<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=91455e54c95a6e51f1229e10526203c965fba0dffa4ecfcee80504dbd473d45a -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# knowpro — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `knowpro` package is a TypeScript library that implements a basic structured Retrieval-Augmented Generation (RAG) system. It is part of the TypeAgent monorepo and is actively developed to explore structured information extraction and various types of memory, such as conversation, document, and image memory.

## What it does

The `knowpro` package provides tools for working with structured RAG, focusing on extracting and utilizing structured information from conversations and other text-based sources. Its primary capabilities include:

- **Natural Language Querying**: Converts user requests into structured query expressions using large language models (LLMs). This includes handling natural language queries and translating them into precise search expressions.
- **Search and Retrieval**: Executes structured queries to retrieve relevant entities, topics, and actions from indexed data. It supports scope expressions (e.g., time ranges, topic descriptions) and tree-pattern expressions for fine-grained matching.
- **Answer Generation**: Generates natural language answers by combining query results with additional context, such as messages and entities, to create a comprehensive response.
- **Indexing and Data Management**: Manages structured and unstructured data in indexes, enabling efficient search and retrieval. These indexes can be updated incrementally or in the background.

The package integrates with other components in the TypeAgent ecosystem, such as the `conversation-memory` package, to support various memory types, including transcripts, documents, emails, and images. It is designed to work with LLMs, with primary testing conducted using GPT-4o.

## Setup

To use the `knowpro` package, follow these steps:

1. **Install Dependencies**: Ensure that all required dependencies are installed. The package depends on other internal libraries, such as `@typeagent/aiclient`, `knowledge-processor`, and `typeagent`, as well as external libraries like `async`, `debug`, `fast-levenshtein`, and `typechat`.

2. **Environment Configuration**: If the hand-written README or other documentation specifies environment variables or API keys, ensure they are correctly configured. For example, you may need to set up access to an LLM API like GPT-4o.

3. **Integration**: The package is designed to work with other components in the TypeAgent monorepo. Ensure that the relevant memory packages (e.g., `conversation-memory`) are properly configured if you plan to use them in conjunction with `knowpro`.

Refer to the hand-written README for any additional setup details or prerequisites.

## Key Files

The `knowpro` package is organized into several key files and modules, each responsible for specific functionality:

- **Schemas**:

  - [answerContextSchema.ts](./src/answerContextSchema.ts): Defines the structure of the context used for generating answers, including entities, topics, and messages.
  - [answerResponseSchema.ts](./src/answerResponseSchema.ts): Specifies the structure of the answer responses, including types like `NoAnswer` and `Answered`.

- **Search**:

  - [search.ts](./src/search.ts): Handles the conversion of natural language queries into structured query expressions and executes them.
  - [searchLang.ts](./src/searchLang.ts): Provides natural language processing capabilities for query generation.

- **Answer Generation**:

  - [answerGenerator.ts](./src/answerGenerator.ts): Implements the logic for generating answers based on query results and additional context.

- **Indexes**:

  - [conversationIndex.ts](./src/conversationIndex.ts): Manages the indexing of conversation data for efficient retrieval.
  - [secondaryIndexes.ts](./src/secondaryIndexes.ts): Handles secondary indexes for additional search capabilities, such as related terms and time ranges.

- **Utilities**:
  - [common.ts](./src/common.ts): Contains shared utility functions and types used across the package.
  - [collections.ts](./src/collections.ts): Provides internal data structures and methods for managing query results and matches.

## How to extend

To extend the functionality of the `knowpro` package, follow these steps:

1. **Understand the Existing Structure**:

   - Review the key files listed above to understand the current implementation.
   - Familiarize yourself with the base interfaces and types defined in [interfaces.ts](./src/interfaces.ts).

2. **Add or Modify Components**:

   - To enhance search capabilities, start with [search.ts](./src/search.ts) or [searchLang.ts](./src/searchLang.ts).
   - To introduce new types of structured data, update or create new schemas in files like [answerContextSchema.ts](./src/answerContextSchema.ts).
   - To improve answer generation, modify [answerGenerator.ts](./src/answerGenerator.ts) or related files.

3. **Extend Indexing**:

   - If you need to add new indexing capabilities, consider extending [secondaryIndexes.ts](./src/secondaryIndexes.ts) or [conversationIndex.ts](./src/conversationIndex.ts).

4. **Testing**:

   - Write tests to validate your changes. The `knowpro-test` package is available for testing the `knowpro` API and its memory implementations.

5. **Integration**:
   - Ensure that your changes integrate smoothly with other components in the TypeAgent monorepo, such as `conversation-memory` or `knowledge-processor`.

For practical examples and additional guidance, refer to the [KnowPro test app](../../examples/chat/README.md) and related documentation.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/index.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/aiclient](../../packages/aiclient/README.md)
- [knowledge-processor](../../packages/knowledgeProcessor/README.md)
- [test-lib](../../packages/testLib/README.md)
- [typeagent](../../packages/typeagent/README.md)

External: `async`, `debug`, `fast-levenshtein`, `typechat`

### Used by

- [agent-dispatcher](../../packages/dispatcher/dispatcher/README.md)
- [browser-typeagent](../../packages/agents/browser/README.md)
- [chat-example](../../examples/chat/README.md)
- [conversation-memory](../../packages/memory/conversation/README.md)
- [document-processor](../../examples/docuProc/README.md)
- [examples-lib](../../examples/examplesLib/README.md)
- [image-memory](../../packages/memory/image/README.md)
- [knowpro-test](../../packages/knowProTest/README.md)
- [memory-mcp](../../examples/mcpMemory/README.md)
- [memory-storage](../../packages/memory/storage/README.md)
- _…and 3 more workspace consumers._

### Files of interest

`./src/answerContextSchema.ts`, `./src/answerResponseSchema.ts`, `./src/dataFrame/index.ts`, …and 43 more under `./src/`.

---

_Auto-generated against commit `88f04471002e27f82ae1ddf73a7ae8acdfe09b5d` on `2026-07-03T09:02:51.801Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter knowpro docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

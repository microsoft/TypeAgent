<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=501e29f709902d55e8bb4121045dbf9657deab054c6c36d85208fa174ec0c4d8 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# knowpro — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `knowpro` package is a TypeScript library that implements a basic structured Retrieval-Augmented Generation (RAG) system. It is part of the TypeAgent monorepo and serves as an experimental foundation for exploring structured information extraction and various types of memory, such as conversation, document, and image memory. The package is actively developed and primarily tested with GPT-4o, with a focus on integrating structured data with natural language processing.

## What it does

The `knowpro` package provides tools for implementing Structured RAG, a method for extracting and utilizing structured information from unstructured data sources like conversations, emails, and documents. Its key capabilities include:

- **Natural Language Querying**: Converts user requests into structured query expressions. This includes handling both unstructured data (e.g., conversation text) and structured data (e.g., metadata or relational tables).
- **Search and Retrieval**: Executes query expressions to retrieve relevant entities, topics, and actions from indexed data. The search process uses:
  - **Scope Expressions**: Filters results based on criteria like time ranges, topics, or relationships.
  - **Tree-Pattern Expressions**: Matches specific structures in the data, such as hierarchical entities or relationships.
- **Answer Generation**: Combines query results with additional context to generate natural language answers using a language model.
- **Indexing and Updates**: Manages structured and unstructured data in indexes that support efficient retrieval and incremental updates.

The package integrates with other components in the TypeAgent ecosystem, such as the `conversation-memory` package, and supports various memory types, including transcripts, documents, emails, and images. It also leverages secondary indexes for efficient matching of tree expressions, related terms, and other search criteria.

## Setup

To use the `knowpro` package, follow these steps:

1. **Install Dependencies**:

   - Ensure all required dependencies are installed. The package relies on internal libraries like `@typeagent/aiclient`, `knowledge-processor`, and `typeagent`, as well as external libraries such as `async`, `debug`, `fast-levenshtein`, and `typechat`.

2. **Environment Configuration**:

   - If the hand-written README specifies any environment variables or API keys, configure them as instructed. For example, you may need to set up an API key for the LLM used in the package.

3. **Integration**:
   - The package is designed to work with other components in the TypeAgent monorepo. Ensure that the relevant dependencies and memory implementations are properly configured.

For additional setup details, refer to the hand-written README.

## Key Files

The `knowpro` package is organized into several key files and modules, each responsible for specific functionality:

- **Schemas**:

  - [answerContextSchema.ts](./src/answerContextSchema.ts): Defines the structure of the data used for answer generation, including entities, topics, and messages.
  - [answerResponseSchema.ts](./src/answerResponseSchema.ts): Specifies the structure of the answer responses, including the type of answer and its content.

- **Search**:

  - [search.ts](./src/search.ts): Handles the conversion of natural language queries into structured query expressions and executes them.
  - [searchLang.ts](./src/searchLang.ts): Provides support for natural language querying and query expression generation.

- **Answer Generation**:

  - [answerGenerator.ts](./src/answerGenerator.ts): Implements the logic for generating natural language answers based on query results and context.

- **Indexes**:

  - [conversationIndex.ts](./src/conversationIndex.ts): Manages the indexing of conversation data for efficient retrieval.
  - [secondaryIndexes.ts](./src/secondaryIndexes.ts): Handles secondary indexes for additional search capabilities, such as related terms and time ranges.

- **Utilities**:

  - [common.ts](./src/common.ts): Contains shared utility functions and types used across the package.
  - [collections.ts](./src/collections.ts): Provides internal data structures and methods for managing query results and matches.

- **Core Logic**:
  - [compileLib.ts](./src/compileLib.ts): Implements query operators and processing logic for the library.
  - [conversation.ts](./src/conversation.ts): Defines settings and utilities for managing conversation data.

## How to extend

To extend the `knowpro` package, follow these guidelines:

1. **Understand the Existing Structure**:

   - Review the key files and their responsibilities as outlined above.
   - Familiarize yourself with the base interfaces and types defined in [interfaces.ts](./src/interfaces.ts).

2. **Add or Modify Functionality**:

   - To enhance search capabilities, start with [search.ts](./src/search.ts) or [searchLang.ts](./src/searchLang.ts).
   - To introduce new types of structured data, update or create new schemas in files like [answerContextSchema.ts](./src/answerContextSchema.ts).
   - To improve answer generation, modify [answerGenerator.ts](./src/answerGenerator.ts) or related files.

3. **Extend Indexing**:

   - If you need to add new indexing capabilities, consider extending [secondaryIndexes.ts](./src/secondaryIndexes.ts) or [conversationIndex.ts](./src/conversationIndex.ts).

4. **Testing**:

   - Write tests to validate your changes. The `knowpro-test` package provides a framework for testing the `knowpro` API and its memory implementations.

5. **Documentation**:
   - Update the documentation to reflect your changes, including any new files or features.

For practical examples and additional guidance, refer to the [KnowPro test app](../../examples/chat/README.md) and related documentation in the TypeAgent monorepo.

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

_Auto-generated against commit `366aaf867a7e8e5d130b6c87a365516bab725269` on `2026-07-07T09:05:05.703Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter knowpro docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

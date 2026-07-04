<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=91455e54c95a6e51f1229e10526203c965fba0dffa4ecfcee80504dbd473d45a -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# knowpro — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `knowpro` package is a TypeScript library that implements a basic structured Retrieval-Augmented Generation (RAG) system. It is part of the TypeAgent monorepo and serves as an experimental foundation for exploring structured information extraction and retrieval from various types of data, such as conversations, documents, emails, and images. The library is actively developed and integrates with other TypeAgent components, particularly those related to memory and knowledge processing.

## What it does

The `knowpro` package provides tools and APIs to enable structured RAG workflows. Its primary capabilities include:

- **Natural Language Querying**: Converts user queries into structured query expressions using natural language processing and large language models (LLMs). This allows users to query unstructured and structured data using natural language.
- **Search and Retrieval**: Executes structured queries to retrieve relevant entities, topics, and actions from indexed data. The search process supports scope expressions (e.g., time ranges, topics) and tree-pattern expressions for precise matching.
- **Answer Generation**: Generates natural language answers by combining query results with relevant context, such as entities, topics, and messages.
- **Indexing**: Manages structured and unstructured data in indexes, enabling efficient search and retrieval. These indexes can be updated incrementally or in the background.

The package is designed to work with conversations and other forms of text, extracting structured information such as entities, topics, relationships, and metadata. This information is stored in indexes that support efficient querying and retrieval. The results of these queries can then be used to generate answers to user questions.

The `knowpro` package is primarily tested with GPT-4o, and its performance with other models may vary.

## Setup

To use the `knowpro` package, follow these steps:

1. **Install Dependencies**: Ensure that all required dependencies are installed. The package depends on other internal libraries in the TypeAgent monorepo, such as `@typeagent/aiclient`, `knowledge-processor`, and `typeagent`. External dependencies include `async`, `debug`, `fast-levenshtein`, and `typechat`.

2. **Environment Configuration**: If the hand-written README specifies any environment variables or API keys, configure them accordingly. For example, you may need to set up access to an LLM like GPT-4o.

3. **Integration**: The `knowpro` package is used by several other packages and examples in the monorepo, such as `agent-dispatcher`, `browser-typeagent`, and `knowpro-test`. Refer to their respective documentation for integration details.

For additional setup details, consult the hand-written README.

## Key Files

The `knowpro` package is organized into several key files, each responsible for specific functionality:

- **Schemas**:

  - [answerContextSchema.ts](./src/answerContextSchema.ts): Defines the structure of the context used for generating answers, including entities, topics, and messages.
  - [answerResponseSchema.ts](./src/answerResponseSchema.ts): Specifies the structure of the answer responses, including the type of answer and its content.

- **Search**:

  - [search.ts](./src/search.ts): Handles the conversion of user queries into structured query expressions and executes them.
  - [searchLang.ts](./src/searchLang.ts): Provides natural language processing capabilities for query generation.

- **Answer Generation**:

  - [answerGenerator.ts](./src/answerGenerator.ts): Implements the logic for generating natural language answers based on query results and context.

- **Indexes**:

  - [conversationIndex.ts](./src/conversationIndex.ts): Manages the primary index for storing and retrieving conversation data.
  - [secondaryIndexes.ts](./src/secondaryIndexes.ts): Handles secondary indexes for efficient query execution, such as tree-pattern and scope expressions.

- **Utilities**:

  - [common.ts](./src/common.ts): Contains shared utility functions and types used across the package.
  - [collections.ts](./src/collections.ts): Provides data structures and algorithms for managing query results and matches.

- **Core Logic**:
  - [compileLib.ts](./src/compileLib.ts): Implements query operators and processing logic for the library.
  - [conversation.ts](./src/conversation.ts): Defines settings and utilities for managing conversations and their associated data.

## How to extend

To extend the `knowpro` package, follow these guidelines:

1. **Understand the Architecture**:

   - Familiarize yourself with the key files and their responsibilities as outlined above.
   - Review the hand-written README and the [TypeAgent memory architecture](../../../docs/content/architecture/memory.md) document for a deeper understanding of Structured RAG and its implementation in `knowpro`.

2. **Identify the Extension Point**:

   - Determine the area you want to extend, such as adding new schemas, enhancing search capabilities, or improving answer generation.

3. **Modify or Add Files**:

   - For new schemas, start with [answerContextSchema.ts](./src/answerContextSchema.ts) or [answerResponseSchema.ts](./src/answerResponseSchema.ts).
   - To enhance search functionality, consider modifying [search.ts](./src/search.ts) or [searchLang.ts](./src/searchLang.ts).
   - To add new indexing capabilities, explore [secondaryIndexes.ts](./src/secondaryIndexes.ts).

4. **Update Interfaces**:

   - Ensure that any new functionality is reflected in the base interfaces and types defined in [interfaces.ts](./src/interfaces.ts).

5. **Test Your Changes**:

   - Use the `knowpro-test` package to validate your changes. This package provides a test suite for the `knowpro` API and its memory implementations.

6. **Follow Existing Patterns**:

   - Adhere to the coding patterns and conventions used in the existing codebase. For example, use the `TypeChatJsonTranslator` for JSON translation tasks and the `typechat` library for schema validation.

7. **Document Your Changes**:
   - Update the hand-written README or other relevant documentation to reflect your changes. Include examples and usage instructions where applicable.

By following these steps, you can effectively extend the `knowpro` package to meet your specific requirements. For further assistance, refer to the examples and related documentation in the TypeAgent monorepo.

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

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-04T08:54:09.388Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter knowpro docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=beaeb39359dc2abf3d8829b91bb46a5cd569c7c7be1ece4fa207158afe519d1c -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# knowpro — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `knowpro` package is a TypeScript library designed to implement a basic structured Retrieval-Augmented Generation (RAG) system. It is part of the TypeAgent monorepo and is actively developed to explore various types of memory and structured information extraction from conversations and other forms of text.

## What it does

The `knowpro` package provides functionalities for structured prompting and leveraging large language models (LLMs) to handle natural language queries and generate answers. It supports the following capabilities:

- **Natural language queries**: Translating user requests into structured query expressions.
- **Answer generation**: Using query results to generate natural language answers.
- **Search**: Converting user requests into query expressions and executing them to retrieve relevant entities, topics, and actions.
- **Indexing**: Storing and updating information in suitable indexes for efficient retrieval.

The package interacts with other parts of the system, such as the `conversation-memory` package for agent memory and various memory types including transcripts, documents, emails, and images.

## Setup

To set up the `knowpro` package, ensure you have the necessary dependencies installed. The package relies on several internal and external libraries, including `aiclient`, `knowledge-processor`, `typeagent`, and others.

For detailed setup instructions, including environment variables and API keys, refer to the hand-written README.

## Key Files

The `knowpro` package is organized into several key components:

- **Schemas**: Define the structure of the data used in the package, such as [answerContextSchema.ts](./src/answerContextSchema.ts) and [answerResponseSchema.ts](./src/answerResponseSchema.ts).
- **Search**: Handles the conversion of natural language queries into structured query expressions and executes them. Key files include [search.ts](./src/search.ts) and [searchLang.ts](./src/searchLang.ts).
- **Answer Generation**: Generates answers based on the results of executed queries. This is managed by [answerGenerator.ts](./src/answerGenerator.ts).
- **Indexes**: Store and manage the information extracted from conversations and other text sources. Relevant files include [conversationIndex.ts](./src/conversationIndex.ts) and [secondaryIndexes.ts](./src/secondaryIndexes.ts).
- **Common Utilities**: Provide shared functionality across the package, such as [common.ts](./src/common.ts).

## How to extend

To extend the `knowpro` package, follow these steps:

1. **Identify the component to extend**: Determine whether you need to add new schemas, enhance search capabilities, or improve answer generation.
2. **Modify or add files**: Based on the identified component, modify existing files or add new ones. For example, to add a new type of index, you might start with [secondaryIndexes.ts](./src/secondaryIndexes.ts).
3. **Update interfaces**: Ensure that any new functionality is reflected in the base interfaces and types defined in [interfaces.ts](./src/interfaces.ts).
4. **Test your changes**: Write tests to validate your changes. The `knowpro-test` package can be used to test the `knowpro` API and memory implementations.

For detailed examples and further guidance, refer to the [KnowPro test app](../../examples/chat/README.md) and other related documentation.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)

### Dependencies

Workspace:

- [aiclient](../../packages/aiclient/README.md)
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

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T10:06:08.874Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter knowpro docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

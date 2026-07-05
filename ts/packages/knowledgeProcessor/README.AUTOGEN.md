<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=abaf6b68ab6ba84d04893937cd2f0a42fb02a252c2fdb932732d67990d6a4162 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# knowledge-processor — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `knowledge-processor` package is a TypeScript library that explores early ideas in Structured Retrieval-Augmented Generation (RAG). It is primarily used by the TypeAgent Dispatcher to implement Agent Memory for the TypeAgent Shell. The package focuses on extracting, indexing, and utilizing knowledge from various sources such as conversations, documents, images, and transcripts.

This package is part of the TypeAgent ecosystem and serves as a foundational component for managing and processing knowledge in a structured and queryable format.

## What it does

The `knowledge-processor` package provides the following core functionalities:

- **Knowledge Extraction**: Extracts structured knowledge from diverse sources, including conversations, documents, images, and transcripts. This is achieved through actions like `extractKnowledge`.
- **Knowledge Indexing**: Organizes and stores extracted knowledge for efficient retrieval. This includes text indexing, key-value indexing, and temporal indexing.
- **Query Generation**: Translates natural language questions into structured queries to retrieve relevant knowledge. Actions like `searchKnowledge` facilitate this process.
- **Answer Generation**: Uses query results to generate natural language answers to user questions. This is handled by actions such as `generateAnswer`.
- **Conversation Management**: Manages conversation topics, tracks context, and generates responses. Actions like `createMessage` and `generateAnswer` are central to this functionality.

These capabilities make the package a critical tool for building systems that require advanced knowledge management and retrieval.

## Setup

To use the `knowledge-processor` package, ensure the following prerequisites are met:

1. **Install Dependencies**: The package depends on several workspace and external libraries, including:

   - Workspace dependencies: `@typeagent/aiclient`, `@typeagent/config`, `typeagent`, and `typechat-utils`.
   - External dependencies: `@azure-rest/maps-search`, `debug`, `exifreader`, `sharp`, and `typechat`.

   Use `pnpm install` to install the required dependencies.

2. **Environment Variables**: If the hand-written README specifies any environment variables or API keys, ensure they are set up correctly. Refer to the hand-written README for detailed instructions.

3. **External Services**: Some features, such as knowledge extraction from images or maps, may require API keys or access to external services like `@azure-rest/maps-search`. Follow the instructions in the hand-written README to configure these services.

## Key Files

The `knowledge-processor` package is organized into several modules, each responsible for specific aspects of knowledge processing. Below is an overview of the key files and their responsibilities:

### Conversation Management

- [conversationManager.ts](./src/conversation/conversationManager.ts): Implements the `ConversationManager`, which is used by the TypeAgent Dispatcher to manage conversations and agent memory.
- [conversation.ts](./src/conversation/conversation.ts): Handles core conversation-related logic, including topic management and message handling.
- [answerGenerator.ts](./src/conversation/answerGenerator.ts): Generates natural language answers based on query results and conversation context.

### Knowledge Extraction

- [knowledge.ts](./src/conversation/knowledge.ts): Contains logic for extracting and managing knowledge from various sources.
- [knowledgeSchema.ts](./src/conversation/knowledgeSchema.ts): Defines the schema for representing extracted knowledge.
- [knowledgeActions.ts](./src/conversation/knowledgeActions.ts): Implements actions related to knowledge extraction and processing.

### Indexing

- [textIndex.ts](./src/textIndex.ts): Manages text-based indexing for efficient retrieval.
- [keyValueIndex.ts](./src/keyValueIndex.ts): Handles key-value-based indexing.
- [temporal.ts](./src/temporal.ts): Provides temporal indexing capabilities for time-based data.

### Storage

- [storageProvider.ts](./src/storageProvider.ts): Defines storage solutions for managing indexed knowledge.
- [modelCache.ts](./src/modelCache.ts): Implements caching mechanisms for models and data.

### Schemas

- [aggregateTopicSchema.ts](./src/conversation/aggregateTopicSchema.ts): Defines schemas for aggregating and organizing conversation topics.
- [answerSchema.ts](./src/conversation/answerSchema.ts): Specifies the structure of answers, including relevance and explanation fields.
- [dateTimeSchema.ts](./src/conversation/dateTimeSchema.ts): Provides schemas for representing dates, times, and date-time ranges.

## How to extend

To extend the `knowledge-processor` package, follow these steps:

1. **Identify the area to extend**:

   - If you need to add new knowledge extraction capabilities, focus on the files in the `Knowledge Extraction` module.
   - For new indexing strategies, explore the `Indexing` module.
   - To enhance conversation management, work with files in the `Conversation Management` module.

2. **Start with the relevant file**:

   - For example, to add a new knowledge extraction method, begin with [knowledge.ts](./src/conversation/knowledge.ts).
   - If you are adding a new indexing method, consider starting with [textIndex.ts](./src/textIndex.ts) or [keyValueIndex.ts](./src/keyValueIndex.ts).

3. **Follow existing patterns**:

   - Review the existing codebase to understand the structure and conventions used.
   - Implement your new functionality in a way that aligns with the current design.

4. **Update schemas if needed**:

   - If your extension requires new data structures, update the relevant schema files, such as [knowledgeSchema.ts](./src/conversation/knowledgeSchema.ts) or [dateTimeSchema.ts](./src/conversation/dateTimeSchema.ts).

5. **Write tests**:

   - Add unit tests for your new functionality in the corresponding test files.
   - Ensure that your tests cover various scenarios and edge cases.

6. **Run tests**:
   - Use the existing test suite to verify that your changes work as expected and do not introduce regressions.

By following these guidelines, you can effectively contribute to the `knowledge-processor` package and expand its capabilities.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/index.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/aiclient](../../packages/aiclient/README.md)
- [@typeagent/config](../../packages/config/README.md)
- [typeagent](../../packages/typeagent/README.md)
- [typechat-utils](../../packages/utils/typechatUtils/README.md)

External: `@azure-rest/maps-search`, `debug`, `exifreader`, `sharp`, `typechat`

### Used by

- [agent-dispatcher](../../packages/dispatcher/dispatcher/README.md)
- [browser-typeagent](../../packages/agents/browser/README.md)
- [chat-agent](../../packages/agents/chat/README.md)
- [chat-example](../../examples/chat/README.md)
- [code-processor](../../packages/codeProcessor/README.md)
- [conversation-memory](../../packages/memory/conversation/README.md)
- [default-agent-provider](../../packages/defaultAgentProvider/README.md)
- [document-processor](../../examples/docuProc/README.md)
- [greeting-agent](../../packages/agents/greeting/README.md)
- [image-memory](../../packages/memory/image/README.md)
- _…and 9 more workspace consumers._

### Files of interest

`./src/conversation/aggregateTopicSchema.ts`, `./src/conversation/answerSchema.ts`, `./src/conversation/dateTimeSchema.ts`, …and 48 more under `./src/`.

---

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-05T09:01:32.154Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter knowledge-processor docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

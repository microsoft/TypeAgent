<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=abaf6b68ab6ba84d04893937cd2f0a42fb02a252c2fdb932732d67990d6a4162 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# knowledge-processor — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `knowledge-processor` package is a TypeScript library designed to explore early concepts in Structured Retrieval-Augmented Generation (RAG). It is primarily used by the TypeAgent Dispatcher to implement Agent Memory for the TypeAgent Shell. The package focuses on extracting, indexing, and utilizing knowledge from various sources such as conversations, documents, and images.

## What it does

The `knowledge-processor` package provides a set of tools and functionalities for working with knowledge extraction, indexing, and retrieval. Its primary capabilities include:

- **Knowledge Extraction**: Extracts structured knowledge from diverse sources, including conversations, transcripts, images, and documents. This is achieved through actions like `extractKnowledge`.
- **Knowledge Indexing**: Organizes and stores extracted knowledge and source text for efficient retrieval. This includes text indexing, key-value indexing, and temporal indexing.
- **Query Generation**: Translates natural language questions into structured queries to retrieve relevant knowledge. Actions like `searchKnowledge` facilitate this process.
- **Answer Generation**: Uses query results to generate natural language answers to user questions. This is supported by actions such as `generateAnswer`.
- **Conversation Management**: Manages conversation topics, tracks context, and generates responses. Actions like `createMessage` and `generateAnswer` are central to this functionality.

The package is designed to work in conjunction with other components of the TypeAgent ecosystem, such as the Dispatcher and Shell, to provide a cohesive solution for managing and utilizing knowledge.

## Setup

To use the `knowledge-processor` package, ensure the following prerequisites are met:

1. **Install Dependencies**: The package depends on several workspace and external libraries, including:

   - Workspace dependencies: `@typeagent/aiclient`, `@typeagent/config`, `typeagent`, and `typechat-utils`.
   - External dependencies: `@azure-rest/maps-search`, `debug`, `exifreader`, `sharp`, and `typechat`.

   Use `pnpm install` to install the required dependencies.

2. **Environment Variables**: If the package requires any specific environment variables or API keys, refer to the hand-written README for detailed instructions on how to configure them.

3. **External Services**: Some functionalities, such as knowledge extraction from images or external APIs, may require additional setup. For example, you may need API keys for services like `@azure-rest/maps-search`. Check the hand-written README for guidance on obtaining and configuring these keys.

## Key Files

The `knowledge-processor` package is organized into several modules, each responsible for specific aspects of knowledge processing. Below is an overview of the key files and their responsibilities:

### Conversation Management

- [conversationManager.ts](./src/conversation/conversationManager.ts): Implements the `ConversationManager`, which is used by the TypeAgent Dispatcher to manage conversations and their associated knowledge.
- [conversation.ts](./src/conversation/conversation.ts): Provides core functionality for managing conversations, including topic tracking and message handling.
- [answerGenerator.ts](./src/conversation/answerGenerator.ts): Handles the generation of natural language answers based on retrieved knowledge and context.

### Knowledge Extraction

- [knowledge.ts](./src/conversation/knowledge.ts): Contains logic for extracting knowledge from various sources and managing extracted knowledge.
- [knowledgeSchema.ts](./src/conversation/knowledgeSchema.ts): Defines the schema for representing extracted knowledge.
- [knowledgeActions.ts](./src/conversation/knowledgeActions.ts): Implements actions related to knowledge extraction and processing.

### Indexing and Storage

- [textIndex.ts](./src/textIndex.ts): Manages the indexing of text-based knowledge for efficient retrieval.
- [keyValueIndex.ts](./src/keyValueIndex.ts): Handles key-value indexing for structured data.
- [temporal.ts](./src/temporal.ts): Provides functionality for temporal indexing and querying.
- [storageProvider.ts](./src/storageProvider.ts): Defines storage solutions for managing indexed knowledge.
- [modelCache.ts](./src/modelCache.ts): Implements caching mechanisms for models used in knowledge processing.

### Schemas and Utilities

- [aggregateTopicSchema.ts](./src/conversation/aggregateTopicSchema.ts): Defines schemas for aggregating and organizing conversation topics.
- [answerSchema.ts](./src/conversation/answerSchema.ts): Specifies the structure of answers generated by the system.
- [dateTimeSchema.ts](./src/conversation/dateTimeSchema.ts): Provides schemas for representing date and time information.
- [answerContext.ts](./src/conversation/answerContext.ts): Manages the context for generating answers, including entities, topics, and actions.

## How to extend

To extend the `knowledge-processor` package, follow these steps:

1. **Identify the Area to Extend**:

   - Determine whether your changes pertain to conversation management, knowledge extraction, indexing, or storage.

2. **Locate the Relevant Files**:

   - For conversation-related changes, start with [conversationManager.ts](./src/conversation/conversationManager.ts) or [conversation.ts](./src/conversation/conversation.ts).
   - For knowledge extraction, review [knowledge.ts](./src/conversation/knowledge.ts) and [knowledgeActions.ts](./src/conversation/knowledgeActions.ts).
   - For indexing, explore [textIndex.ts](./src/textIndex.ts) or [keyValueIndex.ts](./src/keyValueIndex.ts).
   - For storage, check [storageProvider.ts](./src/storageProvider.ts).

3. **Follow Existing Patterns**:

   - Study the existing code to understand the structure and conventions used. Implement your changes in a consistent manner.

4. **Update or Add Tests**:

   - Write unit tests for your new functionality. Place these tests in the appropriate test files within the `__tests__` directory.

5. **Run Tests**:

   - Execute the test suite to ensure your changes work as intended and do not introduce regressions.

6. **Document Your Changes**:
   - Update the documentation to reflect your changes, including any new actions, schemas, or files.

By adhering to these guidelines, you can effectively contribute to and extend the `knowledge-processor` package.

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

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-06T09:20:03.630Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter knowledge-processor docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

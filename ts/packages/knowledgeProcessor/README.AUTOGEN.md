<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=abaf6b68ab6ba84d04893937cd2f0a42fb02a252c2fdb932732d67990d6a4162 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# knowledge-processor — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `knowledge-processor` package is a TypeScript library that explores early concepts in Structured Retrieval-Augmented Generation (RAG). It is primarily used by the TypeAgent Dispatcher to implement Agent Memory for the TypeAgent Shell. The package focuses on extracting, indexing, and utilizing knowledge from various sources such as conversations, transcripts, images, and documents.

This package is part of the TypeAgent monorepo and is considered sample code for experimenting with foundational ideas in knowledge processing. For the latest developments in Structured RAG, refer to the `knowPro` package.

## What it does

The `knowledge-processor` package provides a set of tools and actions to work with knowledge extraction, indexing, and retrieval. Its main capabilities include:

- **Knowledge Extraction**: Extracts structured knowledge from diverse sources, including conversations, documents, images, and transcripts. This is achieved through actions like `extractKnowledge`.
- **Knowledge Indexing**: Organizes and stores extracted knowledge for efficient retrieval. This includes text indexing, key-value indexing, and temporal indexing.
- **Query Generation**: Translates natural language questions into structured queries to retrieve relevant knowledge. Actions like `searchKnowledge` facilitate this process.
- **Answer Generation**: Uses retrieved knowledge to generate natural language answers to user queries. Actions such as `generateAnswer` are central to this functionality.
- **Conversation Management**: Manages conversation topics, tracks context, and generates responses. Actions like `createMessage` and `aggregateTopics` are part of this functionality.

These features make the package a critical component for enabling intelligent, context-aware interactions in the TypeAgent ecosystem.

## Setup

To use the `knowledge-processor` package, ensure the following prerequisites are met:

1. **Install Dependencies**: The package depends on several workspace and external libraries, including:

   - Workspace dependencies: `@typeagent/aiclient`, `@typeagent/config`, `typeagent`, and `typechat-utils`.
   - External dependencies: `@azure-rest/maps-search`, `debug`, `exifreader`, `sharp`, and `typechat`.

   Use `pnpm install` to install all required dependencies.

2. **Environment Variables**: If the package requires any specific environment variables or API keys, refer to the hand-written README for detailed instructions on how to configure them.

3. **External Services**: Some features, such as knowledge extraction from images or external APIs, may require additional setup (e.g., API keys for `@azure-rest/maps-search`). Check the hand-written README for guidance on obtaining and configuring these keys.

## Key Files

The `knowledge-processor` package is organized into several key modules, each responsible for a specific aspect of knowledge processing:

### Conversation Management

- [conversationManager.ts](./src/conversation/conversationManager.ts): Implements the `ConversationManager`, which is used by the TypeAgent Dispatcher to manage conversation topics and integrate with Agent Memory.
- [conversation.ts](./src/conversation/conversation.ts): Contains core logic for handling conversations, including topic management and knowledge extraction.
- [answerGenerator.ts](./src/conversation/answerGenerator.ts): Generates natural language answers based on retrieved knowledge and conversation context.

### Knowledge Extraction

- [knowledge.ts](./src/conversation/knowledge.ts): Core logic for extracting knowledge from various sources.
- [knowledgeSchema.ts](./src/conversation/knowledgeSchema.ts): Defines the schema for representing extracted knowledge.
- [knowledgeActions.ts](./src/conversation/knowledgeActions.ts): Implements actions related to knowledge extraction and processing.

### Indexing

- [textIndex.ts](./src/textIndex.ts): Handles text-based indexing for efficient knowledge retrieval.
- [keyValueIndex.ts](./src/keyValueIndex.ts): Manages key-value indexing for structured data.
- [temporal.ts](./src/temporal.ts): Provides functionality for temporal indexing and querying.

### Storage

- [storageProvider.ts](./src/storageProvider.ts): Defines storage interfaces and implementations for persisting indexed knowledge.
- [modelCache.ts](./src/modelCache.ts): Implements caching mechanisms for models and data.

### Schemas

- [aggregateTopicSchema.ts](./src/conversation/aggregateTopicSchema.ts): Defines schemas for aggregating and organizing conversation topics.
- [answerSchema.ts](./src/conversation/answerSchema.ts): Specifies the structure of generated answers, including relevance and content.
- [dateTimeSchema.ts](./src/conversation/dateTimeSchema.ts): Provides schemas for handling date and time information.

## How to extend

To extend the `knowledge-processor` package, follow these steps:

1. **Understand the Existing Structure**: Familiarize yourself with the key files and their responsibilities. For example, if you want to add a new knowledge extraction feature, start by reviewing [knowledge.ts](./src/conversation/knowledge.ts) and [knowledgeActions.ts](./src/conversation/knowledgeActions.ts).

2. **Add New Functionality**:

   - For new actions, define the action schema in the appropriate schema file (e.g., [knowledgeSchema.ts](./src/conversation/knowledgeSchema.ts)).
   - Implement the action logic in the corresponding module. For example, if it's a knowledge-related action, add it to [knowledgeActions.ts](./src/conversation/knowledgeActions.ts).

3. **Follow Existing Patterns**: Review similar implementations in the package to ensure consistency in coding style and structure.

4. **Update Tests**: Add unit tests for your new functionality. Place these tests in the appropriate test files or create new ones if necessary.

5. **Run Tests**: Execute the test suite to ensure your changes work as intended and do not introduce regressions.

6. **Document Changes**: Update the hand-written README or other documentation to reflect your changes, if applicable.

By following these steps, you can effectively contribute to and extend the `knowledge-processor` package.

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

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-04T08:54:09.388Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter knowledge-processor docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

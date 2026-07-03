<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=abaf6b68ab6ba84d04893937cd2f0a42fb02a252c2fdb932732d67990d6a4162 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# knowledge-processor — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `knowledge-processor` package is a TypeScript library designed to explore early concepts in Structured Retrieval-Augmented Generation (RAG). It is primarily used by the TypeAgent Dispatcher to implement Agent Memory for the TypeAgent Shell. The package focuses on extracting, indexing, and utilizing knowledge from various sources such as conversations, documents, images, and transcripts. It also supports generating structured queries and natural language answers based on retrieved knowledge.

This package is considered sample code and represents an experimental approach to Structured RAG. For the latest developments in this area, refer to the `knowPro` package.

## What it does

The `knowledge-processor` package provides a set of tools and actions to facilitate the following:

- **Knowledge Extraction**: Extracts structured knowledge from diverse sources, including conversations, documents, images, and transcripts. This is achieved through actions like `extractKnowledge`.
- **Knowledge Indexing**: Organizes and stores extracted knowledge for efficient retrieval. This includes text indexing, key-value indexing, and temporal indexing.
- **Query Generation**: Translates natural language questions into structured queries to retrieve relevant knowledge. Actions like `searchKnowledge` are used for this purpose.
- **Answer Generation**: Produces natural language answers based on the results of queries. Actions such as `generateAnswer` and `createMessage` are central to this functionality.

The package is tightly integrated with other components in the TypeAgent ecosystem, such as the `@typeagent/aiclient` for AI model interactions and `typechat-utils` for handling structured data.

## Setup

To use the `knowledge-processor` package, ensure the following prerequisites are met:

1. **Install Dependencies**: The package depends on several internal and external libraries. Use `pnpm install` to install all required dependencies.
2. **Environment Variables**: If any environment variables or API keys are required, refer to the hand-written README for detailed instructions on how to configure them.
3. **External Libraries**: The package relies on external libraries such as `@azure-rest/maps-search`, `debug`, `exifreader`, `sharp`, and `typechat`. Ensure these are correctly installed and configured.

## Key Files

The `knowledge-processor` package is organized into several key modules, each responsible for a specific aspect of knowledge processing:

### Conversation Management

- **[conversationManager.ts](./src/conversation/conversationManager.ts)**: Central to managing conversations and integrating various components like knowledge extraction and indexing.
- **[conversation.ts](./src/conversation/conversation.ts)**: Handles the core logic for managing conversation topics and messages.
- **[answerGenerator.ts](./src/conversation/answerGenerator.ts)**: Responsible for generating natural language answers from query results.
- **[answerContext.ts](./src/conversation/answerContext.ts)**: Defines the structure and handling of context used in answer generation.

### Knowledge Extraction

- **[knowledge.ts](./src/conversation/knowledge.ts)**: Implements methods for extracting and managing knowledge from various sources.
- **[knowledgeSchema.ts](./src/conversation/knowledgeSchema.ts)**: Defines the schema for representing extracted knowledge.
- **[knowledgeActions.ts](./src/conversation/knowledgeActions.ts)**: Contains actions related to knowledge extraction and processing.

### Indexing

- **[textIndex.ts](./src/textIndex.ts)**: Manages text-based indexing for efficient retrieval.
- **[keyValueIndex.ts](./src/keyValueIndex.ts)**: Implements key-value-based indexing mechanisms.
- **[temporal.ts](./src/temporal.ts)**: Handles temporal indexing and operations on time-based data.

### Storage

- **[storageProvider.ts](./src/storageProvider.ts)**: Provides storage solutions for indexed knowledge.
- **[modelCache.ts](./src/modelCache.ts)**: Implements caching mechanisms for AI models and other data.

### Schemas

- **[aggregateTopicSchema.ts](./src/conversation/aggregateTopicSchema.ts)**: Defines schemas for managing and aggregating conversation topics.
- **[answerSchema.ts](./src/conversation/answerSchema.ts)**: Specifies the structure of answers, including their relevance and content.
- **[dateTimeSchema.ts](./src/conversation/dateTimeSchema.ts)**: Provides schemas for handling date and time data.

## How to extend

To extend the `knowledge-processor` package, follow these steps:

1. **Understand the Existing Structure**: Familiarize yourself with the key files and their responsibilities. For example, if you want to add a new feature for knowledge extraction, start by reviewing [knowledge.ts](./src/conversation/knowledge.ts) and [knowledgeActions.ts](./src/conversation/knowledgeActions.ts).

2. **Add New Functionality**:

   - For new actions, define the action schema in the appropriate file (e.g., [knowledgeSchema.ts](./src/conversation/knowledgeSchema.ts)).
   - Implement the action logic in the corresponding handler file (e.g., [knowledgeActions.ts](./src/conversation/knowledgeActions.ts)).

3. **Update Indexing or Storage**:

   - If your extension involves new indexing or storage requirements, consider extending the relevant files like [textIndex.ts](./src/textIndex.ts) or [storageProvider.ts](./src/storageProvider.ts).

4. **Test Your Changes**:

   - Add unit tests to validate your new functionality. Place these tests in the appropriate test files.
   - Run the test suite to ensure your changes do not introduce regressions.

5. **Document Your Changes**:
   - Update the hand-written README or other relevant documentation to describe your new functionality and how to use it.

By following these guidelines, you can effectively contribute to the `knowledge-processor` package and enhance its capabilities.

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

_Auto-generated against commit `88f04471002e27f82ae1ddf73a7ae8acdfe09b5d` on `2026-07-03T09:02:51.801Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter knowledge-processor docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

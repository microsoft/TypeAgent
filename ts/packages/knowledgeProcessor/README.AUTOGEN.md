<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=bc49f5ae1274985493d3ae94bd9e9a342cf931de7089330de29c206f80001f3e -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# knowledge-processor â€” AI-generated documentation

> ðŸ¤– **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h â€” see the staleness footer at the end of this file.

## Overview

The `knowledge-processor` package is a TypeScript library designed to explore early ideas in Structured Retrieval-Augmented Generation (RAG). It is primarily used by the TypeAgent Dispatcher to implement Agent Memory for the TypeAgent Shell. The package focuses on extracting knowledge from various sources, indexing it for retrieval, generating queries, and producing answers based on the retrieved knowledge.

## What it does

The `knowledge-processor` package provides functionalities to:

- **Extract knowledge**: from conversations, transcripts, images, and documents.
- **Index knowledge**: store and index the extracted knowledge and source text for efficient retrieval.
- **Generate queries**: translate natural language questions into structured queries to retrieve relevant knowledge.
- **Generate answers**: use the results of queries to generate natural language answers.

The package includes several actions related to conversation management, knowledge extraction, and query processing. Key actions include `createMessage`, `extractKnowledge`, `generateAnswer`, and `searchKnowledge`.

## Setup

To set up the `knowledge-processor` package, ensure you have the necessary dependencies installed. The package relies on several external libraries such as `@azure-rest/maps-search`, `debug`, `exifreader`, `sharp`, and `typechat`. Additionally, it depends on other workspace packages like `aiclient`, `typeagent`, and `typechat-utils`.

For detailed setup instructions, including environment variables and API keys, refer to the hand-written README.

## Key Files
The `knowledge-processor` package is organized into several modules, each responsible for different aspects of knowledge processing:

- **Conversation**: Handles conversation-related functionalities, including managing conversation topics, extracting knowledge from conversations, and generating answers. Key files include [conversationManager.ts](./src/conversation/conversationManager.ts), [conversation.ts](./src/conversation/conversation.ts), and [answerGenerator.ts](./src/conversation/answerGenerator.ts).
- **Knowledge Extraction**: Focuses on extracting knowledge from various sources. This includes schemas for knowledge representation and actions for knowledge extraction. Key files include [knowledgeSchema.ts](./src/conversation/knowledgeSchema.ts), [knowledgeActions.ts](./src/conversation/knowledgeActions.ts), and [knowledge.ts](./src/conversation/knowledge.ts).
- **Indexing**: Manages the indexing of extracted knowledge for efficient retrieval. This includes text indexing, key-value indexing, and temporal indexing. Key files include [textIndex.ts](./src/textIndex.ts), [keyValueIndex.ts](./src/keyValueIndex.ts), and [temporal.ts](./src/temporal.ts).
- **Storage**: Provides storage solutions for the indexed knowledge. Key files include [storageProvider.ts](./src/storageProvider.ts) and [modelCache.ts](./src/modelCache.ts).

## How to extend

To extend the `knowledge-processor` package, follow these steps:

1. **Identify the module to extend**: Determine whether you need to add functionalities related to conversation management, knowledge extraction, indexing, or storage.
2. **Open the relevant file**: Start by opening the file that corresponds to the module you want to extend. For example, if you want to add a new knowledge extraction method, open [knowledge.ts](./src/conversation/knowledge.ts).
3. **Follow existing patterns**: Review the existing code to understand the patterns and structures used. Implement your new functionality following these patterns.
4. **Add tests**: Ensure your new functionality is well-tested. Add unit tests in the corresponding test files to validate your changes.
5. **Run tests**: Execute the tests to verify that your changes work as expected and do not break existing functionalities.

By following these steps, you can effectively extend the `knowledge-processor` package to meet your specific requirements.

## Reference

> âš™ï¸ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default â†’ [./dist/index.js](./dist/index.js)

### Dependencies

Workspace:

- [aiclient](../../packages/aiclient/README.md)
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
- _â€¦and 9 more workspace consumers._

### Files of interest

`./src/conversation/aggregateTopicSchema.ts`, `./src/conversation/answerSchema.ts`, `./src/conversation/dateTimeSchema.ts`, â€¦and 48 more under `./src/`.

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T10:06:08.874Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter knowledge-processor docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

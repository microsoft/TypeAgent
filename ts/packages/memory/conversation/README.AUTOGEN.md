<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=4576a4a502ef7c57e4a32eb913c077d63ef62aa2d74a0ce91f6f748cfe0c1a26 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# conversation-memory — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `conversation-memory` package is a TypeScript library designed to implement various types of conversational memory using Structured Retrieval-Augmented Generation (RAG). It leverages the `KnowPro` package to index and search through sequences of timestamped messages, documents, emails, and other forms of conversational data.

## What it does

The `conversation-memory` package provides functionality to manage and query different types of conversational memories, including:

- **Conversation Memory**: Interactive chats, agent interaction history, and invocation/response memory.
- **Document Memory**: Transcripts of meetings, videos, chats, markdown, and HTML documents.
- **Email Memory**: Collections of email messages.
- **Podcast Memory**: Transcripts of podcasts.

These memories are indexed incrementally, allowing new messages, emails, transcript chunks, or document parts to be added and indexed as they come in. The package extracts salient knowledge such as entities, actions, and topics from new messages, enabling precise search and retrieval with low latency. Users can query these memories using natural language or structured search expressions, and the package can generate answers, summaries, and analyses based on the indexed data.

## Setup

To set up the `conversation-memory` package, follow these steps:

1. Install the necessary dependencies using `pnpm install`.
2. Set up environment variables as required by the `KnowPro` and `memory-storage` packages.
3. Ensure you have access to external services like OpenAI for embedding models.

For detailed setup instructions, see the hand-written README.

## Key Files

The `conversation-memory` package is organized into several key files and modules:

- **[index.ts](./src/index.ts)**: Exports the main functionalities of the package, including podcast, memory, conversation memory, email memory, and document memory modules.
- **[conversationMemory.ts](./src/conversationMemory.ts)**: Implements the `ConversationMemory` class, handling interactive chats and agent interaction history.
- **[docMemory.ts](./src/docMemory.ts)**: Implements the `DocMemory` class, managing collections of document parts.
- **[emailMemory.ts](./src/emailMemory.ts)**: Implements the `EmailMemory` class, managing collections of email messages.
- **[podcast.ts](./src/podcast.ts)**: Implements the `PodcastMemory` class, handling podcast transcripts.
- **[common.ts](./src/common.ts)**: Contains common utility functions used across different memory types.
- **[docImport.ts](./src/docImport.ts)**: Handles the import of text documents into `DocMemory`.
- **[emailImport.ts](./src/emailImport.ts)**: Handles the import of email messages into `EmailMemory`.

## How to extend

To extend the `conversation-memory` package, follow these steps:

1. **Identify the memory type** you want to extend (e.g., conversation, document, email, podcast).
2. **Open the corresponding file** (e.g., [conversationMemory.ts](./src/conversationMemory.ts), [docMemory.ts](./src/docMemory.ts), [emailMemory.ts](./src/emailMemory.ts), [podcast.ts](./src/podcast.ts)).
3. **Add new functionalities** or modify existing ones. Ensure that new messages or data types are properly indexed and searchable.
4. **Update the schema** if necessary, such as modifying [docSearchQuerySchema.ts](./src/docSearchQuerySchema.ts) for document-related queries.
5. **Write tests** to validate your changes. Use the `test-lib` package for testing utilities.

For example, to add a new type of conversational memory, you might start by creating a new class similar to `ConversationMemory` and implement methods for adding messages, indexing, and querying. Ensure that the new class integrates with the existing indexing and search mechanisms provided by `KnowPro`.

By following these steps, you can extend the `conversation-memory` package to support additional types of conversational data or enhance its existing capabilities.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)

### Dependencies

Workspace:

- [@typeagent/aiclient](../../../packages/aiclient/README.md)
- [knowledge-processor](../../../packages/knowledgeProcessor/README.md)
- [knowpro](../../../packages/knowPro/README.md)
- [memory-storage](../../../packages/memory/storage/README.md)
- [test-lib](../../../packages/testLib/README.md)
- [textpro](../../../packages/textPro/README.md)
- [typeagent](../../../packages/typeagent/README.md)

External: `async`, `debug`, `mailparser`, `typechat`, `webvtt-parser`

### Used by

- [agent-dispatcher](../../../packages/dispatcher/dispatcher/README.md)
- [browser-typeagent](../../../packages/agents/browser/README.md)
- [chat-example](../../../examples/chat/README.md)
- [document-processor](../../../examples/docuProc/README.md)
- [knowpro-test](../../../packages/knowProTest/README.md)
- [memory-mcp](../../../examples/mcpMemory/README.md)
- [telemetry-query-example](../../../examples/commandHistogram/README.md)
- [website-memory](../../../packages/memory/website/README.md)

### Files of interest

`./src/docSearchQuerySchema.ts`, `./src/index.ts`, `./src/common.ts`, …and 17 more under `./src/`.

---

_Auto-generated against commit `127a36a95a15e918be533d6eaaf08adebe9070d9` on `2026-06-26T03:01:52.873Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter conversation-memory docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=9c1e7a44ce8d89425ade9b78afc17b884f75ebd30aa10810b7aeb7967663a233 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# conversation-memory — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `conversation-memory` package is a TypeScript library that implements various types of conversational memory using Structured Retrieval-Augmented Generation (RAG). It leverages the `KnowPro` package for indexing and searching through structured data, enabling efficient storage, retrieval, and analysis of conversational and document-based information.

This package is designed to handle a wide range of conversational data, including chat messages, emails, transcripts, and documents. It supports incremental updates, natural language queries, and the generation of human-readable answers based on indexed knowledge.

## What it does

The `conversation-memory` package provides tools to manage and query different types of conversational memories. These include:

- **Conversation Memory**: Tracks interactive chats, agent interaction history, and invocation/response memory. New messages can be added and indexed incrementally, with extracted knowledge such as entities, actions, and topics enabling precise search and retrieval.
- **Document Memory**: Manages collections of document parts, such as meeting transcripts, video transcripts, markdown files, and HTML documents. Documents can be imported, indexed, and queried for summaries, lists, or specific information.
- **Email Memory**: Handles collections of email messages. Emails can be imported from `.eml` files, indexed, and queried for specific information, such as conversations between specific participants or topics discussed.
- **Podcast Memory**: Manages transcripts of podcasts, enabling indexing and querying for specific topics or segments.

The package supports both natural language queries and structured search expressions. It can answer questions, generate summaries, and provide analyses based on the indexed data. Additionally, memories can be persisted to disk and reloaded as needed.

## Setup

To use the `conversation-memory` package, follow these steps:

1. **Install dependencies**: Run `pnpm install` to install the required dependencies.
2. **Environment variables**: Ensure that any necessary environment variables for the `KnowPro` and `memory-storage` packages are set. Refer to the hand-written README for details on these variables and how to configure them.
3. **External services**: If using embedding models, ensure access to the required external services, such as OpenAI.

For more detailed setup instructions, consult the hand-written README.

## Key Files

The `conversation-memory` package is structured into several key files, each responsible for specific functionalities:

- **[index.ts](./src/index.ts)**: The main entry point of the package, exporting core functionalities for managing different types of memories.
- **[conversationMemory.ts](./src/conversationMemory.ts)**: Implements the `ConversationMemory` class, which handles interactive chats and agent interaction history.
- **[docMemory.ts](./src/docMemory.ts)**: Implements the `DocMemory` class for managing collections of document parts, such as transcripts and text files.
- **[emailMemory.ts](./src/emailMemory.ts)**: Implements the `EmailMemory` class for managing collections of email messages.
- **[podcast.ts](./src/podcast.ts)**: Implements the `PodcastMemory` class for handling podcast transcripts.
- **[common.ts](./src/common.ts)**: Provides utility functions used across different memory types, such as creating embedding models and managing indexing states.
- **[docImport.ts](./src/docImport.ts)**: Handles the import of text documents into `DocMemory`, supporting formats like `.vtt`, `.md`, `.html`, and `.txt`.
- **[emailImport.ts](./src/emailImport.ts)**: Handles the import of email messages in MIME format into `EmailMemory`.

## How to extend

To extend the `conversation-memory` package, follow these steps:

1. **Determine the memory type**: Identify the type of memory you want to extend or create (e.g., conversation, document, email, podcast).
2. **Locate the relevant file**: Open the corresponding file for the memory type you want to work on:
   - Conversation: [conversationMemory.ts](./src/conversationMemory.ts)
   - Document: [docMemory.ts](./src/docMemory.ts)
   - Email: [emailMemory.ts](./src/emailMemory.ts)
   - Podcast: [podcast.ts](./src/podcast.ts)
3. **Add or modify functionality**: Implement new methods or enhance existing ones. Ensure that new data types or messages are properly indexed and can be queried.
4. **Update schemas**: If your changes involve new query types or data structures, update the relevant schema files, such as [docSearchQuerySchema.ts](./src/docSearchQuerySchema.ts).
5. **Test your changes**: Write and run tests to validate your modifications. Use the `test-lib` package for testing utilities.

For example, to add support for a new type of memory, you could create a new class similar to `ConversationMemory` or `DocMemory`. Implement methods for adding data, indexing, and querying, and ensure integration with the `KnowPro` indexing and search mechanisms.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/index.js` _(not found on disk)_

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

_Auto-generated against commit `88f04471002e27f82ae1ddf73a7ae8acdfe09b5d` on `2026-07-03T09:02:51.801Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter conversation-memory docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

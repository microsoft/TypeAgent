<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=9c1e7a44ce8d89425ade9b78afc17b884f75ebd30aa10810b7aeb7967663a233 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# conversation-memory — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `conversation-memory` package is a TypeScript library that implements various types of conversational memory using Structured Retrieval-Augmented Generation (RAG). It leverages the `KnowPro` package for indexing and searching through structured data, enabling efficient storage, retrieval, and analysis of conversational and document-based information.

This package is designed to handle a wide range of conversational data, including chat messages, emails, documents, and transcripts. It supports incremental updates, natural language queries, and the generation of human-readable answers based on indexed knowledge.

## What it does

The `conversation-memory` package provides tools to manage and query different types of conversational memories. These include:

- **Conversation Memory**: Tracks interactive chats, agent interaction history, and invocation/response memory. New messages can be added and indexed incrementally, with extracted knowledge such as entities, actions, and topics enabling precise search and retrieval.
- **Document Memory**: Manages collections of document parts, such as meeting transcripts, video captions, markdown files, and HTML documents. Documents can be imported, indexed, and queried for summaries, lists, or specific information.
- **Email Memory**: Handles collections of email messages. Emails can be imported from `.eml` files, indexed, and queried for specific information, such as conversations between specific participants or topics discussed.
- **Podcast Memory**: Manages podcast transcripts, enabling indexing and querying for specific segments or topics.

The package supports two primary query methods:

1. **Natural Language Queries**: Users can ask questions in plain language, and the package translates these into structured search expressions.
2. **Structured Search Expressions**: Advanced users can directly query the memory using `KnowPro` search expressions for precise results.

The results of these queries can be used to generate answers, summaries, or analyses. Memories are mutable and can be persisted to disk or loaded on demand.

## Setup

To use the `conversation-memory` package, follow these steps:

1. **Install dependencies**: Run `pnpm install` to install the required packages.
2. **Environment variables**: Ensure that any necessary environment variables for the `KnowPro` and `memory-storage` packages are set. Refer to their respective documentation for details.
3. **External services**: If using embedding models, ensure access to the required external services, such as OpenAI.

For additional setup details, refer to the hand-written README.

## Key Files

The `conversation-memory` package is organized into several key files, each responsible for specific functionality:

- **[index.ts](./src/index.ts)**: The main entry point, exporting the core functionalities of the package.
- **[conversationMemory.ts](./src/conversationMemory.ts)**: Implements the `ConversationMemory` class for managing interactive chats and agent interaction history.
- **[docMemory.ts](./src/docMemory.ts)**: Implements the `DocMemory` class for managing collections of document parts, such as transcripts and markdown files.
- **[emailMemory.ts](./src/emailMemory.ts)**: Implements the `EmailMemory` class for managing collections of email messages.
- **[podcast.ts](./src/podcast.ts)**: Implements the `PodcastMemory` class for managing podcast transcripts.
- **[common.ts](./src/common.ts)**: Provides utility functions for embedding models, indexing state, and error handling.
- **[docImport.ts](./src/docImport.ts)**: Handles the import of text documents into `DocMemory`, supporting formats like `.vtt`, `.md`, `.html`, and `.txt`.
- **[emailImport.ts](./src/emailImport.ts)**: Handles the import of email messages in MIME format into `EmailMemory`.
- **[docSearchQuerySchema.ts](./src/docSearchQuerySchema.ts)**: Defines the schema for document search queries, including entity and facet terms.

## How to extend

To extend the `conversation-memory` package, follow these steps:

1. **Determine the memory type**: Identify whether you want to extend conversation, document, email, or podcast memory.
2. **Locate the relevant file**: Open the corresponding file for the memory type you want to extend:
   - Conversation: [conversationMemory.ts](./src/conversationMemory.ts)
   - Document: [docMemory.ts](./src/docMemory.ts)
   - Email: [emailMemory.ts](./src/emailMemory.ts)
   - Podcast: [podcast.ts](./src/podcast.ts)
3. **Add or modify functionality**: Implement new methods or enhance existing ones. For example:
   - To add a new type of memory, create a new class similar to `ConversationMemory` or `DocMemory`.
   - Implement methods for adding data, indexing, and querying.
   - Ensure that new data types are properly integrated with the `KnowPro` indexing and search mechanisms.
4. **Update schemas**: If your changes involve new query types or data structures, update the relevant schema files, such as [docSearchQuerySchema.ts](./src/docSearchQuerySchema.ts).
5. **Test your changes**: Write unit tests to validate your modifications. Use the `test-lib` package for testing utilities.

By following these steps, you can extend the `conversation-memory` package to support additional use cases or enhance its existing features. For example, you could add support for a new document format in [docImport.ts](./src/docImport.ts) or implement a new type of memory for a specific use case.

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

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-04T08:54:09.388Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter conversation-memory docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

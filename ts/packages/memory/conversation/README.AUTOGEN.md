<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=9c1e7a44ce8d89425ade9b78afc17b884f75ebd30aa10810b7aeb7967663a233 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# conversation-memory — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `conversation-memory` package is a TypeScript library that implements various types of conversational memory using Structured Retrieval-Augmented Generation (RAG). It leverages the `KnowPro` package for indexing and searching through structured data, enabling efficient storage, retrieval, and analysis of conversational and document-based information.

## What it does

The `conversation-memory` package supports the creation, indexing, and querying of different types of memories, including:

- **Conversation Memory**: Tracks interactive chats, agent interaction history, and invocation/response memory. Messages are timestamped and can be incrementally added to the memory.
- **Document Memory**: Manages collections of document parts, such as meeting transcripts, video captions, markdown files, and HTML documents. It supports importing and indexing documents in various formats, including `.vtt`, `.md`, `.html`, and `.txt`.
- **Email Memory**: Handles collections of email messages, including parsing and indexing emails in MIME format (e.g., `.eml` files). Extracted metadata includes sender, recipients, subject, and timestamps.
- **Podcast Memory**: Manages podcast transcripts, enabling indexing and retrieval of information from audio content.

The package provides the following key capabilities:

1. **Incremental Indexing**: New data (e.g., messages, emails, or document parts) can be added and indexed on demand.
2. **Knowledge Extraction**: Automatically extracts entities, actions, and topics from new data for indexing.
3. **Search and Retrieval**: Supports both natural language queries and structured search expressions using `KnowPro`. Users can search for entities, actions, topics, and other knowledge elements.
4. **Question Answering**: Translates natural language questions into structured search queries, retrieves relevant information, and generates human-readable answers.
5. **Persistence**: Memories can be saved to disk and reloaded as needed.

## Setup

To use the `conversation-memory` package, follow these steps:

1. **Install dependencies**: Run `pnpm install` to install the required dependencies.
2. **Environment variables**: Ensure that any necessary environment variables for the `KnowPro` and `memory-storage` packages are set. Refer to the hand-written README for specific details.
3. **External services**: If using embedding models, ensure access to external services like OpenAI for embedding generation.

For additional setup details, consult the hand-written README.

## Key Files

The `conversation-memory` package is structured into several key files, each responsible for specific functionality:

- **[index.ts](./src/index.ts)**: The main entry point, exporting the primary modules for conversation, document, email, and podcast memory.
- **[conversationMemory.ts](./src/conversationMemory.ts)**: Implements the `ConversationMemory` class, which manages interactive chats, agent interaction history, and related data.
- **[docMemory.ts](./src/docMemory.ts)**: Defines the `DocMemory` class for managing collections of document parts, such as transcripts and text files.
- **[emailMemory.ts](./src/emailMemory.ts)**: Implements the `EmailMemory` class for managing email collections, including parsing and indexing email messages.
- **[podcast.ts](./src/podcast.ts)**: Handles podcast transcripts and their integration into the memory system.
- **[common.ts](./src/common.ts)**: Provides utility functions for embedding models, indexing state management, and error handling.
- **[docImport.ts](./src/docImport.ts)**: Contains logic for importing text documents into `DocMemory`, supporting various file formats like `.vtt`, `.md`, `.html`, and `.txt`.
- **[emailImport.ts](./src/emailImport.ts)**: Handles the parsing and importing of email messages in MIME format.
- **[docSearchQuerySchema.ts](./src/docSearchQuerySchema.ts)**: Defines the schema for document-related search queries, including entity and facet terms.

## How to extend

To extend the `conversation-memory` package, follow these steps:

1. **Determine the memory type**: Identify the type of memory you want to extend or create (e.g., conversation, document, email, podcast).
2. **Locate the relevant file**: Open the corresponding file for the memory type:
   - Conversation: [conversationMemory.ts](./src/conversationMemory.ts)
   - Document: [docMemory.ts](./src/docMemory.ts)
   - Email: [emailMemory.ts](./src/emailMemory.ts)
   - Podcast: [podcast.ts](./src/podcast.ts)
3. **Add or modify functionality**: Implement new methods or extend existing ones. For example:
   - To add a new type of memory, create a new class similar to `ConversationMemory` or `DocMemory`.
   - Implement methods for adding data, indexing, and querying.
   - Ensure that new data types are properly integrated with the `KnowPro` indexing and search mechanisms.
4. **Update schemas**: If your changes involve new query types or data structures, update the relevant schema files, such as [docSearchQuerySchema.ts](./src/docSearchQuerySchema.ts).
5. **Test your changes**: Write unit tests to validate your modifications. Use the `test-lib` package for testing utilities.

For example, to add support for a new file format in `DocMemory`, you can extend the [docImport.ts](./src/docImport.ts) file to include a parser for the new format. Ensure that the parser extracts relevant metadata and content for indexing.

By following these guidelines, you can adapt the `conversation-memory` package to meet new requirements or enhance its existing capabilities.

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

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-05T09:01:32.154Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter conversation-memory docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

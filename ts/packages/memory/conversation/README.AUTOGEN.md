<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=9c1e7a44ce8d89425ade9b78afc17b884f75ebd30aa10810b7aeb7967663a233 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# conversation-memory — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `conversation-memory` package is a TypeScript library that implements various types of conversational memory using Structured Retrieval-Augmented Generation (RAG). It leverages the `KnowPro` package for indexing and searching through structured conversational data, enabling efficient storage, retrieval, and analysis of information from conversations, documents, emails, and other sources.

## What it does

The `conversation-memory` package supports the creation, indexing, and querying of different types of conversational memories. These include:

- **Conversation Memory**: Tracks interactive chats, agent interaction history, and invocation/response memory. Messages are timestamped and can be incrementally added to the memory.
- **Document Memory**: Manages collections of document parts, such as meeting transcripts, video transcripts, markdown files, and HTML documents. It supports importing and indexing documents in various formats, including `.vtt`, `.md`, `.html`, and `.txt`.
- **Email Memory**: Handles collections of email messages, including parsing and indexing emails in MIME format (e.g., `.eml` files).
- **Podcast Memory**: Manages podcast transcripts, enabling indexing and retrieval of information from audio content.

The package extracts salient knowledge from the input data, such as entities, actions, and topics, and indexes this knowledge for precise search and retrieval. Users can query the memory using natural language or structured search expressions. The package also supports generating answers, summaries, and analyses based on the indexed data.

Key features include:

- Incremental indexing of new data as it arrives.
- Support for natural language queries and structured search expressions.
- Integration with the `KnowPro` package for knowledge extraction and indexing.
- Persistence and on-demand loading of memories.

## Setup

To use the `conversation-memory` package, follow these steps:

1. **Install dependencies**: Run `pnpm install` to install the required dependencies.
2. **Environment variables**: Ensure that any necessary environment variables for the `KnowPro` and `memory-storage` packages are set. Refer to their respective documentation for details.
3. **External services**: If using embedding models, ensure access to external services like OpenAI for embedding generation.

For additional setup details, refer to the hand-written README.

## Key Files

The `conversation-memory` package is organized into several key files, each responsible for specific functionalities:

- **[index.ts](./src/index.ts)**: The main entry point, exporting the core functionalities of the package.
- **[conversationMemory.ts](./src/conversationMemory.ts)**: Implements the `ConversationMemory` class for managing interactive chats and agent interaction history.
- **[docMemory.ts](./src/docMemory.ts)**: Implements the `DocMemory` class for managing collections of document parts.
- **[emailMemory.ts](./src/emailMemory.ts)**: Implements the `EmailMemory` class for managing collections of email messages.
- **[podcast.ts](./src/podcast.ts)**: Implements the `PodcastMemory` class for managing podcast transcripts.
- **[common.ts](./src/common.ts)**: Contains utility functions shared across different memory types, such as embedding model creation and indexing state management.
- **[docImport.ts](./src/docImport.ts)**: Handles the import of text documents into `DocMemory`, supporting various file formats like `.vtt`, `.md`, `.html`, and `.txt`.
- **[emailImport.ts](./src/emailImport.ts)**: Handles the import and parsing of email messages in MIME format.
- **[docSearchQuerySchema.ts](./src/docSearchQuerySchema.ts)**: Defines the schema for document search queries, including entity and facet terms.

## How to extend

To extend the `conversation-memory` package, follow these steps:

1. **Determine the memory type**: Identify the type of memory you want to extend or create (e.g., conversation, document, email, podcast).
2. **Locate the relevant file**: Open the corresponding file for the memory type you want to modify or extend:
   - Conversation memory: [conversationMemory.ts](./src/conversationMemory.ts)
   - Document memory: [docMemory.ts](./src/docMemory.ts)
   - Email memory: [emailMemory.ts](./src/emailMemory.ts)
   - Podcast memory: [podcast.ts](./src/podcast.ts)
3. **Add or modify functionality**: Implement new methods or modify existing ones to support additional features. For example:
   - To add a new type of memory, create a new class similar to `ConversationMemory` or `DocMemory`.
   - Implement methods for adding data, indexing, and querying.
   - Ensure that new data types are properly integrated with the `KnowPro` indexing and search mechanisms.
4. **Update schemas**: If your changes involve new query types or data structures, update the relevant schema files, such as [docSearchQuerySchema.ts](./src/docSearchQuerySchema.ts).
5. **Write tests**: Validate your changes by writing and running tests. Use the `test-lib` package for testing utilities.

For example, to add support for a new file format in `DocMemory`, you can extend the [docImport.ts](./src/docImport.ts) file to include a parser for the new format. Then, update the `DocMemory` class to handle the new document type during indexing and querying.

By following these steps, you can customize and expand the `conversation-memory` package to meet your specific requirements.

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

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-06T09:20:03.630Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter conversation-memory docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

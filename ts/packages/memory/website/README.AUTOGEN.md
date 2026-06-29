<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=73b591a64f88c1ca1e17ec553cd8fff3527100688de4f7b607072fd8edd00ac2 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# website-memory — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `website-memory` package is a TypeScript library designed to implement structured Retrieval-Augmented Generation (RAG) for website visit memory. It includes features for importing bookmarks and browsing history, performing semantic searches, and extracting advanced knowledge from website content.

## What it does

The `website-memory` package provides several capabilities:

- **Importing Data**: It can import bookmarks and browsing history from Chrome and Edge browsers.
- **Content Extraction**: It offers multiple extraction modes (`basic`, `content`, `macros`, `full`) to extract various levels of information from websites, ranging from simple URL and title extraction to full content and relationship extraction using AI.
- **Batch Processing**: Efficiently processes multiple websites concurrently with progress tracking.
- **Knowledge Extraction**: Uses AI models to extract entities, actions, and relationships from website content.
- **Indexing and Search**: Builds structured data frames for visit frequency, categories, and bookmark organization, and supports semantic search over website content and metadata.
- **Error Handling**: Implements strict error handling with clear messages and fallback mechanisms.

## Setup

To set up the `website-memory` package, you need to configure the AI model and obtain necessary API keys. The environment variables required are:

- `OPENAI_API_KEY`: Your OpenAI API key for AI-powered extraction.
- `AZURE_API_KEY`: Your Azure API key for AI model configuration.

For detailed setup instructions, including how to obtain these keys and configure the AI model, refer to the hand-written README.

## Key Files

The `website-memory` package is organized into several key components:

- **Content Extraction**: The main extraction logic is implemented in [contentExtractor.ts](./src/extraction/contentExtractor.ts). This class handles different extraction modes and integrates with AI models for advanced knowledge extraction.
- **Batch Processing**: The [batchProcessor.ts](./src/extraction/batchProcessor.ts) file manages concurrent processing of multiple websites, including progress tracking and error handling.
- **Graph Management**: The [graphStateManager.ts](./src/graph/graphStateManager.ts) and [incrementalUpdater.ts](./src/graph/incrementalUpdater.ts) files handle the creation and updating of graphs for topic relationships and metrics calculation.
- **Types and Interfaces**: Core types and interfaces are defined in [types.ts](./src/extraction/types.ts), including `ExtractionInput`, `ExtractionResult`, and `PageContent`.

## How to extend

To extend the `website-memory` package, follow these steps:

1. **Start with Content Extraction**: Open [contentExtractor.ts](./src/extraction/contentExtractor.ts). This file contains the main extraction logic. You can add new extraction modes or enhance existing ones.
2. **Implement Batch Processing**: If you need to process multiple websites concurrently, modify [batchProcessor.ts](./src/extraction/batchProcessor.ts). Ensure that your changes handle progress tracking and error reporting.
3. **Update Graph Management**: For changes related to topic relationships and metrics, update [graphStateManager.ts](./src/graph/graphStateManager.ts) and [incrementalUpdater.ts](./src/graph/incrementalUpdater.ts).
4. **Define New Types**: If your extension requires new types or interfaces, add them to [types.ts](./src/extraction/types.ts).

After making your changes, run the tests to ensure everything works correctly. The package includes comprehensive tests to validate functionality.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)

### Dependencies

Workspace:

- [@typeagent/aiclient](../../../packages/aiclient/README.md)
- [@typeagent/common-utils](../../../packages/utils/commonUtils/README.md)
- [conversation-memory](../../../packages/memory/conversation/README.md)
- [knowledge-processor](../../../packages/knowledgeProcessor/README.md)
- [knowpro](../../../packages/knowPro/README.md)
- [memory-storage](../../../packages/memory/storage/README.md)
- [telemetry](../../../packages/telemetry/README.md)
- [test-lib](../../../packages/testLib/README.md)
- [typeagent](../../../packages/typeagent/README.md)

External: `better-sqlite3`, `cheerio`, `debug`, `dompurify`, `get-folder-size`, `graphology`, `graphology-communities-louvain`, `graphology-metrics`, `graphology-types`, `jsdom`, `typechat`

### Used by

- [agent-dispatcher](../../../packages/dispatcher/dispatcher/README.md)
- [browser-typeagent](../../../packages/agents/browser/README.md)

### Files of interest

`./src/extraction/index.ts`, `./src/index.ts`, `./src/schemas/pageTypeSchema.ts`, …and 18 more under `./src/`.

---

_Auto-generated against commit `127a36a95a15e918be533d6eaaf08adebe9070d9` on `2026-06-26T03:01:52.873Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter website-memory docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

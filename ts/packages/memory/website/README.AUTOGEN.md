<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=3ec0c0f6e51762bdc248ede255c7b076911b245d8c914c696b256f62cb48829c -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# website-memory — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `website-memory` package is a TypeScript library designed to implement structured Retrieval-Augmented Generation (RAG) for managing website visit memory. It provides tools for importing, organizing, and analyzing website data, such as bookmarks and browsing history, with advanced content extraction and knowledge processing capabilities.

## What it does

The `website-memory` package provides a range of features for handling website visit data:

- **Data Import**: Import bookmarks and browsing history from browsers like Chrome and Edge.
- **Content Extraction**: Extract structured data from websites using four distinct modes:
  - `basic`: Extracts only URLs and titles.
  - `content`: Extracts full content and AI-processed knowledge.
  - `macros`: Extracts content and detects actions.
  - `full`: Extracts content, actions, and relationships.
- **Batch Processing**: Process multiple websites concurrently with progress tracking and error handling.
- **Knowledge Extraction**: Use AI models to extract entities, actions, and relationships from website content.
- **Indexing and Search**: Build structured data frames for visit frequency, categories, and bookmark organization. Perform semantic searches over website content and metadata.
- **Graph Management**: Create and update graphs to represent relationships between topics and entities extracted from websites.
- **Error Handling**: Implements strict error handling with clear messages and fallback mechanisms.

The package integrates with other components in the TypeAgent ecosystem, such as `@typeagent/aiclient` for AI model interactions and `knowledge-processor` for advanced knowledge extraction.

## Setup

To use the `website-memory` package, follow these steps to configure the environment and dependencies:

1. **Install Dependencies**: Run `pnpm install` in the package directory to install all required dependencies.
2. **Set Environment Variables**:
   - `OPENAI_API_KEY`: Obtain an API key from OpenAI for AI-powered extraction.
   - `AZURE_API_KEY`: Obtain an API key from Azure for AI model configuration.
3. **Configure AI Models**:
   - Use the `@typeagent/aiclient` package to configure AI models. For example:
     ```typescript
     import { openai as ai } from "aiclient";
     const apiSettings = ai.azureApiSettingsFromEnv(ai.ModelType.Chat);
     const languageModel = ai.createChatModel(apiSettings);
     ```
   - Use the `knowledge-processor` package to create a knowledge extractor:
     ```typescript
     import { conversation as kpLib } from "knowledge-processor";
     const knowledgeExtractor = kpLib.createKnowledgeExtractor(languageModel);
     ```

For additional setup details, refer to the hand-written README.

## Key Files

The `website-memory` package is organized into several key files, each responsible for specific functionality:

- **[contentExtractor.ts](./src/extraction/contentExtractor.ts)**: Implements the main `ContentExtractor` class, which handles the core logic for extracting website content and knowledge. This file also manages the integration with AI models for advanced extraction modes.
- **[batchProcessor.ts](./src/extraction/batchProcessor.ts)**: Provides the `BatchProcessor` class for concurrent processing of multiple websites. It includes progress tracking and error handling mechanisms.
- **[types.ts](./src/extraction/types.ts)**: Defines the core types and interfaces used throughout the package, such as `ExtractionInput`, `ExtractionResult`, and `PageContent`.
- **[graphStateManager.ts](./src/graph/graphStateManager.ts)**: Manages the state of graphs used for representing topic relationships and metrics.
- **[incrementalUpdater.ts](./src/graph/incrementalUpdater.ts)**: Handles incremental updates to the topic graphs, ensuring that new data is integrated efficiently.
- **[topicGraphBuilder.ts](./src/graph/topicGraphBuilder.ts)**: Constructs and manages the topic graphs, including both flat and hierarchical representations.

## How to extend

To extend the `website-memory` package, follow these steps:

1. **Add or Modify Extraction Modes**:

   - Open [contentExtractor.ts](./src/extraction/contentExtractor.ts) to add new extraction modes or enhance existing ones.
   - Update the `EXTRACTION_MODE_CONFIGS` in [types.ts](./src/extraction/types.ts) to define the capabilities of the new mode.

2. **Enhance Batch Processing**:

   - Modify [batchProcessor.ts](./src/extraction/batchProcessor.ts) to add new features or improve the efficiency of batch processing.
   - Ensure that any changes include proper progress tracking and error handling.

3. **Extend Graph Management**:

   - Update [graphStateManager.ts](./src/graph/graphStateManager.ts) and [incrementalUpdater.ts](./src/graph/incrementalUpdater.ts) to support new types of relationships or metrics.
   - Use [topicGraphBuilder.ts](./src/graph/topicGraphBuilder.ts) to define new graph structures or enhance existing ones.

4. **Add New Types and Interfaces**:

   - If your extension requires new data structures, define them in [types.ts](./src/extraction/types.ts).

5. **Testing**:
   - After implementing your changes, run the existing test suite to ensure that your modifications do not introduce regressions.
   - Add new tests to cover the functionality you have added or modified.

By following these steps, you can effectively extend the `website-memory` package to meet your specific requirements.

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

_Auto-generated against commit `6bea19a9ee02598644b1ac3ab67c705dcc495832` on `2026-07-22T11:19:17.632Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter website-memory docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=213b9a616dc8788ea6ac1de09c8a57ad1cad0de81c8014f810fbdc6031b8f375 -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# kp — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `kp` package is a lightweight knowledge processor designed for keyword-based text indexing and dictionary enrichment. It is part of the TypeAgent monorepo and is implemented in TypeScript. The package provides a comprehensive pipeline for processing text data, from extracting keywords to building enriched, searchable indexes using a language model (LLM).

## What it does

The `kp` package offers a range of functionalities to process and index text data efficiently:

- **Keyword Extraction**: Extracts significant keywords from text chunks using heuristic methods, such as tokenization, stopword removal, and proper noun detection, without relying on LLMs.
- **Dictionary Enrichment**: Enhances the extracted vocabulary by generating lemmas, related terms, entity types, and parent types using an LLM. This step is performed in batches and is synchronous to ensure the enriched vocabulary is ready for indexing.
- **Inverted Index**: Builds an in-memory inverted index that maps normalized terms (e.g., lemmas) to the text chunks in which they appear. This enables efficient keyword-based search.
- **Metadata Indexing**: Supports metadata indexing for text chunks, allowing for case-insensitive matching and substring searches.
- **Group Indexing**: Manages chunk groups (e.g., threads, sections, episodes) and resolves temporal queries to groups and chunk ranges.
- **Query Engine**: Executes search queries against the indexes and retrieves relevant text chunks based on keyword matches and metadata filters.
- **Answer Generation**: Uses an LLM to generate grounded, natural-language answers from the search results, combining user queries with relevant text chunks.

This package is used by other components in the TypeAgent monorepo, such as the `email` agent, to provide advanced text processing and search capabilities.

## Setup

To use the `kp` package, you need to configure the following environment variable:

- `KP_MODEL`: This specifies the LLM model to be used for dictionary enrichment. The value should be a valid model identifier provided by your LLM service provider. Refer to the hand-written README for detailed instructions on obtaining and setting this value.

Ensure that the environment variable is set in your shell or in the `ts/.env` file before running the package.

## Key Files

The `kp` package is modular, with each file handling a specific aspect of the knowledge processing pipeline. Below is an overview of the key files and their responsibilities:

- **[index.ts](./src/index.ts)**: The main entry point of the package, exporting core types and functionalities.
- **[keywordExtractor.ts](./src/keywordExtractor.ts)**: Implements heuristic-based keyword extraction, including tokenization, stopword removal, and proper noun detection.
- **[llmEnrichment.ts](./src/llmEnrichment.ts)**: Handles the enrichment of the extracted vocabulary using an LLM. This includes generating lemmas, related terms, and entity types.
- **[invertedIndex.ts](./src/invertedIndex.ts)**: Manages the in-memory inverted index, which maps normalized terms to the text chunks they appear in.
- **[metadataIndex.ts](./src/metadataIndex.ts)**: Provides functionality for indexing and searching metadata associated with text chunks.
- **[groupIndex.ts](./src/groupIndex.ts)**: Manages chunk groups and resolves temporal queries to groups and chunk ranges.
- **[queryEngine.ts](./src/queryEngine.ts)**: Executes search queries against the indexes and retrieves relevant text chunks.
- **[answerGenerator.ts](./src/answerGenerator.ts)**: Generates natural-language answers to user queries by combining LLM-generated responses with relevant text chunks.
- **[indexBuilder.ts](./src/indexBuilder.ts)**: Orchestrates the entire pipeline, from keyword extraction to the creation of searchable indexes.

## How to extend

To extend the `kp` package, follow these steps:

1. **Understand the architecture**: Familiarize yourself with the overall structure of the package by reviewing the `## Key Files` section and the comments in the source code.

2. **Identify the target module**: Determine which part of the pipeline you want to modify or enhance. For example:

   - To improve keyword extraction, start with [keywordExtractor.ts](./src/keywordExtractor.ts).
   - To modify the LLM enrichment process, explore [llmEnrichment.ts](./src/llmEnrichment.ts).
   - To add new indexing capabilities, consider [invertedIndex.ts](./src/invertedIndex.ts) or [metadataIndex.ts](./src/metadataIndex.ts).

3. **Follow existing patterns**: The codebase is designed with modularity and consistency in mind. Use the existing patterns and conventions as a guide for your changes.

4. **Update the pipeline**: If your changes affect the overall processing pipeline, update [indexBuilder.ts](./src/indexBuilder.ts) to integrate your modifications.

5. **Write tests**: Add tests for your changes to ensure they work as expected. Tests should cover edge cases and validate the correctness of your implementation.

6. **Run tests**: Use the existing test suite to verify that your changes do not introduce regressions. Ensure all tests pass before submitting your changes.

By following these steps, you can effectively contribute to the `kp` package and enhance its functionality.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/index.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/aiclient](../../packages/aiclient/README.md)
- [@typeagent/common-utils](../../packages/utils/commonUtils/README.md)

External: `@anthropic-ai/claude-agent-sdk`, `better-sqlite3`, `debug`, `typechat`

### Used by

- [email](../../packages/agents/email/README.md)

### Files of interest

`./src/index.ts`, `./src/answerGenerator.ts`, `./src/cliPath.ts`, …and 12 more under `./src/`.

### Environment variables

_1 environment variable referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `KP_MODEL`

---

_Auto-generated against commit `366aaf867a7e8e5d130b6c87a365516bab725269` on `2026-07-07T09:05:05.703Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter kp docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

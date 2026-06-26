<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=8c860a567260033be51b4e20b4a6d7c901861639a480e4aa9ca4136b6d40b8e0 -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# kp — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `kp` package is a lightweight knowledge processor designed for keyword indexing with dictionary enrichment. It builds an inverted index from text chunks and enriches the vocabulary using a language model (LLM). This package is part of the TypeAgent monorepo and is implemented in TypeScript.

## What it does

The `kp` package provides several key functionalities:

- **Keyword Extraction**: Extracts significant keywords from text chunks using heuristics without LLM calls.
- **Dictionary Enrichment**: Enriches the extracted vocabulary with lemmas, related terms, entity types, and parent types using an LLM.
- **Inverted Index**: Builds an in-memory inverted index for efficient keyword-based search.
- **Metadata Index**: Manages metadata indexing for text chunks, allowing for case-insensitive matching and substring searches.
- **Group Index**: Manages chunk groups (e.g., threads, sections, episodes) and resolves temporal queries to groups and chunk ranges.
- **Query Engine**: Executes search queries against the built indexes and retrieves relevant text chunks.
- **Answer Generation**: Generates grounded natural-language answers from scored chunks using an LLM.

## Setup

To set up the `kp` package, you need to configure the following environment variable:

- `KP_MODEL`: Specifies the model to be used for LLM enrichment. Obtain the appropriate model identifier from your LLM provider.

For detailed setup instructions, see the hand-written README.

## Key Files

The `kp` package is organized into several modules, each responsible for different aspects of the knowledge processing pipeline:

- **[index.ts](./src/index.ts)**: The main entry point that exports core types and functionalities.
- **[keywordExtractor.ts](./src/keywordExtractor.ts)**: Extracts significant keywords from text chunks using heuristics.
- **[llmEnrichment.ts](./src/llmEnrichment.ts)**: Enriches the extracted vocabulary using an LLM.
- **[invertedIndex.ts](./src/invertedIndex.ts)**: Builds and manages the in-memory inverted index.
- **[metadataIndex.ts](./src/metadataIndex.ts)**: Manages metadata indexing for text chunks.
- **[groupIndex.ts](./src/groupIndex.ts)**: Manages chunk groups and resolves temporal queries.
- **[queryEngine.ts](./src/queryEngine.ts)**: Executes search queries against the built indexes.
- **[answerGenerator.ts](./src/answerGenerator.ts)**: Generates grounded natural-language answers from scored chunks.
- **[indexBuilder.ts](./src/indexBuilder.ts)**: Orchestrates the full pipeline from text chunks to searchable indexes.

## How to extend

To extend the `kp` package, follow these steps:

1. **Identify the module to extend**: Determine which part of the pipeline you need to modify or enhance. For example, if you need to improve keyword extraction, start with [keywordExtractor.ts](./src/keywordExtractor.ts).

2. **Open the relevant file**: Open the file corresponding to the module you identified. Each file contains detailed comments explaining its purpose and functionality.

3. **Follow the existing patterns**: Implement your changes following the existing code patterns and conventions. Ensure that your modifications are consistent with the overall architecture.

4. **Add tests**: Write tests for your changes to ensure they work as expected. Place your tests in the appropriate test files or create new ones if necessary.

5. **Run tests**: Execute the tests to verify your changes. Ensure that all tests pass before committing your modifications.

By following these steps, you can effectively extend the `kp` package and contribute to its development.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)

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

_Auto-generated against commit `127a36a95a15e918be533d6eaaf08adebe9070d9` on `2026-06-26T03:01:52.873Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter kp docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

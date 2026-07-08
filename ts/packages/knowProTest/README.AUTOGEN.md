<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=3089b8a6ff5b9d0d1c0f2edb926eee511c7cf1e01b75c6c229564b4257499222 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# knowpro-test — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `knowpro-test` package is a TypeScript library that provides experimental sample code and utility wrappers for testing and evaluating the `knowPro` package. It is primarily used in conjunction with test applications and evaluation tools, such as the [chat-example](../../examples/chat/README.md). This package demonstrates how to set up and use `knowPro` for tasks like natural language memory searches and generating answers to questions based on stored knowledge.

## What it does

The `knowpro-test` package serves as a testing and demonstration layer for the `knowPro` package. It provides:

- **Natural Language Memory Search**: The `execSearchRequest` method allows users to perform natural language searches on conversation memory, retrieving relevant knowledge and messages.
- **Answer Generation**: The `execGetAnswerRequest` method enables users to generate natural language answers to questions based on the stored memory.
- **Batch Processing**: The `runAnswerBatch` function in [answerTest.ts](./src/answerTest.ts) supports processing multiple questions and answers in batch mode.
- **Action Comparison**: The `compareActions` function in [knowledgeTest.ts](./src/knowledgeTest.ts) provides utilities for comparing actions and their attributes.
- **Logging**: The package includes logging utilities to record command results and test reports for debugging and analysis.

The package also demonstrates how to configure and use large language models (LLMs) and embedding models, as well as how to create query translators and answer generators.

## Setup

To use the `knowpro-test` package, ensure the following setup steps are completed:

1. **Environment Variables**: The package relies on the `@typeagent/aiclient` package for LLM and embedding model configurations. Ensure that the required API keys and endpoints are set in your environment variables. Refer to the `@typeagent/aiclient` documentation for details on the specific variables needed.
2. **LLM and Embedding Models**: The `knowpro-test` package uses LLMs and embedding models for query translation and answer generation. The hand-written README provides guidance on setting up these models.
3. **Dependencies**: Install the required dependencies using `pnpm install` in the `ts/packages/knowProTest/` directory.

For additional setup details, refer to the hand-written README.

## Key Files

The `knowpro-test` package is organized into several key files, each serving a specific purpose:

- **[index.ts](./src/index.ts)**: The main entry point that exports the package's modules and functionalities.
- **[knowproContext.ts](./src/knowproContext.ts)**: Defines the `KnowproContext` class, which sets up the LLMs, embedding models, query translators, and answer generators. This file is central to understanding the package's configuration and initialization.
- **[knowproCommands.ts](./src/knowproCommands.ts)**: Implements the core methods `execSearchRequest` and `execGetAnswerRequest` for interacting with the `knowPro` package.
- **[answerTest.ts](./src/answerTest.ts)**: Contains the `runAnswerBatch` function for batch processing of questions and answers.
- **[knowledgeTest.ts](./src/knowledgeTest.ts)**: Provides utilities for comparing actions and their attributes, such as `compareActions` and `compareAction`.
- **[common.ts](./src/common.ts)**: Includes utility functions for file handling, command parsing, and embedding generation.
- **[logging.ts](./src/logging.ts)**: Manages logging of command results and test reports.
- **[models.ts](./src/models.ts)**: Contains functions for creating and configuring language models, such as `createKnowledgeModel`.

## How to extend

To extend the `knowpro-test` package, follow these steps:

1. **Understand the Context**: Start by reviewing the [knowproContext.ts](./src/knowproContext.ts) file to understand how the `KnowproContext` class initializes models and sets up the environment.
2. **Add New Commands**: Implement new commands in the [knowproCommands.ts](./src/knowproCommands.ts) file. Use the existing `execSearchRequest` and `execGetAnswerRequest` methods as templates.
3. **Enhance Utilities**: If your new functionality requires additional utilities, add them to the [common.ts](./src/common.ts) file.
4. **Test Your Changes**: Update or create test cases in [answerTest.ts](./src/answerTest.ts) and [knowledgeTest.ts](./src/knowledgeTest.ts) to validate your new features.
5. **Log Results**: Use the logging utilities in [logging.ts](./src/logging.ts) to record the results of your commands and tests.
6. **Integrate Models**: If your extension involves new LLMs or embedding models, update the [models.ts](./src/models.ts) file to include their configuration.

By following these steps, you can effectively extend the `knowpro-test` package to support additional use cases and enhance its capabilities.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/index.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/aiclient](../../packages/aiclient/README.md)
- [conversation-memory](../../packages/memory/conversation/README.md)
- [interactive-app](../../packages/interactiveApp/README.md)
- [knowledge-processor](../../packages/knowledgeProcessor/README.md)
- [knowpro](../../packages/knowPro/README.md)
- [typeagent](../../packages/typeagent/README.md)

External: `typechat`

### Used by

- [chat-example](../../examples/chat/README.md)

### Files of interest

`./src/index.ts`, `./src/answerTest.ts`, `./src/common.ts`, …and 9 more under `./src/`.

---

_Auto-generated against commit `366aaf867a7e8e5d130b6c87a365516bab725269` on `2026-07-07T09:05:05.703Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter knowpro-test docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

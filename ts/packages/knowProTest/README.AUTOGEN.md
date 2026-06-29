<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=6b14b3096803129aaee48929ae13158a87982cc20d48871314d780008e0dd4b5 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# knowpro-test — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `knowpro-test` package is a TypeScript library designed to provide experimental sample code and wrappers for testing and evaluating the `knowPro` package. It is primarily used by test applications and evaluation tooling, such as the [chat-example](../../examples/chat/README.md).

## What it does

The `knowpro-test` package facilitates the setup and execution of various KnowPro use cases, including:

- **Searching memory using natural language**: The `execSearchRequest` method allows users to perform natural language searches against conversation memory.
- **Answering natural questions**: The `execGetAnswerRequest` method enables users to get natural language answers to questions about the memory.

Additionally, the package includes utilities for handling batch processing of questions and answers, logging, and comparison of actions. It demonstrates how to set up LLM and embedding models, create query translators, and generate answers.

## Setup

To set up the `knowpro-test` package, ensure you have the necessary environment variables and API keys configured. The package relies on models and settings from the `aiclient` package, which may require specific API keys and endpoints.

Refer to the hand-written README for detailed setup instructions, including how to configure LLM and embedding models, and how to create query translators and answer generators.

## Key Files

The `knowpro-test` package is organized into several key files, each responsible for different aspects of the functionality:

- **[index.ts](./src/index.ts)**: The main entry point that exports various modules and functionalities.
- **[answerTest.ts](./src/answerTest.ts)**: Contains the `runAnswerBatch` function for processing batches of questions and answers.
- **[common.ts](./src/common.ts)**: Provides common utility functions for file handling, command parsing, and embedding generation.
- **[knowledgeTest.ts](./src/knowledgeTest.ts)**: Includes functions for comparing actions and their attributes.
- **[knowproCommands.ts](./src/knowproCommands.ts)**: Implements the `execSearchRequest` and `execGetAnswerRequest` methods for interacting with KnowPro.
- **[knowproContext.ts](./src/knowproContext.ts)**: Defines the `KnowproContext` class, which sets up the models and context for executing commands.
- **[logging.ts](./src/logging.ts)**: Handles logging of command results and test reports.
- **[models.ts](./src/models.ts)**: Contains functions for creating and configuring language models.

## How to extend

To extend the `knowpro-test` package, follow these steps:

1. **Start with the context**: Open the [knowproContext.ts](./src/knowproContext.ts) file to understand how the context is set up and how models are initialized.
2. **Add new commands**: Implement new commands in the [knowproCommands.ts](./src/knowproCommands.ts) file. Follow the pattern used by `execSearchRequest` and `execGetAnswerRequest`.
3. **Update utilities**: If your new functionality requires additional utilities, add them to the [common.ts](./src/common.ts) file.
4. **Test your changes**: Create or update test cases in the [answerTest.ts](./src/answerTest.ts) and [knowledgeTest.ts](./src/knowledgeTest.ts) files to ensure your new commands work as expected.
5. **Log results**: Use the logging functions in the [logging.ts](./src/logging.ts) file to record the results of your commands and tests.

By following these steps, you can extend the `knowpro-test` package to support additional use cases and improve its functionality.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)

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

_Auto-generated against commit `127a36a95a15e918be533d6eaaf08adebe9070d9` on `2026-06-26T03:01:52.873Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter knowpro-test docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

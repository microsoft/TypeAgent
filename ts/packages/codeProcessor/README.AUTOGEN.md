<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=a8c90fe833cf8b512fa06d07d7c6e99af9206bee93e55e5dd43f7733d7517671 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# code-processor — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `codeProcessor` package is a TypeScript library designed to facilitate the use of AI in working with source code. It leverages structured prompting, large language models (LLMs), and schemas to perform tasks such as code analysis, review, debugging assistance, search, and Q&A.

## What it does

The `codeProcessor` package provides several capabilities for interacting with and processing code using AI:

- **Code Analysis and Review**: Functions like `review`, `debug`, and `breakpoints` in the `CodeReviewer` interface allow for detailed analysis and suggestions for improvements in the code.
- **LLM Mediated Debugging Assistance**: The `debug` function helps identify issues in the code and suggests breakpoints.
- **Search and Q&A**: The `answer` function can respond to questions about the code, providing relevant lines and comments.
- **Code Knowledge**: The `document` function generates documentation for code blocks, enhancing code understanding and maintainability.

These functionalities are implemented through various schemas and handlers, such as `codeAnswerSchema`, `codeDocSchema`, `codeGenSchema`, and `codeReviewer`.

## Setup

To set up the `codeProcessor` package, ensure you have the necessary dependencies installed. The package relies on other workspace packages like `aiclient`, `knowledge-processor`, and `typeagent`, as well as external packages `typechat` and `typescript`.

1. Install dependencies:

   ```sh
   pnpm install
   ```

2. Set up environment variables if required (refer to the hand-written README for detailed steps).

## Key Files
The `codeProcessor` package is structured into several key files, each responsible for different aspects of code processing:

- **Schemas**: Define the structure of data used in code processing.

  - [codeAnswerSchema.ts](./src/codeAnswerSchema.ts): Defines the structure for answers related to code questions.
  - [codeDocSchema.ts](./src/codeDocSchema.ts): Defines the structure for code documentation.
  - [codeGenSchema.ts](./src/codeGenSchema.ts): Defines the structure for generated code responses.

- **Handlers**: Implement the logic for processing code.

  - [code.ts](./src/code.ts): Contains functions for manipulating and annotating code.
  - [codeGenerator.ts](./src/codeGenerator.ts): Implements the `CodeGenerator` interface for generating code.
  - [codeReviewer.ts](./src/codeReviewer.ts): Implements the `CodeReviewer` interface for reviewing and debugging code.

- **Indexing**: Manages the storage and retrieval of code blocks.

  - [codeIndex.ts](./src/codeIndex.ts): Implements the `SemanticCodeIndex` interface for indexing and searching code.

- **Entry Point**: Exports the main functionalities of the package.
  - [index.ts](./src/index.ts): Aggregates and exports functions and schemas from other files.

## How to extend

To extend the `codeProcessor` package, follow these steps:

1. **Identify the area to extend**: Determine whether you need to add new schemas, handlers, or indexing functionalities.

2. **Create or modify files**:

   - For new schemas, create a new TypeScript file in the `src` directory and define the schema.
   - For new handlers, implement the required functions in a new or existing file in the `src` directory.
   - For indexing functionalities, modify [codeIndex.ts](./src/codeIndex.ts) or create a new file if necessary.

3. **Export new functionalities**: Ensure that new functions or schemas are exported in [index.ts](./src/index.ts).

4. **Test your changes**: Write tests to verify the new functionalities. Run the tests using:
   ```sh
   pnpm test
   ```

By following these steps, you can effectively extend the capabilities of the `codeProcessor` package.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)

### Dependencies

Workspace:

- [aiclient](../../packages/aiclient/README.md)
- [knowledge-processor](../../packages/knowledgeProcessor/README.md)
- [typeagent](../../packages/typeagent/README.md)

External: `typechat`, `typescript`

### Used by

- [chat-example](../../examples/chat/README.md)
- [telemetry-query-example](../../examples/commandHistogram/README.md)
- [website-aliases](../../examples/websiteAliases/README.md)

### Files of interest

`./src/codeAnswerSchema.ts`, `./src/codeDocSchema.ts`, `./src/codeGenSchema.ts`, …and 9 more under `./src/`.

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T10:06:08.858Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter code-processor docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

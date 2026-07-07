<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=33b99497e917bbf26228c31113fa8aae8babe5505172b8656e5c6b8506f52ea7 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# code-processor — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `codeProcessor` package is a TypeScript library designed to integrate AI capabilities into workflows involving source code. It leverages structured prompting, large language models (LLMs), and predefined schemas to perform tasks such as code analysis, debugging assistance, search, Q&A, and documentation generation. This package is part of the TypeAgent monorepo and interacts with other workspace packages like `aiclient` and `knowledge-processor`.

## What it does

The `codeProcessor` package provides a range of functionalities for working with source code using AI:

- **Code Analysis and Review**: The `review` and `debug` methods in the `CodeReviewer` interface analyze code for potential issues, suggest improvements, and identify bugs. The `breakpoints` method provides recommendations for setting breakpoints to debug specific issues.
- **LLM-Assisted Debugging**: By leveraging LLMs, the package can assist in debugging by analyzing code and providing actionable insights.
- **Search and Q&A**: The `answer` method allows users to query the codebase, returning relevant lines and comments to address specific questions.
- **Code Documentation**: The `document` method generates structured documentation for code blocks, improving code readability and maintainability.
- **Code Generation**: The `generate` method in the `CodeGenerator` interface creates new code snippets or functions based on user-defined specifications.
- **Semantic Indexing**: The `SemanticCodeIndex` interface enables indexing and searching of code blocks, facilitating efficient retrieval of relevant code snippets.

These capabilities are implemented through a combination of schemas, handlers, and indexing mechanisms, making the package modular and extensible.

## Setup

To use the `codeProcessor` package, follow these steps:

1. **Install dependencies**:
   Ensure all required dependencies are installed by running:

   ```sh
   pnpm install
   ```

2. **Environment variables**:
   If the package requires specific environment variables, refer to the hand-written README for details on how to configure them.

3. **Dependencies**:
   The package depends on the following workspace and external packages:
   - Workspace: `@typeagent/aiclient`, `knowledge-processor`, `typeagent`
   - External: `typechat`, `typescript`

No additional setup steps are required unless specified in the hand-written README.

## Key Files

The `codeProcessor` package is organized into several key files, each serving a specific purpose:

### Schemas

Schemas define the structure of data used in various operations:

- [codeAnswerSchema.ts](./src/codeAnswerSchema.ts): Defines the structure for answers to code-related questions, including relevant lines and their comments.
- [codeDocSchema.ts](./src/codeDocSchema.ts): Specifies the format for code documentation, including line-level comments.
- [codeGenSchema.ts](./src/codeGenSchema.ts): Outlines the structure for generated code responses, including the generated code and associated test cases.
- [codeReviewSchema.ts](./src/codeReviewSchema.ts): Describes the structure for code reviews, including comments, bugs, and breakpoint suggestions.

### Handlers

Handlers implement the logic for processing and interacting with code:

- [code.ts](./src/code.ts): Provides utility functions for manipulating and annotating code, such as splitting code into lines and adding line numbers.
- [codeGenerator.ts](./src/codeGenerator.ts): Implements the `CodeGenerator` interface for generating code snippets or functions based on user input.
- [codeReviewer.ts](./src/codeReviewer.ts): Implements the `CodeReviewer` interface for reviewing, debugging, and documenting code.

### Indexing

Indexing files manage the storage and retrieval of code blocks:

- [codeIndex.ts](./src/codeIndex.ts): Implements the `SemanticCodeIndex` interface, enabling semantic indexing and searching of code blocks.

### Entry Point

The main entry point aggregates and exports the package's functionalities:

- [index.ts](./src/index.ts): Serves as the central export file, exposing schemas, handlers, and other utilities.

## How to extend

The `codeProcessor` package is designed to be extensible. To add new features or modify existing ones, follow these steps:

1. **Identify the area to extend**:
   Determine whether you need to add new schemas, handlers, or indexing functionalities.

2. **Create or modify files**:

   - **Schemas**: If new data structures are required, create a new schema file in the `src` directory and define the structure.
   - **Handlers**: For new processing logic, implement the required functions in a new or existing file in the `src` directory.
   - **Indexing**: To enhance or modify indexing capabilities, update [codeIndex.ts](./src/codeIndex.ts) or create a new file.

3. **Export new functionalities**:
   Ensure that any new schemas, handlers, or utilities are exported in [index.ts](./src/index.ts).

4. **Write tests**:
   Add tests to verify the new functionalities. Place test files in the appropriate directory and run them using:

   ```sh
   pnpm test
   ```

5. **Document changes**:
   Update the hand-written README or other relevant documentation to reflect the new features.

By following these steps, you can effectively extend the `codeProcessor` package to meet new requirements or integrate additional AI-driven capabilities.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/index.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/aiclient](../../packages/aiclient/README.md)
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

_Auto-generated against commit `366aaf867a7e8e5d130b6c87a365516bab725269` on `2026-07-07T09:05:05.703Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter code-processor docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

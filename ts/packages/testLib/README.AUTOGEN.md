<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=b66d186d3fd57284f1198458d6c0fa78e39a344f2516706fe2a6bf69d79551ff -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# test-lib — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `testLib` package is a shared testing library within the TypeAgent monorepo. It provides a collection of utility functions and wrappers designed to simplify and standardize unit testing across various packages. By centralizing common testing patterns and utilities, `testLib` ensures consistency and reduces duplication in test code.

## What it does

The `testLib` package supports a variety of testing needs, with a focus on the following areas:

- **File Operations**: Utilities for handling test files and directories, such as reading files, parsing JSON, and managing test output directories. Examples include `readTestFile`, `readTestJsonFile`, and `ensureOutputDir`.
- **Model Handling**: Functions to create and manage test models for chat and embedding scenarios. Examples include `createTestChatModel` and `createTestEmbeddingModel`.
- **Argument Parsing**: A utility to parse command-line styled arguments into structured objects, provided by `parseCommandArgs`.
- **Conditional Testing**: Wrappers like `testIf` and `describeIf` allow tests or test suites to run conditionally based on environment settings or other criteria.
- **Verification Utilities**: Functions to validate test results and data structures, such as `verifyResult`, `verifyString`, and `verifyStringArray`.

These utilities are widely used by other packages in the monorepo, including `agent-cache`, `conversation-memory`, `knowpro`, `memory-storage`, and `website-memory`.

## Setup

To use the `testLib` package, ensure the following environment variables are set:

- `AZURE_OPENAI_API_KEY`: Required for testing chat models.
- `AZURE_OPENAI_API_KEY_EMBEDDING`: Required for testing embedding models.

These keys are used to configure OpenAI models for testing purposes. You can set them in a `.env` file or directly in your environment. For more details on obtaining and configuring these keys, refer to the hand-written README.

## Key Files

The `testLib` package is organized into several key files, each focusing on a specific aspect of testing:

- **[index.ts](./src/index.ts)**: The main entry point that re-exports all utilities from other modules.
- **[file.ts](./src/file.ts)**: Handles file operations, such as reading, writing, and managing directories.
- **[models.ts](./src/models.ts)**: Provides utilities for creating and managing test models, including mock models for chat and embedding.
- **[parse.ts](./src/parse.ts)**: Contains the `parseCommandArgs` function for parsing command-line styled arguments.
- **[test.ts](./src/test.ts)**: Includes utilities for conditional test execution, such as `testIf` and `describeIf`.
- **[verify.ts](./src/verify.ts)**: Offers functions for verifying test results and data structures.

### Detailed File Responsibilities

- **[file.ts](./src/file.ts)**:

  - Functions for file and directory management, including `readTestFile`, `readTestJsonFile`, and `ensureOutputDir`.
  - Utility functions like `getAbsolutePath` and `getRootDataPath` to standardize file path handling.

- **[models.ts](./src/models.ts)**:

  - Functions to create and manage test models, such as `createTestChatModel` and `createTestEmbeddingModel`.
  - Includes `NullEmbeddingModel`, a mock implementation for testing scenarios without actual model dependencies.

- **[parse.ts](./src/parse.ts)**:

  - `parseCommandArgs`: Parses command-line styled arguments into named and unnamed arguments for flexible test configuration.

- **[test.ts](./src/test.ts)**:

  - Conditional test execution utilities like `testIf` and `describeIf`, which allow tests to run based on environment conditions or other criteria.

- **[verify.ts](./src/verify.ts)**:
  - Functions to validate test results and data structures, such as `verifyResult` and `verifyStringArray`.

## How to extend

To extend the `testLib` package, follow these steps:

1. **Identify the area to extend**: Determine which aspect of the library you need to enhance. For example, if you need additional file utilities, focus on [file.ts](./src/file.ts).

2. **Implement your changes**: Add your new functionality to the appropriate file. Follow the existing code style and patterns to maintain consistency.

3. **Export your additions**: Update [index.ts](./src/index.ts) to export your new functions, making them accessible to other packages.

4. **Write tests**: Add unit tests for your new functionality. Use the existing test utilities provided by `testLib` to ensure consistency.

5. **Run tests**: Execute the test suite to verify that your changes work as expected and do not introduce regressions.

By adhering to these steps, you can contribute effectively to the `testLib` package and ensure it continues to serve as a reliable foundation for testing across the TypeAgent monorepo.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/index.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/aiclient](../../packages/aiclient/README.md)
- [@typeagent/config](../../packages/config/README.md)

External: `typechat`

### Used by

- [agent-cache](../../packages/cache/README.md)
- [conversation-memory](../../packages/memory/conversation/README.md)
- [knowpro](../../packages/knowPro/README.md)
- [memory-storage](../../packages/memory/storage/README.md)
- [website-memory](../../packages/memory/website/README.md)

### Files of interest

`./src/index.ts`, `./src/file.ts`, `./src/models.ts`, …and 4 more under `./src/`.

---

_Auto-generated against commit `366aaf867a7e8e5d130b6c87a365516bab725269` on `2026-07-07T09:05:05.703Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter test-lib docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

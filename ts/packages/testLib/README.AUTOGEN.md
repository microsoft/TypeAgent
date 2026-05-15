<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=60895249f6f36f95253ca266a820acb813bf35e1dd8b83b5a53ee1a341f6fa32 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# test-lib — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `testLib` package is a shared testing library used across various TypeAgent packages. It provides utility functions and wrappers for common testing scenarios, particularly those involving Jest, file operations, and model handling.

## What it does

The `testLib` package offers a range of utilities to facilitate unit testing within the TypeAgent monorepo. Key functionalities include:

- **File Operations**: Functions to read, write, and manage test files and directories, such as `readTestFile`, `readTestJsonFile`, and `ensureDir`.
- **Model Handling**: Utilities to create and manage test models, including chat and embedding models, such as `createTestChatModel` and `createTestEmbeddingModel`.
- **Argument Parsing**: Functions to parse command-line styled arguments, such as `parseCommandArgs`.
- **Conditional Testing**: Wrappers to conditionally run tests based on environment settings, such as `testIf` and `describeIf`.
- **Verification**: Functions to verify test results and data structures, such as `verifyResult` and `verifyStringArray`.

These utilities are used by several other packages in the monorepo, such as `agent-cache`, `conversation-memory`, `knowpro`, `memory-storage`, and `website-memory`.

## Setup

The `testLib` package requires certain environment variables to be set for model handling. Specifically, it needs:

- `AZURE_OPENAI_API_KEY`
- `AZURE_OPENAI_API_KEY_EMBEDDING`

These keys are used to configure the OpenAI models for testing purposes. Ensure these environment variables are set in your `.env` file.

For detailed setup instructions, see the hand-written README.

## Key Files

The `testLib` package is structured into several key files, each responsible for different aspects of the library:

- **[index.ts](./src/index.ts)**: The entry point that exports functions from other modules.
- **[file.ts](./src/file.ts)**: Contains functions for file operations, such as reading and writing test files.
- **[models.ts](./src/models.ts)**: Provides utilities for creating and managing test models.
- **[parse.ts](./src/parse.ts)**: Includes functions to parse command-line styled arguments.
- **[test.ts](./src/test.ts)**: Offers wrappers for conditional testing based on environment settings.
- **[verify.ts](./src/verify.ts)**: Contains functions to verify test results and data structures.

### Detailed File Responsibilities

- **[file.ts](./src/file.ts)**:

  - `getAbsolutePath`: Converts a relative path to an absolute path.
  - `getRootDataPath`: Returns the root data path for tests.
  - `getOutputDirPath`: Returns the output directory path for tests.
  - `readTestFile`: Reads the content of a test file.
  - `readTestFileLines`: Reads all lines in a test file.
  - `readTestJsonFile`: Reads and parses a JSON test file.
  - `ensureDir`: Ensures a directory exists, creating it if necessary.
  - `ensureOutputDir`: Ensures the output directory exists, optionally cleaning it.

- **[models.ts](./src/models.ts)**:

  - `hasTestKeys`: Checks if the necessary environment variables for testing are set.
  - `createTestEmbeddingModel`: Creates a test embedding model.
  - `createTestChatModel`: Creates a test chat model.
  - `createTestModels`: Creates both chat and embedding models for testing.
  - `NullEmbeddingModel`: A mock embedding model for testing purposes.

- **[parse.ts](./src/parse.ts)**:

  - `parseCommandArgs`: Parses command-line styled arguments into named and unnamed arguments.

- **[test.ts](./src/test.ts)**:

  - `testIf`: Conditionally runs a test based on a provided function.
  - `describeIf`: Conditionally runs a test suite based on a provided function.
  - `shouldSkip`: Determines if tests should be skipped based on environment settings.

- **[verify.ts](./src/verify.ts)**:
  - `verifyResult`: Verifies the result of a test.
  - `verifyString`: Verifies a string.
  - `verifyArray`: Verifies an array.
  - `verifyStringArray`: Verifies an array of strings.

## How to extend

To extend the `testLib` package, follow these steps:

1. **Identify the area to extend**: Determine which aspect of the library you need to enhance or add functionality to. For example, if you need additional file operations, start with [file.ts](./src/file.ts).

2. **Add your functionality**: Implement your new functions or enhancements in the appropriate file. Ensure your code follows the existing patterns and conventions.

3. **Export your functions**: Make sure to export your new functions in [index.ts](./src/index.ts) so they are available for use in other packages.

4. **Write tests**: Add unit tests for your new functionality to ensure it works as expected. Use the existing test patterns and utilities provided by the library.

5. **Run tests**: Execute the tests to verify your changes. Ensure all tests pass before committing your code.

By following these steps, you can effectively extend the `testLib` package to meet your testing needs.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)

### Dependencies

Workspace:

- [aiclient](../../packages/aiclient/README.md)

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

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T10:06:08.903Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter test-lib docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

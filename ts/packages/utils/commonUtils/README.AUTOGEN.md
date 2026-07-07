<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=c82d8234be9cbc440a5388cef1d2b96f4f2e92245f6c37676b696f3db017962e -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/common-utils — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/common-utils` package provides a set of utility functions and types that are shared across the TypeAgent project. These utilities are designed to simplify common tasks such as object property manipulation, base64 encoding/decoding, promise handling, and rate limiting. The package is used extensively across the TypeAgent monorepo, serving as a foundational library for other packages and tools.

## What it does

The `@typeagent/common-utils` package includes a variety of utility functions and types that can be categorized as follows:

1. **Object Property Utilities**:

   - `getObjectPropertyNames`: Retrieves all property names from an object, including nested properties.
   - `getObjectProperty`: Safely retrieves the value of a property from an object using a dot-separated string.
   - `setObjectProperty`: Sets the value of a property in an object using a dot-separated string.

2. **Base64 Encoding/Decoding**:

   - `uint8ArrayToBase64`: Converts a `Uint8Array` to a base64-encoded string.
   - `base64ToUint8Array`: Converts a base64-encoded string back to a `Uint8Array`.

3. **Promise Handling**:

   - `createPromiseWithResolvers`: Creates a promise along with its associated `resolve` and `reject` functions, enabling more flexible promise handling.

4. **Rate Limiting**:

   - `createLimiter`: Implements a rate limiter to control the number of concurrent executions of a callback function.

5. **String Utilities**:

   - `simpleStarRegex`: Generates a regular expression for matching strings with wildcard characters.

6. **Printing Utilities**:

   - `getElapsedString`: Formats elapsed time into a human-readable string.
   - `getColorElapsedString`: Formats elapsed time into a human-readable string with color.

7. **CLI Path Resolution**:
   - `resolveCliOnPath`: Resolves the absolute path of a CLI executable on the system's PATH.
   - `claudeExecutableOption`: Provides options for resolving the path to the Claude CLI executable.

These utilities are designed to work in both Node.js and browser environments, with separate implementations for platform-specific functionality, such as base64 encoding/decoding.

## Setup

This package does not require any special setup beyond installing its dependencies. To install the package, use the following command:

```sh
pnpm install
```

For more details on the installation process or prerequisites, refer to the hand-written README.

## Key Files

The `@typeagent/common-utils` package is organized into several key files, each responsible for specific functionality:

- **Entry Points**:

  - [indexNode.ts](./src/indexNode.ts): The main entry point for Node.js environments. It exports utilities specific to Node.js, such as `resolveCliOnPath` and `claudeExecutableOption`.
  - [indexBrowser.ts](./src/indexBrowser.ts): The main entry point for browser environments. It exports browser-compatible utilities, such as base64 encoding/decoding functions.

- **Source Files**:
  - [base64Browser.ts](./src/base64Browser.ts): Implements base64 encoding and decoding functions for browser environments using `btoa` and `atob`.
  - [base64Node.ts](./src/base64Node.ts): Implements base64 encoding and decoding functions for Node.js environments using the `Buffer` API.
  - [limiter.ts](./src/limiter.ts): Contains the `createLimiter` function for rate limiting.
  - [objectProperty.ts](./src/objectProperty.ts): Provides utilities for manipulating object properties, including `getObjectPropertyNames`, `getObjectProperty`, and `setObjectProperty`.
  - [print.ts](./src/print.ts): Includes functions for formatting elapsed time strings, such as `getElapsedString` and `getColorElapsedString`.
  - [promiseWithResolvers.ts](./src/promiseWithResolvers.ts): Implements the `createPromiseWithResolvers` function for creating promises with external resolve and reject handlers.
  - [cliPath.ts](./src/cliPath.ts): Provides utilities for resolving CLI executable paths on the system's PATH.

## How to extend

To add new functionality to the `@typeagent/common-utils` package, follow these steps:

1. **Identify the Area to Extend**:

   - Determine the category of utility you want to extend or create. For example, if you need to add a new string utility, consider adding it to a new file or an existing one like `simpleStarRegex.ts`.

2. **Add New Code**:

   - If the new functionality fits into an existing file, add it there. Otherwise, create a new file in the `src` directory and implement your function or type.

3. **Update Exports**:

   - Ensure your new functionality is exported from the appropriate entry point file:
     - For Node.js-specific utilities, update [indexNode.ts](./src/indexNode.ts).
     - For browser-compatible utilities, update [indexBrowser.ts](./src/indexBrowser.ts).

4. **Write Tests**:

   - Add unit tests for your new functionality in the `tests` directory. Follow the existing test structure to ensure consistency.

5. **Run Tests**:

   - Verify your changes by running the test suite. Use the following command:

   ```sh
   pnpm test
   ```

6. **Document Your Changes**:
   - Update the hand-written README or provide comments in the code to document the purpose and usage of your new functionality.

By following these steps, you can contribute effectively to the `@typeagent/common-utils` package while maintaining its structure and quality.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/indexNode.js` _(not found on disk)_
- default → `./dist/indexBrowser.js` _(not found on disk)_

### Dependencies

Workspace: _None._

External: `chalk`, `debug`

### Used by

- [@typeagent/action-grammar](../../../packages/actionGrammar/README.md)
- [@typeagent/agent-rpc](../../../packages/agentRpc/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [agent-cache](../../../packages/cache/README.md)
- [agent-cli](../../../packages/cli/README.md)
- [agent-dispatcher](../../../packages/dispatcher/dispatcher/README.md)
- [agent-server](../../../packages/agentServer/server/README.md)
- [agent-shell](../../../packages/shell/README.md)
- [browser-typeagent](../../../packages/agents/browser/README.md)
- [cache-rest-endpoint](../../../examples/cacheRESTEndpoint/README.md)
- _…and 14 more workspace consumers._

### Files of interest

`./src/base64Browser.ts`, `./src/base64Node.ts`, `./src/cliPath.ts`, …and 9 more under `./src/`.

---

_Auto-generated against commit `366aaf867a7e8e5d130b6c87a365516bab725269` on `2026-07-07T09:05:05.703Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/common-utils docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

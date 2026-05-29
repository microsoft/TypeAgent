<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=565defef6a41aad52d3f63c15581ed01814a024479818e0072c1b685aaa392d7 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/common-utils — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/common-utils` package provides a collection of utility functions and types that are commonly used across the TypeAgent project. This package is designed to be a shared library that simplifies various tasks such as object property manipulation, base64 encoding/decoding, promise handling, and rate limiting.

## What it does

The `@typeagent/common-utils` package offers several utility functions and types that can be grouped into the following categories:

1. **Object Property Utilities**:
   - `getObjectPropertyNames`: Retrieves the names of all properties in an object, including nested properties.
   - `getObjectProperty`: Safely gets the value of a property from an object using a dot-separated string.
   - `setObjectProperty`: Sets the value of a property in an object using a dot-separated string.

2. **Base64 Encoding/Decoding**:
   - `uint8ArrayToBase64`: Converts a `Uint8Array` to a base64 string.
   - `base64ToUint8Array`: Converts a base64 string to a `Uint8Array`.

3. **Promise Handling**:
   - `createPromiseWithResolvers`: Creates a promise along with its resolve and reject functions.

4. **Rate Limiting**:
   - `createLimiter`: Creates a rate limiter that limits the number of concurrent executions of a callback function.

5. **String Utilities**:
   - `simpleStarRegex`: Generates a simple regular expression for matching strings with wildcard characters.

6. **Printing Utilities**:
   - `getElapsedString`: Formats elapsed time in a human-readable string.
   - `getColorElapsedString`: Formats elapsed time in a human-readable string with color.

## Setup

This package does not require any special setup beyond installing its dependencies. To install the package, run:

```sh
pnpm install
```

## Key Files

The `@typeagent/common-utils` package is structured as follows:

- **Entry Points**:
  - [indexNode.ts](./src/indexNode.ts): Entry point for Node.js environments.
  - [indexBrowser.ts](./src/indexBrowser.ts): Entry point for browser environments.

- **Source Files**:
  - [base64Browser.ts](./src/base64Browser.ts): Contains functions for base64 encoding/decoding in browser environments.
  - [base64Node.ts](./src/base64Node.ts): Contains functions for base64 encoding/decoding in Node.js environments.
  - [limiter.ts](./src/limiter.ts): Contains the rate limiting functions.
  - [objectProperty.ts](./src/objectProperty.ts): Contains functions for manipulating object properties.
  - [print.ts](./src/print.ts): Contains functions for formatting elapsed time strings.
  - [promiseWithResolvers.ts](./src/promiseWithResolvers.ts): Contains functions for creating promises with resolvers.
  - simpleStarRegex.ts: Contains functions for generating simple regular expressions.

## How to extend

To extend the `@typeagent/common-utils` package, follow these steps:

1. **Identify the Utility to Extend**:
   - Determine which existing utility function or type you need to extend or modify. For example, if you need to add a new method for object property manipulation, start with [objectProperty.ts](./src/objectProperty.ts).

2. **Add New Functionality**:
   - Create a new file in the `src` directory if your functionality does not fit into any existing file. Otherwise, add your new function to the appropriate file.

3. **Export the New Functionality**:
   - Ensure that your new function or type is exported from the appropriate entry point file ([indexNode.ts](./src/indexNode.ts) or [indexBrowser.ts](./src/indexBrowser.ts)).

4. **Write Tests**:
   - Add tests for your new functionality to ensure it works as expected. Place your tests in the `tests` directory and follow the existing testing patterns.

5. **Run Tests**:
   - Execute the test suite to verify that your changes do not break existing functionality. Use the following command to run the tests:

   ```sh
   pnpm test
   ```

By following these steps, you can effectively extend the `@typeagent/common-utils` package with new utility functions and types.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/indexNode.js](./dist/indexNode.js)
- default → [./dist/indexBrowser.js](./dist/indexBrowser.js)

### Dependencies

Workspace:

- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)

External: `chalk`, `debug`

### Used by

- [@typeagent/agent-rpc](../../../packages/agentRpc/README.md)
- [agent-cache](../../../packages/cache/README.md)
- [agent-cli](../../../packages/cli/README.md)
- [agent-dispatcher](../../../packages/dispatcher/dispatcher/README.md)
- [agent-server](../../../packages/agentServer/server/README.md)
- [agent-shell](../../../packages/shell/README.md)
- [browser-typeagent](../../../packages/agents/browser/README.md)
- [cache-rest-endpoint](../../../examples/cacheRESTEndpoint/README.md)
- [debug-doc-generator-example](../../../examples/debugDocGenerator/README.md)
- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)
- _…and 11 more workspace consumers._

### Files of interest

`./src/base64Browser.ts`, `./src/base64Node.ts`, `./src/indexBrowser.ts`, …and 8 more under `./src/`.

---

_Auto-generated against commit `bc2dc7df084977bc3da24a9398fd3a08d55c3e7e` on `2026-05-29T04:54:39.349Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/common-utils docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

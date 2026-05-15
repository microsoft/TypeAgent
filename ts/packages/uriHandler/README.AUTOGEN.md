<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=8c191782840e951aadeae84098ae59247d161c798e2b42252616ae4b3ab9a2c7 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# uri-handler — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `uri-handler` package is a TypeScript library designed to process and handle URIs within the TypeAgent ecosystem. It parses command-line arguments to extract URIs and ports, validates the URIs, and connects to the dispatcher for further processing.

## What it does

The `uri-handler` package primarily focuses on handling URIs with the `type-agent:` protocol. It accepts URIs and port numbers as command-line arguments, validates them, and processes the URIs accordingly. The package integrates with the `agent-dispatcher` and `@typeagent/agent-server-client` packages to facilitate communication and processing of the URIs.

Key actions include:

- Parsing command-line arguments to extract URIs and ports.
- Validating the extracted URIs.
- Connecting to the dispatcher for further processing.

## Setup

To set up the `uri-handler` package, ensure you have the necessary dependencies installed. The package relies on `agent-dispatcher` and `@typeagent/agent-server-client`. You can install these dependencies using `pnpm install`.

There are no additional environment variables or external accounts required for this package.

## Key Files
The `uri-handler` package is structured as follows:

- [index.ts](./src/index.ts): The main entry point of the package. It contains the logic for parsing command-line arguments, validating URIs, and connecting to the dispatcher.
- [tsconfig.json](./src/tsconfig.json): TypeScript configuration file that extends the base configuration and specifies compiler options.

The package uses the `withConsoleClientIO` helper from `agent-dispatcher` and connects to the dispatcher using `connectDispatcher` from `@typeagent/agent-server-client`.

## How to extend

To extend the `uri-handler` package, follow these steps:

1. Open [index.ts](./src/index.ts) to understand the existing logic for parsing and validating URIs.
2. Add new functionality or modify existing logic as needed. Ensure that any new URIs or protocols are properly validated and processed.
3. Update or add tests to verify the new functionality. Ensure that the package continues to work as expected with the changes.
4. Run the tests to confirm that your changes are correct.

By following these steps, you can extend the `uri-handler` package to handle additional URI protocols or add new features.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

_No public exports declared in `package.json`._

### Dependencies

Workspace:

- [@typeagent/agent-server-client](../../packages/agentServer/client/README.md)
- [agent-dispatcher](../../packages/dispatcher/dispatcher/README.md)

External: _None at runtime._

### Files of interest

`./src/index.ts`, `./src/tsconfig.json`.

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T10:06:08.858Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter uri-handler docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

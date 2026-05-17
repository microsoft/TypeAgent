<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=835455e8c175de27561845dbe0357bd66dc9a775eb3a75f4efab1d1d36349478 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# test-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `test-agent` package is a dispatch agent designed for testing purposes within the TypeAgent framework. It provides functionality to execute specific actions related to mathematical operations and random number generation.

## What it does

The `test-agent` package supports the following actions:

- `add`: Performs addition of two numbers.
- `random`: Generates a random number.

These actions are defined in the [schema.ts](./src/schema.ts) file and handled in the [handler.ts](./src/handler.ts) file. The agent can process commands and return results based on the actions executed. The agent's metadata, including its emoji representation and description, is defined in the [manifest.json](./src/manifest.json) file.

## Setup

To set up the `test-agent` package, follow these steps:

1. Ensure you have the necessary dependencies installed by running `pnpm install`.
2. No additional environment variables or external accounts are required for this package.

## Key Files

The `test-agent` package consists of the following key files:

- [manifest.json](./src/manifest.json): Defines the agent's metadata, including its emoji representation, description, and schema details.
- [schema.ts](./src/schema.ts): Specifies the types for the actions supported by the agent.
- [handler.ts](./src/handler.ts): Contains the logic for handling the actions defined in the schema. It includes the `RequestCommandHandler` class for processing commands and the `executeAction` function for executing actions.

The agent is instantiated using the `instantiate` function, which sets up the command interface and action execution logic. The `handlers` object in the [handler.ts](./src/handler.ts) file defines the available commands and their handlers.

## How to extend

To extend the `test-agent` package, follow these steps:

1. Open the [schema.ts](./src/schema.ts) file to define new action types or modify existing ones.
2. Implement the logic for the new actions in the [handler.ts](./src/handler.ts) file. Add new cases to the `executeAction` function to handle the new actions.
3. If you need to add new commands, update the `handlers` object in the [handler.ts](./src/handler.ts) file with new command handlers.

After making changes, run tests to ensure the new functionality works as expected. You can add tests in a new file or update existing ones to cover the new actions and commands.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/manifest.json](./src/manifest.json)
- `./agent/handlers` → [./dist/handler.js](./dist/handler.js)

### Dependencies

Workspace:

- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)

External: _None at runtime._

### Files of interest

`./src/manifest.json`, `./src/handler.ts`, `./src/schema.ts`, …and 1 more under `./src/`.

### Agent surface

- Manifest: [./src/manifest.json](./src/manifest.json)

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T10:06:08.874Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter test-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

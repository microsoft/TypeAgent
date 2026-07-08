<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=d7e95bf747ceb760a07d41d2d0515846ece45c95d8e31bb24dc5639508090e14 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# photo-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `photo-agent` package is a TypeAgent application agent designed to handle photo-related actions. It enables the system to interact with a camera attached to the device, allowing users to take photos through natural language requests.

## What it does

The primary functionality of the `photo-agent` is to implement the `takePhoto` action. This action uses a connected camera to capture a photo based on user input. The agent interprets user requests such as "Take a photo of this sunset" or "Snap a picture of my outfit" and executes the corresponding action.

The `takePhoto` action accepts a single parameter, `originalRequest`, which captures the user's original input. This parameter can be used for logging or further processing. The agent's grammar, defined in [photoSchema.agr](./src/photoSchema.agr), supports a variety of natural language patterns to trigger the action.

## Setup

To use the `photo-agent`, ensure the following prerequisites are met:

1. **Camera Access**: Verify that a camera is connected to the system and accessible. This may require installing appropriate drivers or granting necessary permissions.
2. **Environment Configuration**: No specific environment variables are required for this package, but the system must support camera functionality.

For additional setup details, refer to the hand-written README.

## Key Files

The `photo-agent` package is organized into several key files that define its functionality:

- **[photoManifest.json](./src/photoManifest.json)**: This file contains the agent's manifest, including metadata such as the description, emoji representation, and schema details.
- **[photoSchema.ts](./src/photoSchema.ts)**: Defines the TypeScript types for the actions supported by the agent. Currently, it includes the `PhotoAction` and `TakePhotoAction` types.
- **[photoActionHandler.ts](./src/photoActionHandler.ts)**: Implements the core logic for handling the `takePhoto` action. This file includes functions for initializing the agent context, updating it, and executing actions.
- **[photoSchema.agr](./src/photoSchema.agr)**: Specifies the grammar rules for parsing user requests into actionable commands. It defines patterns for recognizing requests to take photos.
- **[photoSchema.tests.json](./src/photoSchema.tests.json)**: Contains test cases for validating the grammar and action handling. These tests ensure that user requests are correctly parsed and mapped to the `takePhoto` action.

## How to extend

To extend the `photo-agent` package, follow these steps:

1. **Define New Actions**: Add new action types to [photoSchema.ts](./src/photoSchema.ts). Each action should have a unique `actionName` and a set of parameters.
2. **Update Grammar**: Modify [photoSchema.agr](./src/photoSchema.agr) to include grammar rules for the new actions. Define patterns that map user requests to the new actions.
3. **Implement Action Handlers**: Extend the logic in [photoActionHandler.ts](./src/photoActionHandler.ts) to handle the new actions. Update the `executeAction` function to process the new action types.
4. **Add Test Cases**: Create new test cases in [photoSchema.tests.json](./src/photoSchema.tests.json) to validate the parsing and handling of the new actions.
5. **Test Your Changes**: Run the existing test suite and add new tests to ensure the agent behaves as expected with the new functionality.

To get started, open [photoActionHandler.ts](./src/photoActionHandler.ts) and review the existing implementation of the `takePhoto` action. Use it as a reference for adding and handling new actions.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/photoManifest.json](./src/photoManifest.json)
- `./agent/handlers` → `./dist/photoActionHandler.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)

External: _None at runtime._

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/photoActionHandler.ts`, `./src/photoManifest.json`, `./src/photoSchema.agr`, …and 3 more under `./src/`.

### Agent surface

- Manifest: [./src/photoManifest.json](./src/photoManifest.json)
- Schema: [./src/photoSchema.ts](./src/photoSchema.ts)
- Grammar: [./src/photoSchema.agr](./src/photoSchema.agr)
- Handler: [./src/photoActionHandler.ts](./src/photoActionHandler.ts)

### Actions

_1 action implemented by this agent, parsed deterministically from `./src/photoSchema.ts`. Sample utterances and parameter shapes are illustrative; consult the schema for the full signature._

| User says                                              | Action                                     |
| ------------------------------------------------------ | ------------------------------------------ |
| _uses a camera attached to the system to take a photo_ | `takePhoto` → `{ "originalRequest": "…" }` |

---

_Auto-generated against commit `366aaf867a7e8e5d130b6c87a365516bab725269` on `2026-07-07T09:05:05.703Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter photo-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=3f7fa38b1e4c05ce768162f95d58d00fd38c0fb8987750f6cdf2019efd01db19 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# photo-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `photo-agent` package is a TypeAgent application agent that facilitates photo-related actions. It enables the system to interact with a connected camera, allowing users to take photos through natural language commands.

## What it does

The `photo-agent` implements the `takePhoto` action, which uses a camera attached to the system to capture a photo. This action is triggered by user requests such as "Take a photo of this sunset" or "Snap a picture of my outfit." The agent processes these requests using a defined grammar and maps them to the `takePhoto` action.

The `takePhoto` action accepts a single parameter, `originalRequest`, which captures the user's input. This parameter can be used for logging or further processing. The grammar for interpreting user requests is defined in [photoSchema.agr](./src/photoSchema.agr), which supports a variety of natural language patterns.

## Setup

To use the `photo-agent`, ensure the following prerequisites are met:

1. **Camera Access**: A camera must be connected to the system and properly configured. This may involve installing necessary drivers or granting permissions for camera access.
2. **Environment Configuration**: No specific environment variables are required for this package. However, the system must support camera functionality.

For further details, refer to the hand-written README.

## Key Files

The `photo-agent` package is structured around several key files that define its behavior and functionality:

- **[photoManifest.json](./src/photoManifest.json)**: Contains metadata about the agent, including its description, emoji representation, and schema details.
- **[photoSchema.ts](./src/photoSchema.ts)**: Defines the TypeScript types for the actions supported by the agent. Currently, it includes the `PhotoAction` and `TakePhotoAction` types.
- **[photoActionHandler.ts](./src/photoActionHandler.ts)**: Implements the logic for handling the `takePhoto` action. This file includes functions for initializing the agent context, updating it, and executing actions.
- **[photoSchema.agr](./src/photoSchema.agr)**: Specifies the grammar rules for parsing user requests into actionable commands. It defines patterns for recognizing requests to take photos.
- **[photoSchema.tests.json](./src/photoSchema.tests.json)**: Provides test cases to validate the grammar and action handling. These tests ensure that user requests are correctly interpreted and mapped to the `takePhoto` action.

## How to extend

To add new functionality to the `photo-agent`, follow these steps:

1. **Define New Actions**: Add new action types to [photoSchema.ts](./src/photoSchema.ts). Each action should have a unique `actionName` and a set of parameters.
2. **Update Grammar**: Modify [photoSchema.agr](./src/photoSchema.agr) to include grammar rules for the new actions. Define patterns that map user requests to the new actions.
3. **Implement Action Handlers**: Extend the logic in [photoActionHandler.ts](./src/photoActionHandler.ts) to handle the new actions. Update the `executeAction` function to process the new action types.
4. **Add Test Cases**: Create new test cases in [photoSchema.tests.json](./src/photoSchema.tests.json) to validate the parsing and handling of the new actions.
5. **Test Your Changes**: Run the existing test suite and add new tests to ensure the agent behaves as expected with the new functionality.

To begin, review the existing implementation of the `takePhoto` action in [photoActionHandler.ts](./src/photoActionHandler.ts). Use it as a reference for adding and handling new actions.

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

`./src/photoActionHandler.ts`, `./src/photoManifest.json`, `./src/photoSchema.agr`, …and 4 more under `./src/`.

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

_Auto-generated against commit `656444843518fd1f9bb1b157b6dbf6dcbcde3999` on `2026-07-09T09:05:44.186Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter photo-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=dd832066bc448df7af558e0ed2f771549b85f68e8bdafb13e7183152ef0cc3f4 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# photo-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `photo-agent` package is a TypeAgent application agent designed to handle photo-related actions. It primarily focuses on using a camera attached to the system to take photos based on user requests.

## What it does

The `photo-agent` package implements the `takePhoto` action, which allows the agent to take a photo using a camera attached to the system. This action is triggered by various user requests that are parsed and handled by the agent. The agent can interpret different ways users might ask to take a photo, such as "Take a photo of this sunset" or "Snap a picture of my outfit."

## Setup

To set up the `photo-agent`, ensure you have the necessary environment configured to support camera functionality. This may include installing drivers for the camera and ensuring the camera is accessible by the system.

For detailed setup instructions, see the hand-written README.

## Key Files

The `photo-agent` package is structured around several key files:

- **[photoManifest.json](./src/photoManifest.json)**: Defines the agent's manifest, including its description and schema.
- **[photoSchema.ts](./src/photoSchema.ts)**: Contains the TypeScript definitions for the `PhotoAction` and `TakePhotoAction`.
- **[photoActionHandler.ts](./src/photoActionHandler.ts)**: Implements the logic for handling the `takePhoto` action, including initializing the agent context and executing the action.
- **[photoSchema.agr](./src/photoSchema.agr)**: Defines the grammar rules for parsing user requests related to photo actions.

The agent's main entry point is the `instantiate` function in [photoActionHandler.ts](./src/photoActionHandler.ts), which sets up the agent's context and action handling.

## How to extend

To extend the `photo-agent` package, follow these steps:

1. **Add new actions**: Define new actions in [photoSchema.ts](./src/photoSchema.ts) by creating new TypeScript types for the actions.
2. **Update grammar**: Modify [photoSchema.agr](./src/photoSchema.agr) to include grammar rules for the new actions.
3. **Implement handlers**: Add logic for handling the new actions in [photoActionHandler.ts](./src/photoActionHandler.ts). Ensure the `executeAction` function can process the new actions.
4. **Test**: Add test cases for the new actions in [photoSchema.tests.json](./src/photoSchema.tests.json) to ensure they are correctly parsed and handled.

Start by opening [photoActionHandler.ts](./src/photoActionHandler.ts) and following the existing patterns for action handling. Run tests to verify your changes and ensure the new functionality works as expected.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/photoManifest.json](./src/photoManifest.json)
- `./agent/handlers` → [./dist/photoActionHandler.js](./dist/photoActionHandler.js)

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

_Auto-generated against commit `127a36a95a15e918be533d6eaaf08adebe9070d9` on `2026-06-26T03:01:52.873Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter photo-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

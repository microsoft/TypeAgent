<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=3f7fa38b1e4c05ce768162f95d58d00fd38c0fb8987750f6cdf2019efd01db19 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# photo-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `photo-agent` package is a TypeAgent application agent that enables the system to interact with a connected camera. It provides functionality to capture photos based on user commands, making it a key component for applications requiring image capture capabilities. This agent is part of the TypeAgent framework and integrates with other agents in the monorepo to deliver camera-related features.

## What it does

The `photo-agent` is designed to handle photo-related actions, with its primary functionality being the `takePhoto` action. This action allows the system to use a connected camera to capture a photo based on user input. The agent processes natural language commands, such as "Take a picture of my desk" or "Snap a photo of the sunset," and maps them to the `takePhoto` action.

### Key Features:

- **`takePhoto` Action**: This action captures a photo using the system's camera. It takes a single parameter, `originalRequest`, which contains the user's original input. This parameter can be used for logging or further processing.
- **Grammar Parsing**: The agent uses a grammar file ([photoSchema.agr](./src/photoSchema.agr)) to interpret user requests and map them to the `takePhoto` action.
- **Integration**: The agent is built to work within the TypeAgent framework, allowing it to interact with other agents and components in the system.

The `photo-agent` is a foundational component for any application that requires photo capture functionality, such as documentation, social media sharing, or visual data collection.

## Setup

To use the `photo-agent`, follow these steps:

1. **Ensure Camera Access**: Verify that a camera is connected to the system and is accessible. This may involve installing necessary drivers or granting permissions.
2. **Install Dependencies**: Run `pnpm install` in the root of the monorepo to install all required dependencies, including `@typeagent/action-schema-compiler` and `@typeagent/agent-sdk`.
3. **Build the Package**: The build process is managed by the monorepo's tooling. Ensure the package is built successfully before use.

No additional environment variables or external services are required for this package.

## Key Files

The `photo-agent` package is organized according to the conventions of the TypeAgent framework. Below are the key files and their responsibilities:

- **[photoManifest.json](./src/photoManifest.json)**: This file defines the agent's metadata, including its description, emoji representation, and schema details. It serves as the entry point for the agent's manifest.
- **[photoSchema.ts](./src/photoSchema.ts)**: Contains TypeScript definitions for the actions supported by the agent. Currently, it defines the `PhotoAction` and `TakePhotoAction` types.
- **[photoActionHandler.ts](./src/photoActionHandler.ts)**: Implements the logic for handling the `takePhoto` action. This includes initializing the agent context, updating it, and executing the action.
- **[photoSchema.agr](./src/photoSchema.agr)**: Specifies the grammar rules for parsing user requests into actionable commands. It defines patterns for recognizing requests to take photos and mapping them to the `takePhoto` action.
- **[photoSchema.tests.json](./src/photoSchema.tests.json)**: Provides test cases for validating the grammar and action handling. These tests ensure that user requests are correctly interpreted and processed.

## How to extend

The `photo-agent` is designed to be extensible, allowing contributors to add new actions, grammar rules, and functionality. Here’s how you can extend the agent:

1. **Define New Actions**:

   - Add new action types to [photoSchema.ts](./src/photoSchema.ts). Each action should have a unique `actionName` and a set of parameters.
   - For example, to add an action for uploading a photo, define a new `UploadPhotoAction` type with parameters like `filePath` and `description`.

2. **Update the Grammar**:

   - Modify [photoSchema.agr](./src/photoSchema.agr) to include grammar rules for the new actions.
   - Add patterns that map user requests to the new actions. For instance, you could define rules to recognize phrases like "Upload this photo" or "Share this picture."

3. **Implement Action Handlers**:

   - Extend the logic in [photoActionHandler.ts](./src/photoActionHandler.ts) to handle the new actions.
   - Update the `executeAction` function to process the new action types. Use the existing `takePhoto` implementation as a reference.

4. **Add Test Cases**:

   - Create new test cases in [photoSchema.tests.json](./src/photoSchema.tests.json) to validate the parsing and handling of the new actions.
   - Ensure the test cases cover a variety of user requests and edge cases.

5. **Test Your Changes**:
   - Run the existing test suite to ensure that your changes do not introduce regressions.
   - Add new tests to cover the functionality of the new actions and grammar rules.

By following these steps, you can expand the capabilities of the `photo-agent` to handle additional photo-related tasks. Start by reviewing the existing implementation in [photoActionHandler.ts](./src/photoActionHandler.ts) to understand the current structure and patterns.

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

_Auto-generated against commit `44b34a9ac8794b6f90489ff7e55fe57283c34960` on `2026-07-11T08:34:41.338Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter photo-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

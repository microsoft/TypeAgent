<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=20f062de09bf9195e93b684a7fb60dbf4f058cc9c4f750a4a04bf62cb6943d96 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# video-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `video-agent` package is a TypeAgent application agent designed to handle video generation requests. It leverages the Sora-2 model on Azure OpenAI to create videos based on user descriptions and parameters.

## What it does

The `video-agent` package implements one primary action: `createVideoAction`. This action allows users to generate videos by providing a description, caption, optional related files, and duration. The agent processes these inputs and interacts with the video generation API to produce the requested video.

### Actions

- `createVideoAction`: Creates a video based on the supplied description, caption, related files, and duration.

## Setup

To use the `video-agent`, you need to configure your environment with the necessary API keys and endpoints. Specifically, you need to set the following environment variables in the root `.env` file:

- `AZURE_OPENAI_ENDPOINT_SORA_2`: The endpoint for the Sora-2 model on Azure OpenAI.
- `AZURE_OPENAI_API_KEY_SORA_2`: The API key for accessing the Sora-2 model.

For identity-based authentication, specify the key as `identity`.

See the hand-written README for the full walk-through on setting up these environment variables.

## Key Files
The `video-agent` package is structured around the TypeAgent framework, with key components including the manifest, schema, grammar, and handler.

### Key Files

- [videoManifest.json](./src/videoManifest.json): Defines the agent's metadata, including its description and schema.
- [videoActionSchema.ts](./src/videoActionSchema.ts): Specifies the structure of the `createVideoAction` and its parameters.
- [videoSchema.agr](./src/videoSchema.agr): Contains the grammar rules for parsing user requests into actions.
- [videoActionHandler.ts](./src/videoActionHandler.ts): Implements the logic for executing the `createVideoAction`.

### Workflow

1. **Manifest**: The agent's capabilities and schema are defined in the manifest file.
2. **Schema**: The schema file outlines the parameters and structure of the actions the agent can perform.
3. **Grammar**: The grammar file translates user requests into actionable commands based on predefined patterns.
4. **Handler**: The handler file contains the implementation of the action, interacting with the video generation API to fulfill the request.

## How to extend

To extend the `video-agent` package, follow these steps:

1. **Add a new action**: Define the new action in the [videoActionSchema.ts](./src/videoActionSchema.ts) file, specifying its name and parameters.
2. **Update the grammar**: Modify the [videoSchema.agr](./src/videoSchema.agr) file to include patterns for the new action.
3. **Implement the handler**: Add the logic for the new action in the [videoActionHandler.ts](./src/videoActionHandler.ts) file, ensuring it interacts correctly with the video generation API.
4. **Test the new action**: Create test cases in the [videoSchema.tests.json](./src/videoSchema.tests.json) file to validate the new action's functionality.

By following these steps, you can extend the capabilities of the `video-agent` to handle additional video generation scenarios.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/videoManifest.json](./src/videoManifest.json)
- `./agent/handlers` → [./dist/videoActionHandler.js](./dist/videoActionHandler.js)

### Dependencies

Workspace:

- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [aiclient](../../../packages/aiclient/README.md)
- [telemetry](../../../packages/telemetry/README.md)
- [typechat-utils](../../../packages/utils/typechatUtils/README.md)

External: _None at runtime._

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/videoActionHandler.ts`, `./src/videoActionSchema.ts`, `./src/videoManifest.json`, …and 3 more under `./src/`.

### Agent surface

- Manifest: [./src/videoManifest.json](./src/videoManifest.json)
- Schema: [./src/videoActionSchema.ts](./src/videoActionSchema.ts)
- Grammar: [./src/videoSchema.agr](./src/videoSchema.agr)
- Handler: [./src/videoActionHandler.ts](./src/videoActionHandler.ts)

### Actions

_1 action implemented by this agent, parsed deterministically from `./src/videoActionSchema.ts`. Sample utterances and parameter shapes are illustrative; consult the schema for the full signature._

| User says | Action |
| --- | --- |
| _creates a video based on the supplied description_ | `createVideoAction` → `{ "originalRequest": "…", "caption": "…" }` |

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T10:06:08.903Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter video-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

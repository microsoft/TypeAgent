<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=03d2acfcaddd14ce570e0691f2287a20027fdc3ba4fc21499194debe925da1c2 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# image-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `image-agent` package is an image dispatcher agent designed to create and edit images based on user requests. It leverages Azure OpenAI's gpt-image-1 endpoints to generate and transform images, displaying the results to the user. This package is part of the TypeAgent monorepo and is located in the `ts/packages/agents/image/` directory.

## What it does

The `image-agent` package implements two primary actions: `createImageAction` and `editImageAction`.

- `createImageAction`: This action allows users to generate images based on a supplied description, caption, and the number of images requested. The agent processes these requests and interacts with the Azure OpenAI API to create the images. The generated images are then displayed to the user.
- `editImageAction`: This action enables users to edit or transform an existing image based on a supplied edit prompt. Typical use cases include requests like "cartoonize that image", "make a watercolor version of this photo", or "stylize this as a pencil sketch". The agent processes these requests and interacts with the Azure OpenAI API to apply the specified transformations to the image.

## Setup

To use the `image-agent`, you need to configure API keys and endpoints in the root `config.local.yaml` file or the legacy `.env` file. The required environment variables are:

- `BING_API_KEY`: Bing API key for deprecated Bing Image Search.
- `AZURE_OPENAI_API_KEY_IMAGE`: API key for Azure OpenAI image generation.
- `AZURE_OPENAI_ENDPOINT_IMAGE`: Endpoint for Azure OpenAI image generation.

Ensure these variables are set correctly in your configuration files. For detailed setup instructions, see the hand-written README.

## Key Files

The `image-agent` package is structured into several key files:

- [imageManifest.json](./src/imageManifest.json): Defines the agent's manifest, including its description and schema.
- [imageActionSchema.ts](./src/imageActionSchema.ts): Specifies the schema for the `createImageAction` and `editImageAction`.
- [imageActionHandler.ts](./src/imageActionHandler.ts): Contains the handler logic for executing the `createImageAction` and `editImageAction`.
- [imageSchema.agr](./src/imageSchema.agr): Defines the grammar rules for parsing user requests into actions.
- [imageSchema.tests.json](./src/imageSchema.tests.json): Provides test cases for validating the grammar and action handling.

The agent's main functionality is encapsulated in the [imageActionHandler.ts](./src/imageActionHandler.ts) file, where the `executePhotoAction` function processes the `createImageAction` and `editImageAction`, interacting with the Azure OpenAI API to generate and transform images.

## How to extend

To extend the `image-agent` package, follow these steps:

1. **Add new actions**: Define new actions in the [imageActionSchema.ts](./src/imageActionSchema.ts) file. Ensure each action has a unique name and appropriate parameters.
2. **Update grammar**: Modify the [imageSchema.agr](./src/imageSchema.agr) file to include grammar rules for the new actions. This ensures user requests are correctly parsed into actions.
3. **Implement handlers**: Add handler logic for the new actions in the [imageActionHandler.ts](./src/imageActionHandler.ts) file. Implement the necessary API calls and processing steps.
4. **Test**: Add test cases to the [imageSchema.tests.json](./src/imageSchema.tests.json) file to validate the new actions and grammar rules.

Start by opening the [imageActionHandler.ts](./src/imageActionHandler.ts) file and following the existing patterns for action handling. Run tests to ensure your changes work as expected.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/imageManifest.json](./src/imageManifest.json)
- `./agent/handlers` → [./dist/imageActionHandler.js](./dist/imageActionHandler.js)

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

`./src/imageActionHandler.ts`, `./src/imageActionSchema.ts`, `./src/imageManifest.json`, …and 3 more under `./src/`.

### Agent surface

- Manifest: [./src/imageManifest.json](./src/imageManifest.json)
- Schema: [./src/imageActionSchema.ts](./src/imageActionSchema.ts)
- Grammar: [./src/imageSchema.agr](./src/imageSchema.agr)
- Handler: [./src/imageActionHandler.ts](./src/imageActionHandler.ts)

### Actions

_2 actions implemented by this agent, parsed deterministically from `./src/imageActionSchema.ts`. Sample utterances and parameter shapes are illustrative; consult the schema for the full signature._

| User says | Action |
| --- | --- |
| _creates an image based on the supplied description_ | `createImageAction` → `{ "originalRequest": "…", "caption": "…", "numImages": 0 }` |
| _Edits / transforms an image the user has already supplied (typically the most recent attachment)_ | `editImageAction` → `{ "originalRequest": "…", "editPrompt": "…", "sourceImage": "…" }` |

---

_Auto-generated against commit `bc2dc7df084977bc3da24a9398fd3a08d55c3e7e` on `2026-05-29T04:54:39.509Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter image-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=b5d47436613dd5f140de66f45ae18ccf867d7ca33e282a25d34ac7c6e790be89 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# image-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `image-agent` package is an image dispatcher agent designed to handle user requests for creating and editing images. It integrates with Azure OpenAI's `gpt-image-1` endpoints to generate and transform images based on user-provided descriptions and prompts. This package is part of the TypeAgent monorepo and is located in the `ts/packages/agents/image/` directory.

## What it does

The `image-agent` provides two key actions for image processing:

- **`createImageAction`**: This action generates new images based on a user-provided description, caption, and the desired number of images. It interacts with the Azure OpenAI API to create the requested images and returns them to the user. For example, a user might request "Create 3 images of a sunset over mountains with the caption 'Nature's Beauty'".

- **`editImageAction`**: This action allows users to modify or transform an existing image. The user provides an edit prompt (e.g., "make this a watercolor painting") and the source image to be edited. The agent processes the request and applies the specified transformation using the Azure OpenAI API. This action is ideal for tasks like stylizing images or applying artistic effects.

These actions are designed to handle a variety of use cases, from generating new images to applying creative transformations to existing ones.

## Setup

To use the `image-agent`, you need to configure the following environment variables in either the root `config.local.yaml` file or the legacy `.env` file:

- **`BING_API_KEY`**: Required for using the deprecated Bing Image Search functionality. This feature is being retired in August 2025.
- **`AZURE_OPENAI_API_KEY_IMAGE`**: The API key for accessing Azure OpenAI's image generation services.
- **`AZURE_OPENAI_ENDPOINT_IMAGE`**: The endpoint URL for Azure OpenAI's image generation services.

For identity-based authentication to your Azure OpenAI endpoint, you can specify the key as `identity`. Refer to the hand-written README for additional details on obtaining and configuring these keys.

## Key Files

The `image-agent` package is organized into several key files that define its functionality:

- **[src/imageManifest.json](./src/imageManifest.json)**: This file contains the agent's manifest, including metadata such as the description, emoji representation, and schema details.
- **[src/imageActionSchema.ts](./src/imageActionSchema.ts)**: Defines the schema for the two implemented actions, `createImageAction` and `editImageAction`. This file specifies the structure and parameters required for each action.
- **[src/imageActionHandler.ts](./src/imageActionHandler.ts)**: Implements the logic for handling the defined actions. This is where the agent processes user requests and interacts with the Azure OpenAI API to generate or edit images.
- **[src/imageSchema.agr](./src/imageSchema.agr)**: Contains the grammar rules for parsing user requests into actionable commands. This ensures that natural language inputs are correctly interpreted.
- **[src/imageSchema.tests.json](./src/imageSchema.tests.json)**: Provides test cases to validate the grammar and action handling. These tests ensure that user requests are correctly mapped to the appropriate actions.

The core functionality of the agent resides in the [imageActionHandler.ts](./src/imageActionHandler.ts) file, which processes the `createImageAction` and `editImageAction` requests.

## How to extend

To add new capabilities to the `image-agent`, follow these steps:

1. **Define new actions**: Extend the [imageActionSchema.ts](./src/imageActionSchema.ts) file with new action types and their associated parameters. Ensure each action has a unique name and a clear purpose.

2. **Update the grammar**: Modify the [imageSchema.agr](./src/imageSchema.agr) file to include grammar rules for the new actions. This ensures that user inputs can be correctly parsed into the new actions.

3. **Implement action handlers**: Add the logic for the new actions in the [imageActionHandler.ts](./src/imageActionHandler.ts) file. This may involve integrating with external APIs or implementing custom processing logic.

4. **Add test cases**: Update the [imageSchema.tests.json](./src/imageSchema.tests.json) file with test cases for the new actions. This helps ensure that the new functionality works as expected and that user inputs are correctly interpreted.

5. **Test your changes**: Run the existing test suite and add new tests as needed to verify the functionality of your additions. Ensure that all tests pass before submitting your changes.

By following these steps and adhering to the existing patterns in the codebase, you can extend the `image-agent` to support additional image-related actions or integrate with new APIs.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/imageManifest.json](./src/imageManifest.json)
- `./agent/handlers` → `./dist/imageActionHandler.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [@typeagent/aiclient](../../../packages/aiclient/README.md)
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

| User says                                                                                          | Action                                                                                  |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| _creates an image based on the supplied description_                                               | `createImageAction` → `{ "originalRequest": "…", "caption": "…", "numImages": 0 }`      |
| _Edits / transforms an image the user has already supplied (typically the most recent attachment)_ | `editImageAction` → `{ "originalRequest": "…", "editPrompt": "…", "sourceImage": "…" }` |

---

_Auto-generated against commit `366aaf867a7e8e5d130b6c87a365516bab725269` on `2026-07-07T09:05:05.703Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter image-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=4c1690cda0687417cc614c9e95e05959065c3b597a1bb6d4407e957d28cfeacb -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# image-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `image-agent` package is an image dispatcher agent that processes user requests for creating and editing images. It leverages Azure OpenAI's `gpt-image-1` endpoints to generate and transform images based on user-provided descriptions and prompts. This package is part of the TypeAgent monorepo and is located in the `ts/packages/agents/image/` directory.

## What it does

The `image-agent` provides two primary actions for image-related tasks:

- **`createImageAction`**: This action generates new images based on a user-provided description, caption, and the desired number of images. It uses the Azure OpenAI API to create the requested images and returns them to the user. For example, a user might request, "Create 3 images of a sunset over mountains with the caption 'Nature's Beauty'".

- **`editImageAction`**: This action allows users to modify or transform an existing image. The user provides an edit prompt (e.g., "make this a watercolor painting") and the source image to be edited. The agent processes the request and applies the specified transformation using the Azure OpenAI API. This action is suitable for tasks like stylizing images or applying artistic effects.

These actions enable the `image-agent` to handle a variety of use cases, from generating new images to creatively transforming existing ones.

## Setup

To use the `image-agent`, you need to configure the following environment variables. These can be set in the root `config.local.yaml` file or the legacy `.env` file:

- **`BING_API_KEY`**: Required for using the deprecated Bing Image Search functionality. Note that this feature will be retired in August 2025.
- **`AZURE_OPENAI_API_KEY_IMAGE`**: The API key for accessing Azure OpenAI's image generation services.
- **`AZURE_OPENAI_ENDPOINT_IMAGE`**: The endpoint URL for Azure OpenAI's image generation services.

For identity-based authentication to your Azure OpenAI endpoint, specify the key as `identity`. Refer to the hand-written README for additional details on obtaining and configuring these keys.

## Key Files

The `image-agent` package is structured around several key files that define its functionality:

- **[src/imageManifest.json](./src/imageManifest.json)**: This file serves as the agent's manifest, containing metadata such as the description, emoji representation, and schema details.

- **[src/imageActionSchema.ts](./src/imageActionSchema.ts)**: This file defines the schema for the two implemented actions, `createImageAction` and `editImageAction`. It specifies the structure and parameters required for each action, such as `originalRequest`, `caption`, `numImages`, and `editPrompt`.

- **[src/imageActionHandler.ts](./src/imageActionHandler.ts)**: This file implements the logic for handling the defined actions. It processes user requests and interacts with the Azure OpenAI API to generate or edit images. The `executePhotoAction` function is the main entry point for executing actions.

- **[src/imageSchema.agr](./src/imageSchema.agr)**: This file contains the grammar rules for parsing user requests into actionable commands. It ensures that natural language inputs are correctly interpreted and mapped to the appropriate actions.

- **[src/imageSchema.tests.json](./src/imageSchema.tests.json)**: This file provides test cases to validate the grammar and action handling. These tests ensure that user requests are correctly mapped to the appropriate actions and that the agent behaves as expected.

The core functionality of the agent is implemented in the [imageActionHandler.ts](./src/imageActionHandler.ts) file, which processes the `createImageAction` and `editImageAction` requests.

## How to extend

To extend the `image-agent` with new capabilities, follow these steps:

1. **Define new actions**: Add new action types and their associated parameters to the [imageActionSchema.ts](./src/imageActionSchema.ts) file. Ensure each action has a unique name and a clear purpose.

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

`./src/imageActionHandler.ts`, `./src/imageActionSchema.ts`, `./src/imageManifest.json`, …and 4 more under `./src/`.

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

_Auto-generated against commit `463e6bf5c6f8eeaf9cc7512e33f3976761eece62` on `2026-07-10T09:05:05.791Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter image-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

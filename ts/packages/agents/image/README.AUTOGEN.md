<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=4c1690cda0687417cc614c9e95e05959065c3b597a1bb6d4407e957d28cfeacb -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# image-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `image-agent` is an application agent within the TypeAgent monorepo designed to handle image-related tasks. It provides functionality for creating and editing images based on user input, leveraging Azure OpenAI's `gpt-image-1` endpoints. This agent is located in the `ts/packages/agents/image/` directory and is a sample implementation showcasing how to integrate with external APIs for image generation and transformation.

## What it does

The `image-agent` supports two primary actions:

- **`createImageAction`**: This action generates new images based on user-provided input. Users can specify a description of the desired image, a caption, and the number of images to generate. For example, a user might request, "Create 3 images of a sunset over mountains with the caption 'Nature's Beauty'." The agent processes the request and returns the generated images.

- **`editImageAction`**: This action allows users to modify or transform an existing image. Users provide an edit prompt (e.g., "make this a watercolor painting") and the source image to be edited. The agent applies the specified transformation to the image and returns the result. This action is ideal for tasks such as stylizing images, applying artistic effects, or making specific edits to existing visuals.

These actions enable the `image-agent` to cater to a variety of use cases, from creating new visual content to enhancing or transforming existing images.

## Setup

To configure and use the `image-agent`, you need to set up the following environment variables. These can be defined in the root `config.local.yaml` file or the legacy `.env` file:

- **`BING_API_KEY`**: This key is required for using the deprecated Bing Image Search functionality. Note that this feature will be retired in August 2025.
- **`AZURE_OPENAI_API_KEY_IMAGE`**: The API key for accessing Azure OpenAI's `gpt-image-1` endpoints for image generation and editing.
- **`AZURE_OPENAI_ENDPOINT_IMAGE`**: The endpoint URL for Azure OpenAI's image generation services.

For identity-based authentication to your Azure OpenAI endpoint, specify the key as `identity`. Additional details on obtaining and configuring these keys can be found in the hand-written README.

## Key Files

The `image-agent` is implemented using a modular structure, with key files responsible for different aspects of its functionality:

- **[src/imageManifest.json](./src/imageManifest.json)**: This manifest file contains metadata about the agent, including its description, emoji representation, and schema details. It serves as the entry point for the agent's configuration.

- **[src/imageActionSchema.ts](./src/imageActionSchema.ts)**: This file defines the schema for the agent's actions. It specifies the structure and parameters for `createImageAction` and `editImageAction`. For example, `createImageAction` requires parameters such as `originalRequest`, `caption`, and `numImages`.

- **[src/imageActionHandler.ts](./src/imageActionHandler.ts)**: This file contains the implementation of the agent's actions. The `executePhotoAction` function is the main entry point for processing user requests. It interacts with the Azure OpenAI API to generate or edit images based on the action type and parameters.

- **[src/imageSchema.agr](./src/imageSchema.agr)**: This file defines the grammar rules for parsing user inputs into actionable commands. It ensures that natural language requests are correctly interpreted and mapped to the appropriate actions.

- **[src/imageSchema.tests.json](./src/imageSchema.tests.json)**: This file includes test cases for validating the grammar and action handling. These tests ensure that user inputs are correctly parsed and that the agent performs as expected.

- **[src/tsconfig.json](./src/tsconfig.json)**: The TypeScript configuration file for the `image-agent` package, specifying compiler options and project structure.

## How to extend

To add new features or actions to the `image-agent`, follow these steps:

1. **Define new actions**: Extend the [imageActionSchema.ts](./src/imageActionSchema.ts) file with new action types and their required parameters. Ensure each action has a unique name and a clear purpose.

2. **Update the grammar**: Modify the [imageSchema.agr](./src/imageSchema.agr) file to include grammar rules for the new actions. This ensures that user inputs can be correctly parsed into the new actions.

3. **Implement action handlers**: Add the logic for the new actions in the [imageActionHandler.ts](./src/imageActionHandler.ts) file. This may involve integrating with additional APIs or implementing custom processing logic.

4. **Add test cases**: Update the [imageSchema.tests.json](./src/imageSchema.tests.json) file with test cases for the new actions. This helps validate the new functionality and ensures that user inputs are correctly interpreted.

5. **Test your changes**: Run the existing test suite and add new tests as needed to verify the functionality of your additions. Ensure that all tests pass before submitting your changes.

By following these steps and adhering to the existing patterns in the codebase, you can effectively extend the `image-agent` to support additional image-related actions or integrate with new APIs.

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

_Auto-generated against commit `44b34a9ac8794b6f90489ff7e55fe57283c34960` on `2026-07-13T09:04:14.089Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter image-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

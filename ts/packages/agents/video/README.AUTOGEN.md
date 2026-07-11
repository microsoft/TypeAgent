<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=7dbac9747d5a7ad85045dc9c5df2a829735975ad01b4272c3298e8ba1ba6e440 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# video-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `video-agent` package is a TypeAgent application agent designed to handle video generation tasks. It integrates with the Sora-2 model on Azure OpenAI to create videos based on user-provided descriptions, captions, and optional parameters such as duration and related files. This package serves as a sample implementation for incorporating video generation APIs into a TypeAgent-based system.

## What it does

The `video-agent` processes user requests to generate videos by interpreting natural language inputs and mapping them to structured actions. It currently supports one action:

- **`createVideoAction`**: This action generates a video based on the following parameters:
  - `originalRequest` (required): The user's original request as a string.
  - `caption` (required): A caption to be included in the video.
  - `relatedFiles` (optional): A list of file names for any attachments provided by the user, such as images or video clips.
  - `duration` (optional): The desired duration of the video, which can be `"4"`, `"8"`, or `"12"` seconds.

The agent uses the Sora-2 model on Azure OpenAI to fulfill these requests. It processes the input parameters, interacts with the video generation API, and produces a video file that matches the user's specifications. The agent is designed to handle a variety of user inputs, including requests for promotional videos, slideshows, or compilations, and can incorporate user-provided media files and captions.

## Setup

To use the `video-agent`, you need to configure your environment with the necessary Azure OpenAI credentials and endpoints. Follow these steps:

1. **Obtain Azure OpenAI credentials**:

   - Access your Azure OpenAI account and retrieve the endpoint URL and API key for the Sora-2 model.

2. **Set up environment variables**:

   - Add the following variables to the root `.env` file or the `config.local.yaml` file:
     - `AZURE_OPENAI_ENDPOINT_SORA_2`: The endpoint URL for the Sora-2 model.
     - `AZURE_OPENAI_API_KEY_SORA_2`: The API key for accessing the Sora-2 model.
   - If you are using identity-based authentication, set `AZURE_OPENAI_API_KEY_SORA_2` to `identity`.

3. **Install dependencies**:
   - Run `pnpm install` in the root of the monorepo to install all required dependencies.

For more detailed instructions, refer to the hand-written README.

## Key Files

The `video-agent` package is organized into several key files, each serving a specific purpose in the agent's functionality:

- **[videoManifest.json](./src/videoManifest.json)**: This file defines the agent's metadata, including its description, schema, and capabilities. It serves as the entry point for the agent.
- **[videoActionSchema.ts](./src/videoActionSchema.ts)**: This file specifies the structure and parameters of the `createVideoAction`. It defines the action's name, required and optional parameters, and their types.
- **[videoSchema.agr](./src/videoSchema.agr)**: This file contains the grammar rules that map user requests to structured actions. It defines how natural language inputs are interpreted by the agent.
- **[videoActionHandler.ts](./src/videoActionHandler.ts)**: This file implements the logic for executing the `createVideoAction`. It handles the interaction with the Sora-2 video generation API and processes the input parameters to generate the requested video.
- **[videoSchema.tests.json](./src/videoSchema.tests.json)**: This file contains test cases for validating the agent's ability to parse user requests and execute actions correctly. It ensures the agent behaves as expected for a variety of input scenarios.

### File Responsibilities

1. **Manifest**: The [videoManifest.json](./src/videoManifest.json) file provides metadata about the agent, including its description and the schema it uses.
2. **Schema**: The [videoActionSchema.ts](./src/videoActionSchema.ts) file defines the `createVideoAction` and its parameters, such as `originalRequest`, `caption`, `relatedFiles`, and `duration`.
3. **Grammar**: The [videoSchema.agr](./src/videoSchema.agr) file specifies the natural language patterns that the agent can interpret, enabling it to understand user requests and map them to the `createVideoAction`.
4. **Handler**: The [videoActionHandler.ts](./src/videoActionHandler.ts) file contains the implementation of the `createVideoAction`, including API calls to the Sora-2 model and the logic for processing video generation requests.
5. **Tests**: The [videoSchema.tests.json](./src/videoSchema.tests.json) file includes test cases to validate the agent's functionality, ensuring it can correctly interpret user inputs and execute the desired actions.

## How to extend

The `video-agent` can be extended to support additional video generation capabilities or other related functionalities. Here’s how you can extend the agent:

1. **Add a new action**:

   - Define a new action type in the [videoActionSchema.ts](./src/videoActionSchema.ts) file. Specify the action name and the parameters it will accept.

2. **Update the grammar**:

   - Modify the [videoSchema.agr](./src/videoSchema.agr) file to include new grammar rules that map user requests to the new action. Ensure the grammar covers various ways users might phrase their requests.

3. **Implement the action handler**:

   - Add the logic for the new action in the [videoActionHandler.ts](./src/videoActionHandler.ts) file. This may involve interacting with external APIs or services to fulfill the action.

4. **Update the manifest**:

   - Update the [videoManifest.json](./src/videoManifest.json) file to include the new action in the agent's schema.

5. **Add test cases**:

   - Extend the [videoSchema.tests.json](./src/videoSchema.tests.json) file with test cases for the new action. Ensure the tests cover a variety of user inputs and edge cases.

6. **Run tests**:
   - Use the monorepo's testing framework to run the tests and verify that the new action works as expected.

By following these steps, you can enhance the `video-agent` to meet additional requirements or support new use cases.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/videoManifest.json](./src/videoManifest.json)
- `./agent/handlers` → `./dist/videoActionHandler.js` _(not found on disk)_

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

`./src/videoActionHandler.ts`, `./src/videoActionSchema.ts`, `./src/videoManifest.json`, …and 4 more under `./src/`.

### Agent surface

- Manifest: [./src/videoManifest.json](./src/videoManifest.json)
- Schema: [./src/videoActionSchema.ts](./src/videoActionSchema.ts)
- Grammar: [./src/videoSchema.agr](./src/videoSchema.agr)
- Handler: [./src/videoActionHandler.ts](./src/videoActionHandler.ts)

### Actions

_1 action implemented by this agent, parsed deterministically from `./src/videoActionSchema.ts`. Sample utterances and parameter shapes are illustrative; consult the schema for the full signature._

| User says                                           | Action                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| _creates a video based on the supplied description_ | `createVideoAction` → `{ "originalRequest": "…", "caption": "…" }` |

---

_Auto-generated against commit `44b34a9ac8794b6f90489ff7e55fe57283c34960` on `2026-07-11T08:34:41.338Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter video-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

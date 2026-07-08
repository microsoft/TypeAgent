<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=5803d96f08c61da93f6192c07fedd3d715920ee1be8757c490634c8cb643b5c5 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# video-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `video-agent` package is a TypeAgent application agent designed to handle video generation tasks. It integrates with the Sora-2 model on Azure OpenAI to create videos based on user-provided descriptions, captions, and other parameters. This agent is a sample implementation that demonstrates how to interact with video generation APIs.

## What it does

The primary functionality of the `video-agent` is to process user requests for video creation and interact with the Sora-2 model on Azure OpenAI to generate videos. The agent currently supports one action:

- `createVideoAction`: This action generates a video based on the provided parameters, which include:
  - `originalRequest`: The user's original request as a string.
  - `caption`: A caption to be included in the video.
  - `relatedFiles` (optional): A list of file names for any attachments provided by the user, such as images or video clips.
  - `duration` (optional): The desired duration of the video, which can be one of the following values: `"4"`, `"8"`, or `"12"` seconds.

The agent processes these inputs, maps them to the appropriate schema, and uses the Sora-2 model to generate the requested video. The output is a video file that matches the user's specifications.

## Setup

To use the `video-agent`, you need to configure your environment with the necessary API keys and endpoints for Azure OpenAI. Follow these steps:

1. **Set up the Azure OpenAI endpoint and API key**:

   - Obtain the endpoint URL and API key for the Sora-2 model from your Azure OpenAI account.
   - Add the following environment variables to the root `.env` file or the `config.local.yaml` file:
     - `AZURE_OPENAI_ENDPOINT_SORA_2`: The endpoint URL for the Sora-2 model.
     - `AZURE_OPENAI_API_KEY_SORA_2`: The API key for accessing the Sora-2 model.
   - If you are using identity-based authentication, set `AZURE_OPENAI_API_KEY_SORA_2` to `identity`.

2. **Install dependencies**:
   - Run `pnpm install` in the root of the monorepo to install all required dependencies.

For more detailed setup instructions, refer to the hand-written README.

## Key Files

The `video-agent` package is organized around the core components of a TypeAgent application: the manifest, schema, grammar, and handler. Below is an overview of the key files and their responsibilities:

- [videoManifest.json](./src/videoManifest.json): Defines the agent's metadata, including its description, schema, and capabilities.
- [videoActionSchema.ts](./src/videoActionSchema.ts): Specifies the structure and parameters of the `createVideoAction`.
- [videoSchema.agr](./src/videoSchema.agr): Contains the grammar rules for parsing user requests into structured actions.
- [videoActionHandler.ts](./src/videoActionHandler.ts): Implements the logic for executing the `createVideoAction`. This file handles the interaction with the Sora-2 video generation API.
- [videoSchema.tests.json](./src/videoSchema.tests.json): Contains test cases for validating the agent's ability to parse user requests and execute actions correctly.

### File Responsibilities

1. **Manifest**: The [videoManifest.json](./src/videoManifest.json) file serves as the entry point for the agent, describing its purpose and linking to the schema and grammar files.
2. **Schema**: The [videoActionSchema.ts](./src/videoActionSchema.ts) file defines the structure of the `createVideoAction`, including its parameters and expected input types.
3. **Grammar**: The [videoSchema.agr](./src/videoSchema.agr) file defines the natural language patterns that the agent can interpret and map to the `createVideoAction`.
4. **Handler**: The [videoActionHandler.ts](./src/videoActionHandler.ts) file contains the implementation of the `createVideoAction`, including the logic for interacting with the Sora-2 model and handling the video generation process.

## How to extend

To extend the functionality of the `video-agent`, you can add new actions or modify existing ones. Here’s how:

1. **Define a new action**:

   - Add a new action type to the [videoActionSchema.ts](./src/videoActionSchema.ts) file. Specify the action name and the parameters it will accept.

2. **Update the grammar**:

   - Modify the [videoSchema.agr](./src/videoSchema.agr) file to include new grammar rules that map user requests to the new action. Ensure the grammar is comprehensive enough to handle various ways users might phrase their requests.

3. **Implement the action handler**:

   - Add the logic for the new action in the [videoActionHandler.ts](./src/videoActionHandler.ts) file. This may involve interacting with external APIs or services to fulfill the action.

4. **Update the manifest**:

   - Update the [videoManifest.json](./src/videoManifest.json) file to include the new action in the agent's schema.

5. **Test the new action**:

   - Add test cases to the [videoSchema.tests.json](./src/videoSchema.tests.json) file to validate the new action. Ensure the tests cover a variety of user inputs and edge cases.

6. **Run tests**:
   - Use the testing framework provided by the monorepo to run the tests and verify that the new action works as expected.

By following these steps, you can extend the `video-agent` to support additional video generation capabilities or other related functionalities.

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

`./src/videoActionHandler.ts`, `./src/videoActionSchema.ts`, `./src/videoManifest.json`, …and 3 more under `./src/`.

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

_Auto-generated against commit `366aaf867a7e8e5d130b6c87a365516bab725269` on `2026-07-07T09:05:05.703Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter video-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=301631bfe777ecde4eded16db871816caeca97c16c96cd31e6fb7377a33aa2a6 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# agent-sdk-wrapper — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `agent-sdk-wrapper` package provides direct integration with the Anthropic Agent SDK (`@anthropic-ai/claude-agent-sdk`) and includes intelligent caching support through TypeAgent's cache infrastructure. This package offers a programmatic approach to interacting with the Anthropic Agent SDK, allowing for full control over the request/response cycle in TypeScript.

## What it does

The `agent-sdk-wrapper` package enables users to interact with the Anthropic Agent SDK using a CLI tool. It supports various actions such as `query`, `streaming`, and `tool configuration`. The package leverages TypeAgent's caching infrastructure to check for cached responses before making API calls, improving performance and efficiency. Additionally, it supports voice input through multiple transcription options, including Azure Speech Services, Azure OpenAI, OpenAI Whisper API, and a local Whisper service.

### Key Features

- **Direct API Integration**: Uses the Agent SDK's `query()` function directly.
- **Programmatic Control**: Full control over the request/response cycle in TypeScript.
- **Streaming Support**: Can leverage the SDK's streaming capabilities.
- **Custom Tool Configuration**: Can specify which tools to enable per request.
- **Simpler I/O**: Standard readline interface for user input.
- **Cache-First**: Checks TypeAgent cache before making any API calls.
- **Voice Input**: Supports multiple transcription options for voice input.

## Setup

To use the `agent-sdk-wrapper` package, you need to set several environment variables. These variables are required for configuring API keys, endpoints, and other settings necessary for the package to function correctly. Below is a summary of the environment variables and how to obtain their values:

- `AUDIO_DEVICE`: Specify the device name or number for the microphone.
- `AZURE_OPENAI_API_KEY`: Obtain from the Azure portal.
- `AZURE_OPENAI_DEPLOYMENT_NAME`: Specify the deployment name for Azure OpenAI.
- `AZURE_OPENAI_ENDPOINT`: Obtain from the Azure portal.
- `AZURE_SPEECH_KEY`: Obtain from the Azure portal.
- `AZURE_SPEECH_REGION`: Specify the region for Azure Speech Services (e.g., westus2, eastus).
- `OPENAI_API_KEY`: Obtain from the OpenAI portal.
- `SPEECH_SDK_ENDPOINT`: Specify the endpoint for the Speech SDK.
- `SPEECH_SDK_KEY`: Obtain from the Azure portal.
- `SPEECH_SDK_REGION`: Specify the region for the Speech SDK.

For detailed setup instructions, see the hand-written README.

## Key Files

The `agent-sdk-wrapper` package is structured to provide direct API integration with the Anthropic Agent SDK. Key files and their responsibilities include:

- [index.ts](./src/index.ts): Re-exports utilities and classes from other packages, such as `CacheClient` and `DebugLogger`.
- [audioCapture.ts](./src/audioCapture.ts): Handles custom audio capture for Windows with device selection support.
- [cli.ts](./src/cli.ts): Implements the CLI tool for interacting with the Anthropic Agent SDK.
- [schemaReader.ts](./src/schemaReader.ts): Reads and parses schema information for grammar generation.
- [schemaToGrammarGenerator.ts](./src/schemaToGrammarGenerator.ts): Generates grammar from schema information.

The package uses TypeAgent's cache infrastructure to check for cached responses before making API calls, improving performance and efficiency.

## How to extend

To extend the `agent-sdk-wrapper` package, follow these steps:

1. Open the [index.ts](./src/index.ts) file to understand the exported utilities and classes.
2. Review the [cli.ts](./src/cli.ts) file to understand how the CLI tool is implemented and how it interacts with the Anthropic Agent SDK.
3. Modify or add new functionalities in the relevant files, such as adding new transcription options in [audioCapture.ts](./src/audioCapture.ts) or enhancing schema parsing in [schemaReader.ts](./src/schemaReader.ts).
4. Test your changes by running the CLI tool and verifying the new functionalities work as expected.

By following these steps, you can extend the package to include additional features or improve existing ones.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)

### Dependencies

Workspace:

- [@typeagent/action-schema](../../packages/actionSchema/README.md)
- [action-grammar](../../packages/actionGrammar/README.md)
- [agent-cache](../../packages/cache/README.md)
- [aiclient](../../packages/aiclient/README.md)
- [coder-wrapper](../../packages/coderWrapper/README.md)

External: `@anthropic-ai/claude-agent-sdk`, `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, `dotenv`, `form-data`, `mic`, `microsoft-cognitiveservices-speech-sdk`, `openai`, `zod`

### Files of interest

`./src/index.ts`, `./src/audioCapture.ts`, `./src/cli.ts`, …and 9 more under `./src/`.

### Environment variables

_10 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `AUDIO_DEVICE`
- `AZURE_OPENAI_API_KEY`
- `AZURE_OPENAI_DEPLOYMENT_NAME`
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_SPEECH_KEY`
- `AZURE_SPEECH_REGION`
- `OPENAI_API_KEY`
- `SPEECH_SDK_ENDPOINT`
- `SPEECH_SDK_KEY`
- `SPEECH_SDK_REGION`

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T09:44:30.178Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter agent-sdk-wrapper docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

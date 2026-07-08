<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=e31d70510b5c0e820d74463bbd1fd04963e455b2acd47ce586131a0b1929aa87 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# agent-sdk-wrapper — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `agent-sdk-wrapper` package provides a TypeScript library for direct integration with the Anthropic Agent SDK (`@anthropic-ai/claude-agent-sdk`) while leveraging TypeAgent's caching infrastructure. It offers a programmatic approach to interacting with the Anthropic Agent SDK, enabling efficient and customizable API calls with support for streaming, tool configuration, and voice input.

This package is designed as an alternative to the `coderWrapper` package, offering a lightweight, API-driven solution without the overhead of pseudo-terminal (PTY) emulation.

## What it does

The `agent-sdk-wrapper` package enables developers to interact with the Anthropic Agent SDK through a CLI tool or programmatically in TypeScript. It provides the following key capabilities:

- **Direct API Integration**: Uses the Anthropic Agent SDK's `query()` function for precise control over API calls.
- **Caching**: Integrates with TypeAgent's caching infrastructure to check for cached responses before making API calls, improving performance and reducing redundant requests.
- **Streaming Support**: Leverages the SDK's streaming capabilities to handle real-time responses.
- **Tool Configuration**: Allows dynamic enabling or disabling of specific tools for each request.
- **Voice Input**: Supports multiple transcription options, including Azure Speech Services, Azure OpenAI, OpenAI Whisper API, and a local Whisper service.
- **Interactive CLI**: Provides a readline-based interface for user input, with support for commands like `/voice` for voice input and options to customize behavior (e.g., disabling cache or enabling debug mode).

The package is particularly useful for scenarios requiring high performance, programmatic control, and integration with TypeAgent's broader ecosystem.

## Setup

To use the `agent-sdk-wrapper` package, you need to configure several environment variables. These variables are used to set up API keys, endpoints, and other necessary settings. Below is a summary of the required environment variables and how to obtain their values:

- `AUDIO_DEVICE`: Specify the device name or number for the microphone. Use `default` if unsure.
- `AZURE_OPENAI_API_KEY`: Obtain this key from the Azure portal.
- `AZURE_OPENAI_DEPLOYMENT_NAME`: Specify the deployment name for Azure OpenAI (e.g., `whisper`).
- `AZURE_OPENAI_ENDPOINT`: Obtain the endpoint URL from the Azure portal.
- `AZURE_SPEECH_KEY`: Obtain this key from the Azure portal for Azure Speech Services.
- `AZURE_SPEECH_REGION`: Specify the region for Azure Speech Services (e.g., `westus2`, `eastus`).
- `OPENAI_API_KEY`: Obtain this key from the OpenAI portal.
- `SPEECH_SDK_ENDPOINT`: Specify the endpoint for the Speech SDK (required for managed identity setups).
- `SPEECH_SDK_KEY`: Obtain this key from the Azure portal for the Speech SDK.
- `SPEECH_SDK_REGION`: Specify the region for the Speech SDK.

These variables can be set in your shell or added to a `.env` file in the project root. For more details on obtaining these values, refer to the hand-written README.

## Key Files

The `agent-sdk-wrapper` package is organized into several key files, each responsible for specific functionality:

- [index.ts](./src/index.ts): Serves as the main entry point, re-exporting utilities and classes such as `CacheClient` and `DebugLogger` for use in other packages.
- [audioCapture.ts](./src/audioCapture.ts): Handles audio capture for voice input, including support for device selection and volume adjustment.
- [cli.ts](./src/cli.ts): Implements the interactive CLI tool, providing a readline-based interface for interacting with the Anthropic Agent SDK.
- [schemaReader.ts](./src/schemaReader.ts): Reads and parses schema information for grammar generation, extracting details about actions and parameters.
- [schemaToGrammarGenerator.ts](./src/schemaToGrammarGenerator.ts): Generates grammar from schema information, supporting customization and error handling.
- [generate-grammar-cli.ts](./src/generate-grammar-cli.ts): Provides a CLI for generating grammar files from schema definitions.
- [mic.d.ts](./src/mic.d.ts) and [node-record-lpcm16.d.ts](./src/node-record-lpcm16.d.ts): Type definitions for audio recording libraries used in the package.

These files collectively enable the package's core functionalities, from API integration to voice input and grammar generation.

## How to extend

To extend the `agent-sdk-wrapper` package, follow these steps:

1. **Understand the Core Structure**:

   - Start with [index.ts](./src/index.ts) to see the main exports and understand how the package integrates with other TypeAgent components.
   - Review [cli.ts](./src/cli.ts) to understand how the CLI tool is implemented and how it interacts with the Anthropic Agent SDK.

2. **Add New Features**:

   - To add new transcription options, modify [audioCapture.ts](./src/audioCapture.ts) to include the necessary logic for capturing and processing audio.
   - To enhance schema parsing or grammar generation, update [schemaReader.ts](./src/schemaReader.ts) or [schemaToGrammarGenerator.ts](./src/schemaToGrammarGenerator.ts).

3. **Test Your Changes**:

   - Use the CLI tool to test new functionalities. For example, run `npm start` to test the interactive CLI or use `node dist/cli.js` directly.
   - Add unit tests for new features to ensure reliability.

4. **Integrate with TypeAgent**:
   - If your changes involve caching or other TypeAgent-specific features, ensure compatibility with the broader TypeAgent ecosystem by testing with related packages like `coderWrapper` and `agent-cache`.

By following these steps, you can extend the `agent-sdk-wrapper` package to include additional features or improve existing ones.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/index.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/action-grammar](../../packages/actionGrammar/README.md)
- [@typeagent/action-schema](../../packages/actionSchema/README.md)
- [@typeagent/aiclient](../../packages/aiclient/README.md)
- [@typeagent/config](../../packages/config/README.md)
- [agent-cache](../../packages/cache/README.md)
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

_Auto-generated against commit `366aaf867a7e8e5d130b6c87a365516bab725269` on `2026-07-07T09:05:05.703Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter agent-sdk-wrapper docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=aae9d40efd703de5608ebd3bba7520e375e07311f52837e7034f8c36f2ccc4ad -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/thoughts — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/thoughts` package is a TypeScript library designed to convert raw text and stream-of-consciousness into well-formatted markdown documents using Claude. It also supports audio transcription from WAV files using Azure Cognitive Services. This package can be used as a CLI tool or integrated into a Model Context Protocol (MCP) server.

## What it does

The package provides several capabilities:

- **CLI Utility**: Allows users to convert text files, audio files, or stdin input into markdown documents directly from the command line.
- **Audio Transcription**: Automatically transcribes WAV files using Azure Cognitive Services before processing them into markdown.
- **Custom Instructions**: Users can guide the formatting of the output markdown with additional instructions.
- **Keyword Tags**: Users can add tags for later lookup and organization.
- **Inline Tags**: During audio recording or text input, users can mark specific sections with inline tags.
- **Markdown Output**: Produces clean, well-organized markdown documents with proper structure.

The package supports actions such as `process_thoughts` to convert raw text into markdown and `save_markdown` to save the generated markdown to a file.

## Setup

To enable audio transcription, you need to set the following environment variables:

- `AZURE_SPEECH_KEY`: Your Azure Speech key.
- `AZURE_SPEECH_REGION`: Your Azure Speech region (e.g., "eastus").
- `SPEECH_SDK_ENDPOINT`: The endpoint for the Speech SDK.
- `SPEECH_SDK_KEY`: The key for the Speech SDK.
- `SPEECH_SDK_REGION`: The region for the Speech SDK.

These values can be set in your shell or in a `.env` file located at the root of the TypeAgent repository (`ts/.env`). For detailed steps on obtaining these values, see the hand-written README.

## Key Files

The package is structured into several key files:

- **[thoughtsProcessor.ts](./src/thoughtsProcessor.ts)**: Contains the main logic for processing raw text into markdown. It defines the `ProcessThoughtsOptions` and `ProcessThoughtsResult` interfaces and uses the Claude agent SDK to query and format the text.
- **[audioTranscriber.ts](./src/audioTranscriber.ts)**: Handles the transcription of WAV files using Azure Cognitive Services Speech SDK. It defines the `TranscribeOptions` and `TranscribeResult` interfaces.
- **[cli.ts](./src/cli.ts)**: Implements the command-line interface for the package. It parses CLI arguments, loads environment variables, and invokes the appropriate processing functions.
- **[mcpServer.ts.disabled](./src/mcpServer.ts.disabled)**: Contains the MCP server implementation, which is currently disabled. It defines the server capabilities and request handlers for MCP tools.

## How to extend

To extend the functionality of the `@typeagent/thoughts` package, follow these steps:

1. **Open the relevant file**: Depending on what you want to extend, start with one of the key files:

   - For text processing logic, open [thoughtsProcessor.ts](./src/thoughtsProcessor.ts).
   - For audio transcription logic, open [audioTranscriber.ts](./src/audioTranscriber.ts).
   - For CLI enhancements, open [cli.ts](./src/cli.ts).

2. **Follow the existing patterns**: Review the existing code to understand the structure and patterns used. For example, if adding a new CLI option, follow the pattern used in `cli.ts` for parsing arguments and invoking functions.

3. **Implement and test**: Make your changes and implement the new functionality. Ensure you write tests to verify your changes. You can run the tests using the following commands:

   ```bash
   npm run build
   npm run watch
   npm run clean
   ```

4. **Document your changes**: Update the documentation in the hand-written README to reflect your changes and provide usage examples.

By following these steps, you can effectively extend the functionality of the `@typeagent/thoughts` package.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/thoughtsProcessor.js](./dist/thoughtsProcessor.js)

### Dependencies

Workspace:

- [aiclient](../../../packages/aiclient/README.md)

External: `@anthropic-ai/claude-agent-sdk`, `@anthropic-ai/sdk`, `dotenv`, `microsoft-cognitiveservices-speech-sdk`

### Files of interest

`./src/audioTranscriber.ts`, `./src/cli.ts`, `./src/mcpServer.ts.disabled`, …and 1 more under `./src/`.

### Environment variables

_5 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `AZURE_SPEECH_KEY`
- `AZURE_SPEECH_REGION`
- `SPEECH_SDK_ENDPOINT`
- `SPEECH_SDK_KEY`
- `SPEECH_SDK_REGION`

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T19:00:56.375Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/thoughts docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=c058561d7cf2ec1ee5e7a42a8a052b09189ece680d5c98ab2977bdd4b2069d4f -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# utility-typeagent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `utility-typeagent` package is a TypeAgent application agent that provides utility operations for web search, web content fetching, file input/output, and text transformation using language models. It is designed to be integrated into compiled task flows, enabling automated workflows that require interaction with web content, file systems, and language model processing.

This package leverages external libraries such as `puppeteer` for web scraping, `html-to-text` for content transformation, and `@anthropic-ai/claude-agent-sdk` for language model interactions. It is a core component of the TypeAgent ecosystem, supporting a variety of utility actions.

## What it does

The `utility-typeagent` package implements several key actions that enable it to perform a range of utility tasks:

- **Web Search (`webSearch`)**: Executes a search query on the web and retrieves a list of search results.
- **Web Fetch (`webFetch`)**: Fetches the content of a specified URL, such as a webpage or an online resource.
- **File Operations**:
  - `readFile`: Reads the content of a file from the local filesystem.
  - `writeFile`: Writes specified content to a file on the local filesystem.
- **Language Model Transformations**:
  - `llmTransform`: Processes text or HTML using a language model, with options for JSON parsing and HTML output.
  - `claudeTask`: Executes tasks or queries using the Claude language model.

These actions allow the agent to interact with external resources, process data, and perform file-based operations, making it a versatile tool for automating complex workflows.

## Setup

To use the `utility-typeagent` package, you need to configure the following:

1. **Environment Variables**:

   - `CLAUDE_API_KEY`: Required to authenticate with the Claude language model. Obtain this key from the provider's developer portal.

2. **Dependencies**:
   - Ensure that all required dependencies are installed. These include `puppeteer`, `puppeteer-extra`, `puppeteer-extra-plugin-stealth`, `html-to-text`, and `@anthropic-ai/claude-agent-sdk`.

For additional details on setup, including any specific configuration steps, refer to the hand-written README.

## Key Files

The `utility-typeagent` package is organized into several key files, each serving a specific purpose:

- **[utilitySchema.agr](./src/utilitySchema.agr)**: Defines the grammar for the agent, specifying the syntax for supported actions such as `webSearch`, `webFetch`, `readFile`, and `writeFile`. This file is essential for parsing natural language inputs into structured actions.
- **[utilitySchema.mts](./src/utilitySchema.mts)**: Contains the TypeScript definitions for the actions supported by the agent. Each action, such as `WebSearchAction` or `WriteFileAction`, is defined with its parameters and expected structure.

- **[actionHandler.mts](./src/actionHandler.mts)**: Implements the logic for executing the defined actions. This file includes functions for performing web searches, fetching web content, reading and writing files, and interacting with the Claude language model.

- **[manifest.json](./manifest.json)**: Provides metadata about the agent, including its description, emoji, and references to the schema and grammar files. This file is essential for registering the agent within the TypeAgent ecosystem.

- **[tsconfig.json](./src/tsconfig.json)**: Configures TypeScript compilation settings for the package, including the root directory and output directory.

### File Responsibilities

- **Grammar and Schema**: The combination of [utilitySchema.agr](./src/utilitySchema.agr) and [utilitySchema.mts](./src/utilitySchema.mts) defines the structure and syntax of the actions. These files ensure that the agent can interpret and validate the actions it receives.
- **Action Logic**: [actionHandler.mts](./src/actionHandler.mts) is the core of the package, containing the implementation of all supported actions. For example:
  - `webSearch` uses `puppeteer` and `puppeteer-extra` to perform web searches.
  - `webFetch` retrieves content from a URL.
  - `readFile` and `writeFile` handle file system operations using Node.js's `fs/promises` module.
  - `llmTransform` and `claudeTask` interact with the Claude language model via the `@anthropic-ai/claude-agent-sdk`.
- **Manifest**: [manifest.json](./manifest.json) ensures the agent is properly registered and provides metadata for integration with other components.

## How to extend

To add new functionality to the `utility-typeagent` package, follow these steps:

1. **Define a New Action**:

   - Add a new TypeScript type for the action in [utilitySchema.mts](./src/utilitySchema.mts). Specify the `actionName` and the required parameters for the action.

2. **Update the Grammar**:

   - Modify [utilitySchema.agr](./src/utilitySchema.agr) to include the syntax for the new action. This ensures the agent can parse natural language inputs into the new action.

3. **Implement the Action Logic**:

   - Add the implementation for the new action in [actionHandler.mts](./src/actionHandler.mts). Use existing helper functions from `@typeagent/agent-sdk` or external libraries as needed.

4. **Test the New Action**:

   - Write unit tests to validate the new action's functionality. Ensure the tests cover various scenarios, including edge cases and error handling.

5. **Update the Manifest**:
   - If necessary, update [manifest.json](./manifest.json) to include metadata about the new action.

For example, to add an action for image processing:

- Define an `ImageProcessAction` type in the schema file.
- Add grammar rules for the action in the grammar file.
- Implement the image processing logic in the action handler.
- Write tests to ensure the action works as expected.

By following these steps, you can extend the `utility-typeagent` package to support additional utility operations, making it even more versatile for your task flows.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./manifest.json](./manifest.json)
- `./agent/handlers` → `./dist/actionHandler.mjs` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/action-grammar-compiler](../../../packages/actionGrammarCompiler/README.md)
- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [browser-typeagent](../../../packages/agents/browser/README.md)

External: `@anthropic-ai/claude-agent-sdk`, `@types/html-to-text`, `html-to-text`, `puppeteer`, `puppeteer-extra`, `puppeteer-extra-plugin-stealth`

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/utilitySchema.agr`, `./src/actionHandler.mts`, `./src/tsconfig.json`, …and 2 more under `./src/`.

### Agent surface

- Grammar: [./src/utilitySchema.agr](./src/utilitySchema.agr)

---

_Auto-generated against commit `656444843518fd1f9bb1b157b6dbf6dcbcde3999` on `2026-07-09T09:05:44.186Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter utility-typeagent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=021ac978661b96da3b730555b699bfd6aa6f32a6469bbf42479cee2b45d10112 -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# utility-typeagent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `utility-typeagent` package is a TypeAgent application agent designed to perform utility operations such as web searches, web fetches, and file I/O within compiled task flows. It integrates with various external libraries and services to provide these functionalities, making it a versatile tool for handling various utility tasks in an automated manner.

## What it does

The `utility-typeagent` package supports several actions that can be used in task flows:

- `webSearch`: Performs a web search using a query string and returns the search results.
- `webFetch`: Fetches the content of a specified URL.
- `readFile`: Reads the contents of a file from the filesystem.
- `writeFile`: Writes content to a specified file.
- `llmTransform`: Transforms text or HTML using a language model, with options for JSON parsing and HTML output.
- `claudeTask`: Executes tasks using the Claude language model.

These actions enable the agent to interact with web content, perform file operations, and leverage language model transformations. The package integrates with external libraries such as `puppeteer`, `html-to-text`, and `@anthropic-ai/claude-agent-sdk` to provide these functionalities.

## Setup

To set up the `utility-typeagent` package, you need to configure several environment variables and dependencies. The required environment variables include:

- `CLAUDE_API_KEY`: The API key for accessing the Claude language model.

Additionally, you need to install the necessary dependencies and configure the package settings. For detailed setup instructions, refer to the hand-written README.

## Key Files
The `utility-typeagent` package is structured as follows:

- **Grammar**: The grammar for the agent is defined in [utilitySchema.agr](./src/utilitySchema.agr). This file specifies the syntax for the supported actions.
- **Schema**: The schema for the actions is defined in [utilitySchema.mts](./src/utilitySchema.mts). This file includes TypeScript types for each action.
- **Action Handler**: The main logic for handling actions is implemented in [actionHandler.mts](./src/actionHandler.mts). This file contains the functions that execute the actions and return results.
- **Manifest**: The agent's manifest is defined in [manifest.json](./manifest.json). This file includes metadata about the agent, such as its description, emoji, and schema files.

### Key Files and Their Responsibilities

- [utilitySchema.agr](./src/utilitySchema.agr): Defines the grammar for the agent, specifying the syntax for actions like `webSearch`, `webFetch`, `readFile`, and `writeFile`.
- [utilitySchema.mts](./src/utilitySchema.mts): Contains TypeScript types for each action, detailing the parameters and structure of actions such as `WebSearchAction`, `WebFetchAction`, `ReadFileAction`, `WriteFileAction`, `LlmTransformAction`, and `ClaudeTaskAction`.
- [actionHandler.mts](./src/actionHandler.mts): Implements the logic for handling actions. This file includes functions to perform web searches, fetch web content, read and write files, and interact with the Claude language model.
- [manifest.json](./manifest.json): Provides metadata about the agent, including its description, emoji, and schema files.

## How to extend

To extend the `utility-typeagent` package, follow these steps:

1. **Add a new action**: Define the new action in [utilitySchema.mts](./src/utilitySchema.mts) by adding a new TypeScript type for the action.
2. **Update the grammar**: Modify [utilitySchema.agr](./src/utilitySchema.agr) to include the syntax for the new action.
3. **Implement the action handler**: Add the logic for the new action in [actionHandler.mts](./src/actionHandler.mts). Ensure that the handler processes the action and returns the appropriate result.
4. **Test the new action**: Write tests to verify the functionality of the new action. Ensure that the tests cover various scenarios and edge cases.

By following these steps, you can extend the capabilities of the `utility-typeagent` package to support additional utility operations. For example, if you want to add a new action to perform image processing, you would define the new action type in the schema, update the grammar to recognize the new action, implement the logic in the action handler, and write tests to ensure it works correctly.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./manifest.json](./manifest.json)
- `./agent/handlers` → [./dist/actionHandler.mjs](./dist/actionHandler.mjs)

### Dependencies

Workspace:

- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [action-grammar-compiler](../../../packages/actionGrammarCompiler/README.md)
- [browser-typeagent](../../../packages/agents/browser/README.md)

External: `@anthropic-ai/claude-agent-sdk`, `@types/html-to-text`, `html-to-text`, `puppeteer`, `puppeteer-extra`, `puppeteer-extra-plugin-stealth`

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/utilitySchema.agr`, `./src/actionHandler.mts`, `./src/tsconfig.json`, …and 1 more under `./src/`.

### Agent surface

- Grammar: [./src/utilitySchema.agr](./src/utilitySchema.agr)

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T09:44:30.178Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter utility-typeagent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

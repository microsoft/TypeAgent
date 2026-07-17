<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=6a74bc37c60f775e8d9787ef1425702c6d1e6d243023bb1ae2bd0cc8d195febc -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# utility-typeagent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `utility-typeagent` package is a TypeAgent application agent that provides utility operations for compiled task flows. It enables workflows to perform web searches, fetch web content, handle file input/output operations, and interact with language models for text transformations. This package integrates with tools like `puppeteer`, `html-to-text`, and `@anthropic-ai/claude-agent-sdk` to deliver its functionality.

## What it does

The `utility-typeagent` package supports a range of actions grouped into three primary categories:

### Web Operations

- **`webSearch`**: Executes a web search based on a query string and returns results. This is useful for retrieving information from the internet.
- **`webFetch`**: Fetches the content of a specified URL, such as a webpage or other online resource. This action retrieves raw HTML or other data from web pages.

### File Input/Output

- **`readFile`**: Reads the contents of a file from the filesystem. This is useful for accessing local data or configuration files.
- **`writeFile`**: Writes specified content to a file at a given path. This is commonly used to save data or logs to the local filesystem.

### Language Model Interactions

- **`llmTransform`**: Uses a language model to transform text or HTML based on a given prompt. It supports options for JSON parsing and HTML output, making it versatile for tasks like summarization, rewriting, or data extraction.
- **`claudeTask`**: Executes tasks or answers questions using the Claude language model. This action is tailored for more complex or conversational AI tasks.

These actions allow the agent to interact with web content, perform file operations, and utilize advanced language model capabilities, making it a versatile tool for utility tasks.

## Setup

To use the `utility-typeagent` package, ensure the following setup steps are completed:

1. **Environment Variables**:

   - `CLAUDE_API_KEY`: Required to access the Claude language model. Obtain this key from the provider's developer portal.

2. **Dependencies**:
   - Install the required dependencies:
     - Workspace dependencies: `@typeagent/agent-sdk`, `@typeagent/action-grammar-compiler`, `@typeagent/action-schema-compiler`, and `browser-typeagent`.
     - External libraries: `puppeteer`, `html-to-text`, and `@anthropic-ai/claude-agent-sdk`.

Refer to the hand-written README for additional setup details if needed.

## Key Files

The `utility-typeagent` package is organized into several key files, each with a specific role:

- **[utilitySchema.agr](./src/utilitySchema.agr)**:

  - Defines the grammar for the agent, specifying the natural language syntax for each action.
  - For example, the `webSearch` action can be triggered with phrases like "search the web for `<query>`" or "look up `<query>` online."

- **[utilitySchema.mts](./src/utilitySchema.mts)**:

  - Contains TypeScript type definitions for each action, detailing their parameters and structure.
  - For instance, the `WebSearchAction` type includes a `query` parameter and an optional `numResults` parameter.

- **[actionHandler.mts](./src/actionHandler.mts)**:

  - Implements the logic for handling each action. This file includes functions to:
    - Perform web searches using `puppeteer`.
    - Fetch web content.
    - Read and write files using Node.js file system APIs.
    - Interact with the Claude language model via `@anthropic-ai/claude-agent-sdk`.

- **[manifest.json](./manifest.json)**:

  - Provides metadata about the agent, including its description, emoji, and schema files.
  - Specifies the agent's capabilities, such as web search, web fetch, and file I/O.

- **[tsconfig.json](./src/tsconfig.json)**:

  - Configures TypeScript compilation settings for the package.

- **[utilitySchema.keywords.json](./src/utilitySchema.keywords.json)**:
  - Contains metadata about the schema, including action keywords for natural language processing.

## How to extend

To add new functionality to the `utility-typeagent` package, follow these steps:

1. **Define a New Action**:

   - Add a new TypeScript type for the action in [utilitySchema.mts](./src/utilitySchema.mts). Specify the `actionName` and the required parameters.
   - Example:
     ```ts
     export type NewAction = {
       actionName: "newAction";
       parameters: {
         param1: string;
         param2: number;
       };
     };
     ```

2. **Update the Grammar**:

   - Modify [utilitySchema.agr](./src/utilitySchema.agr) to include the syntax for the new action.
   - Example:
     ```text
     <newAction> =
           perform new action with $(param1:wildcard) and $(param2:number)
             -> { actionName: "newAction", parameters: { param1, param2 } };
     ```

3. **Implement the Action Handler**:

   - Add the logic for the new action in [actionHandler.mts](./src/actionHandler.mts). Ensure the handler processes the action and returns the appropriate result.
   - Example:
     ```ts
     async function handleNewAction(
       params: NewAction["parameters"],
     ): Promise<ActionResult> {
       // Implement the logic for the new action here
       return createActionResultFromTextDisplay(
         `Processed ${params.param1} and ${params.param2}`,
       );
     }
     ```

4. **Test the New Action**:

   - Write tests to verify the functionality of the new action. Ensure that the tests cover various scenarios and edge cases.

5. **Update the Manifest**:
   - If necessary, update [manifest.json](./manifest.json) to include metadata about the new action.

By following these steps, you can extend the `utility-typeagent` package to support additional utility operations. For example, you could add actions for data analysis, API integrations, or other custom tasks.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./manifest.json](./manifest.json)
- `./agent/handlers` → [./dist/actionHandler.mjs](./dist/actionHandler.mjs)

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

_Auto-generated against commit `5cbcf613f047f08749d0451296eb1cdc610ae414` on `2026-07-17T18:24:18.404Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter utility-typeagent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

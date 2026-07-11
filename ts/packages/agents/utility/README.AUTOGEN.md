<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=c058561d7cf2ec1ee5e7a42a8a052b09189ece680d5c98ab2977bdd4b2069d4f -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# utility-typeagent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `utility-typeagent` package is a TypeAgent application agent designed to provide utility operations for compiled task flows. It enables workflows to perform web searches, fetch web content, handle file input/output operations, and interact with language models for text transformations. This package integrates with external libraries and services such as `puppeteer`, `html-to-text`, and `@anthropic-ai/claude-agent-sdk` to deliver its functionality.

## What it does

The `utility-typeagent` package supports a variety of actions that can be grouped into three main categories:

### Web Operations

- **`webSearch`**: Executes a web search based on a query string and returns the results. This action is useful for retrieving information from the internet.
- **`webFetch`**: Fetches the content of a specified URL, such as a webpage or other online resource. This is particularly useful for scraping or retrieving data from web pages.

### File Input/Output

- **`readFile`**: Reads the contents of a file from the filesystem. This action supports both absolute and relative file paths.
- **`writeFile`**: Writes specified content to a file at a given path. This action can be used to save data or create new files.

### Language Model Interactions

- **`llmTransform`**: Uses a language model to transform text or HTML based on a given prompt. It supports options for JSON parsing and HTML output, making it versatile for various text-processing tasks.
- **`claudeTask`**: Executes tasks or answers questions using the Claude language model. This action is ideal for leveraging advanced AI capabilities in workflows.

These actions make the `utility-typeagent` package a versatile tool for automating tasks that involve web content, file management, and natural language processing.

## Setup

To use the `utility-typeagent` package, you need to configure the following:

1. **Environment Variables**:

   - `CLAUDE_API_KEY`: Required to access the Claude language model. You can obtain this key from the provider's developer portal.

2. **Dependencies**:
   - Ensure that all required dependencies are installed. These include:
     - Workspace dependencies: `@typeagent/agent-sdk`, `@typeagent/action-grammar-compiler`, `@typeagent/action-schema-compiler`, and `browser-typeagent`.
     - External libraries: `puppeteer`, `html-to-text`, and `@anthropic-ai/claude-agent-sdk`.

For additional setup details, refer to the hand-written README.

## Key Files

The `utility-typeagent` package is organized into several key files, each responsible for specific aspects of the agent's functionality:

### Grammar

- **[utilitySchema.agr](./src/utilitySchema.agr)**: Defines the grammar for the agent, specifying the syntax for actions such as `webSearch`, `webFetch`, `readFile`, and `writeFile`. For example:
  - The `webSearch` action can be triggered with phrases like "search the web for `<query>`" or "look up `<query>` online."
  - The `readFile` action can be triggered with phrases like "read the file `<path>`" or "get the contents of `<path>`."

### Schema

- **[utilitySchema.mts](./src/utilitySchema.mts)**: Contains TypeScript types for each action, detailing their parameters and structure. For example:
  - The `WebSearchAction` type includes a `query` parameter and an optional `numResults` parameter.
  - The `LlmTransformAction` type includes parameters for input text, transformation prompts, and options for JSON parsing and HTML output.

### Action Handler

- **[actionHandler.mts](./src/actionHandler.mts)**: Implements the logic for handling actions. This file includes functions to:
  - Perform web searches using `puppeteer`.
  - Fetch web content from URLs.
  - Read and write files using Node.js file system APIs.
  - Interact with the Claude language model via `@anthropic-ai/claude-agent-sdk`.

### Manifest

- **[manifest.json](./manifest.json)**: Provides metadata about the agent, including its description, emoji, and schema files. It specifies that the agent supports utility operations like web search, web fetch, and file I/O.

### Additional Files

- **[tsconfig.json](./src/tsconfig.json)**: Configures TypeScript compilation settings for the package.
- **[utilitySchema.keywords.json](./src/utilitySchema.keywords.json)**: Contains metadata about the schema, including action keywords for natural language processing.

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

By following these steps, you can extend the `utility-typeagent` package to support additional utility operations. For example, you could add actions for image processing, data transformation, or integration with other APIs.

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

_Auto-generated against commit `44b34a9ac8794b6f90489ff7e55fe57283c34960` on `2026-07-11T08:34:41.338Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter utility-typeagent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

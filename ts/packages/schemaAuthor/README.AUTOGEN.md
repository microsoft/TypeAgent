<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=6f665b00141157344045cb3fe2eaa9b39848c96d4b42f2053bfe3d46aa425a6b -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# schema-author — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `schema-author` package is a TypeScript library designed to assist in creating intents and their associated schemas. It leverages structured prompting and large language models (LLMs) to generate variations of user utterances and possible utterances for a given schema. This functionality is particularly useful for applications that rely on natural language processing and need to handle diverse user inputs effectively.

## What it does

The `schema-author` package provides tools for working with action schemas and generating natural language variations. Its key features include:

- **Schema Loading**: The `loadActionSchema` function allows you to load and process action schemas from a file path or a `SchemaParser` instance. It retrieves the schema text and any referenced types, enabling structured intent creation.
- **Phrase Generation**: The `generateActionPhrases` function generates natural language phrases that align with a given action schema. This includes support for specifying variation types, language models, and additional parameters like example phrases or language preferences.

These features make the package a valuable tool for developers building systems that require structured natural language understanding, such as chatbots, virtual assistants, or other AI-driven applications. The package integrates with other components in the TypeAgent monorepo, such as `@typeagent/action-schema` for schema parsing and `typeagent` for type definitions and utilities.

## Setup

To use the `schema-author` package, follow these steps:

1. **Install Dependencies**: Use `pnpm` to install the required dependencies. Run the following command in the root of the monorepo:

   ```sh
   pnpm install
   ```

2. **Workspace Dependencies**: Ensure that the related workspace packages (`@typeagent/action-schema`, `@typeagent/aiclient`, and `typeagent`) are properly linked and installed. These packages provide essential functionality for schema parsing and interaction with language models.

3. **External Dependencies**: The package also depends on the `typechat` library. Ensure it is installed and available in your environment.

For additional setup details, refer to the hand-written README.

## Key Files

The `schema-author` package is organized into the following key files:

- **[index.ts](./src/index.ts)**: Serves as the main entry point for the package. It exports the primary functions, including `loadActionSchema` and `generateActionPhrases`.
- **[schema.ts](./src/schema.ts)**: Contains the implementation of the `loadActionSchema` function. This file is responsible for loading and processing action schemas, including handling referenced types.
- **[variationGenerator.ts](./src/variationGenerator.ts)**: Implements the `generateActionPhrases` function. This file handles the logic for generating natural language variations based on a schema, using a language model and optional parameters.
- **[tsconfig.json](./src/tsconfig.json)**: Defines the TypeScript compiler configuration for the package, including output directory settings.

These files collectively provide the core functionality of the package, enabling schema manipulation and phrase generation.

## How to extend

To extend the `schema-author` package, follow these steps:

1. **Understand the Existing Code**: Start by reviewing [index.ts](./src/index.ts) to understand the exported functions and their usage. This will give you an overview of the package's capabilities.

2. **Add New Schema Features**: If you need to introduce new schema-related functionality, modify or add functions in [schema.ts](./src/schema.ts). This file is the primary location for schema processing logic.

3. **Enhance Phrase Generation**: To customize or expand the phrase generation capabilities, update [variationGenerator.ts](./src/variationGenerator.ts). You can add new parameters, adjust the generation logic, or integrate additional language model features.

4. **Test Your Changes**: Ensure that your modifications are thoroughly tested. Add or update test cases to cover the new functionality and verify that existing features remain unaffected.

By following these steps, you can adapt the `schema-author` package to meet the specific requirements of your application or project.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/index.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/action-schema](../../packages/actionSchema/README.md)
- [@typeagent/aiclient](../../packages/aiclient/README.md)
- [typeagent](../../packages/typeagent/README.md)

External: `typechat`

### Used by

- schema-studio

### Files of interest

`./src/index.ts`, `./src/schema.ts`, `./src/tsconfig.json`, …and 1 more under `./src/`.

---

_Auto-generated against commit `366aaf867a7e8e5d130b6c87a365516bab725269` on `2026-07-07T09:05:05.703Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter schema-author docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

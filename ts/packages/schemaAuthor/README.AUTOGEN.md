<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=7e2ea49302d3bb6afeaa619d0a7f3c3df30b1bd638c9c53c57228499505928da -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# schema-author — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `schema-author` package is a TypeScript library designed for creating intents and associated schemas. It leverages structured prompting and large language models (LLMs) to generate variations of user utterances and possible utterances for a given schema. This package is particularly useful for applications that rely on natural language processing and need to handle diverse user inputs.

## What it does

The `schema-author` package provides functionality to load and manipulate action schemas, as well as generate variations of phrases that can target these schemas. It includes the following capabilities:

- **Schema Loading**: The `loadActionSchema` function allows loading a schema from a file path or a `SchemaParser` instance, and retrieves the schema text along with any referenced types.
- **Phrase Generation**: The `generateActionPhrases` function generates phrases that can be mapped to a given action schema, using a specified variation type and language model.

These functionalities are essential for creating and managing structured intents in applications that rely on natural language processing. The package integrates with other workspace packages such as `@typeagent/action-schema` for schema parsing and `typeagent` for type definitions and utilities.

## Setup

To set up the `schema-author` package, ensure you have the necessary dependencies installed. The package relies on other workspace packages such as `@typeagent/action-schema`, `aiclient`, and `typeagent`, as well as the external `typechat` package.

1. Install the dependencies using `pnpm`:

   ```sh
   pnpm install
   ```

2. Ensure you have the required environment variables and API keys set up as described in the hand-written README.

For detailed setup instructions, see the hand-written README.

## Key Files

The `schema-author` package is structured into several key files:

- **[index.ts](./src/index.ts)**: This file exports the main functionalities of the package, including schema loading and variation generation.
- **[schema.ts](./src/schema.ts)**: Contains the `loadActionSchema` function, which loads and processes action schemas.
- **[variationGenerator.ts](./src/variationGenerator.ts)**: Implements the `generateActionPhrases` function, which generates variations of phrases based on the provided schema and language model.
- **[tsconfig.json](./src/tsconfig.json)**: Configuration file for TypeScript compiler options.

The package integrates with other workspace packages such as `@typeagent/action-schema` for schema parsing and `typeagent` for type definitions and utilities.

## How to extend

To extend the `schema-author` package, follow these steps:

1. **Start with the main files**: Open [index.ts](./src/index.ts) to understand the exported functions and their usage.
2. **Add new schema functionalities**: If you need to add new schema-related functionalities, modify or add functions in [schema.ts](./src/schema.ts).
3. **Enhance phrase generation**: To enhance or customize phrase generation, update [variationGenerator.ts](./src/variationGenerator.ts) with new logic or parameters.
4. **Test your changes**: Ensure your changes are well-tested. Add or update tests in the appropriate test files to cover new functionalities.

By following these steps, you can effectively extend the capabilities of the `schema-author` package to suit your application's needs.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)

### Dependencies

Workspace:

- [@typeagent/action-schema](../../packages/actionSchema/README.md)
- [@typeagent/aiclient](../../packages/aiclient/README.md)
- [typeagent](../../packages/typeagent/README.md)

External: `typechat`

### Used by

- [schema-studio](../../examples/schemaStudio/README.md)

### Files of interest

`./src/index.ts`, `./src/schema.ts`, `./src/tsconfig.json`, …and 1 more under `./src/`.

---

_Auto-generated against commit `127a36a95a15e918be533d6eaaf08adebe9070d9` on `2026-06-26T03:01:52.873Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter schema-author docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

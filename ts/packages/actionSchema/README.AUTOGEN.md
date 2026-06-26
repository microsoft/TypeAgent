<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=228e29910d631664437c159e35e6b020a8d25d2cda857fb235b9486455dc5d7c -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/action-schema — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/action-schema` package is a TypeScript library designed to parse and generate schemas for TypeAgent actions. It provides tools to define, validate, and manipulate action schemas, facilitating the integration and extension of TypeAgent functionalities.

## What it does

This package offers a comprehensive set of utilities for handling action schemas in TypeScript. Key capabilities include:

- **Parsing Action Schemas**: Functions like `parseActionSchemaSource` and `parseSchemaSource` allow for the parsing of TypeScript source files to extract schema definitions.
- **Generating Action Schemas**: Utilities such as `generateActionSchema` and `generateSchemaTypeDefinition` enable the creation of schema definitions from TypeScript types.
- **JSON Schema Integration**: Functions like `generateActionJsonSchema` and `parseToolsJsonSchema` provide support for converting TypeScript schemas to JSON schemas and vice versa.
- **Validation**: The `validateAction` function ensures that actions conform to their defined schemas.
- **Serialization**: Methods like `toJSONParsedActionSchema` and `fromJSONParsedActionSchema` facilitate the serialization and deserialization of parsed action schemas.

These functionalities are essential for defining and enforcing the structure of actions within the TypeAgent ecosystem, ensuring consistency and reliability.

## Setup

To use the `@typeagent/action-schema` package, you need to install it along with its dependencies. The package requires `debug` and `typescript` as external dependencies. Ensure these are installed in your project:

```sh
pnpm install @typeagent/action-schema debug typescript
```

For detailed setup instructions, including environment variables and configuration options, refer to the hand-written README.

## Key Files

The package is organized into several key modules, each responsible for different aspects of schema handling:

- **[index.ts](./src/index.ts)**: The main entry point, exporting various types and functions for schema manipulation.
- **[creator.ts](./src/creator.ts)**: Contains functions to create schema types, such as `string`, `number`, `boolean`, and complex types like `array` and `object`.
- **[generator.ts](./src/generator.ts)**: Provides functions to generate schema definitions from TypeScript types, including support for JSON schema generation.
- **[jsonSchemaGenerator.ts](./src/jsonSchemaGenerator.ts)**: Focuses on generating JSON schemas from TypeScript schema definitions.
- **[jsonSchemaParser.ts](./src/jsonSchemaParser.ts)**: Parses JSON schemas and converts them into TypeScript schema definitions.
- **[parser.ts](./src/parser.ts)**: Contains functions to parse TypeScript source files and extract schema definitions.
- **[schemaConfig.ts](./src/schemaConfig.ts)**: Defines configuration types for schema parsing and generation.

## How to extend

To extend the `@typeagent/action-schema` package, follow these steps:

1. **Identify the module to extend**: Determine whether you need to add new schema types, enhance parsing capabilities, or introduce new generation functions.
2. **Modify or add functions**: Open the relevant file (e.g., [creator.ts](./src/creator.ts) for new schema types, [parser.ts](./src/parser.ts) for parsing enhancements) and implement your changes.
3. **Update exports**: Ensure that your new functions or types are exported in [index.ts](./src/index.ts) to make them available for use.
4. **Test your changes**: Write tests to validate your new functionalities. Ensure that existing tests pass and cover your modifications.

By following these steps, you can effectively extend the capabilities of the `@typeagent/action-schema` package to meet your specific requirements.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)

### Dependencies

Workspace: _None._

External: `debug`, `typescript`

### Used by

- [@typeagent/action-grammar](../../packages/actionGrammar/README.md)
- [@typeagent/action-grammar-compiler](../../packages/actionGrammarCompiler/README.md)
- [@typeagent/action-schema-compiler](../../packages/actionSchemaCompiler/README.md)
- [@typeagent/core](../../packages/typeagent-core/README.md)
- [agent-cache](../../packages/cache/README.md)
- [agent-cli](../../packages/cli/README.md)
- [agent-dispatcher](../../packages/dispatcher/dispatcher/README.md)
- [agent-sdk-wrapper](../../packages/agentSdkWrapper/README.md)
- [browser-typeagent](../../packages/agents/browser/README.md)
- [cache-rest-endpoint](../../examples/cacheRESTEndpoint/README.md)
- _…and 5 more workspace consumers._

### Files of interest

`./src/index.ts`, `./src/creator.ts`, `./src/generator.ts`, …and 12 more under `./src/`.

---

_Auto-generated against commit `127a36a95a15e918be533d6eaaf08adebe9070d9` on `2026-06-26T03:01:52.873Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/action-schema docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

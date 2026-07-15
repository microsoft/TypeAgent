<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=18a2f23010db57a54c4e3e41931846a44352087732157a8893550750b1dd2d4c -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/action-schema — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/action-schema` package is a TypeScript library designed to facilitate the parsing, generation, and validation of action schemas within the TypeAgent framework. Action schemas define the structure and constraints of actions, ensuring consistency and correctness across the system. This package is a foundational component of the TypeAgent ecosystem and is widely used by other packages in the monorepo.

## What it does

The `@typeagent/action-schema` package provides a comprehensive set of tools for working with action schemas. Its key capabilities include:

- **Parsing Action Schemas**: Extract schema definitions from TypeScript source files using functions like `parseActionSchemaSource` and `parseSchemaSource`.
- **Schema Generation**: Generate schema definitions from TypeScript types with utilities such as `generateActionSchema` and `generateSchemaTypeDefinition`.
- **JSON Schema Integration**: Convert TypeScript schemas to JSON schemas and vice versa using functions like `generateActionJsonSchema` and `parseToolsJsonSchema`.
- **Validation**: Validate actions against their defined schemas using the `validateAction` function.
- **Serialization**: Serialize and deserialize parsed action schemas with `toJSONParsedActionSchema` and `fromJSONParsedActionSchema`.

These features enable the package to serve as a critical tool for defining, managing, and enforcing structured action schemas in TypeAgent-based projects. It is a dependency for several other packages in the monorepo, including `@typeagent/action-grammar`, `@typeagent/action-grammar-compiler`, and `@typeagent/core`.

## Setup

To use the `@typeagent/action-schema` package, install it along with its external dependencies. Run the following command:

```sh
pnpm install @typeagent/action-schema debug typescript
```

No additional setup, such as environment variables or external services, is required. For more details, refer to the hand-written README.

## Key Files

The package is organized into several key modules, each responsible for specific aspects of schema handling:

- **[index.ts](./src/index.ts)**: The main entry point of the package. It exports core types and functions for schema parsing, generation, validation, and serialization.
- **[creator.ts](./src/creator.ts)**: Provides utilities for creating schema types, such as `string`, `number`, `boolean`, and more complex types like `array` and `object`. This is the starting point for defining new schema types.
- **[generator.ts](./src/generator.ts)**: Implements logic for generating schema definitions from TypeScript types. It also supports generating JSON schemas.
- **[jsonSchemaGenerator.ts](./src/jsonSchemaGenerator.ts)**: Focuses on converting TypeScript schema definitions into JSON schemas. Includes utilities like `wrapTypeWithJsonSchema` for integrating JSON schema structures.
- **[jsonSchemaParser.ts](./src/jsonSchemaParser.ts)**: Handles the reverse process of parsing JSON schemas and converting them into TypeScript schema definitions.
- **[parser.ts](./src/parser.ts)**: Contains functions to parse TypeScript source files and extract schema definitions. This module is essential for integrating TypeScript-based schemas into the TypeAgent framework.
- **[schemaConfig.ts](./src/schemaConfig.ts)**: Defines configuration types for schema parsing and generation, such as `ParamSpec` and `SchemaConfig`.
- **[type.ts](./src/type.ts)**: Contains the core type definitions used throughout the package, including `SchemaType`, `SchemaObjectField`, and `SchemaTypeDefinition`.

## How to extend

To extend the `@typeagent/action-schema` package, follow these steps:

1. **Identify the area to extend**:

   - To add new schema types, start with [creator.ts](./src/creator.ts).
   - For new parsing capabilities, modify or extend [parser.ts](./src/parser.ts).
   - To enhance schema generation, work with [generator.ts](./src/generator.ts) or [jsonSchemaGenerator.ts](./src/jsonSchemaGenerator.ts).

2. **Implement your changes**:

   - Add new functions or modify existing ones in the relevant module.
   - For example, to add a new schema type, define it in [creator.ts](./src/creator.ts) and update the corresponding type definitions in [type.ts](./src/type.ts).

3. **Update exports**:

   - Ensure your new functions or types are exported in [index.ts](./src/index.ts) so they are accessible to other packages and modules.

4. **Write tests**:

   - Add unit tests for your new functionality to ensure it works as intended. Place your tests in the appropriate test files or create new ones if necessary.

5. **Run tests**:
   - Use the monorepo's testing framework to run all tests and verify that your changes do not introduce regressions.

By following these steps, you can effectively contribute to the `@typeagent/action-schema` package and expand its functionality to meet additional requirements.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)

### Dependencies

Workspace: _None._

External: `debug`, `typescript`

### Used by

- [@typeagent/action-browser](../../tools/actionBrowser/README.md)
- [@typeagent/action-grammar](../../packages/actionGrammar/README.md)
- [@typeagent/action-grammar-compiler](../../packages/actionGrammarCompiler/README.md)
- [@typeagent/action-schema-compiler](../../packages/actionSchemaCompiler/README.md)
- [@typeagent/core](../../packages/typeagent-core/README.md)
- [agent-cache](../../packages/cache/README.md)
- [agent-cli](../../packages/cli/README.md)
- [agent-dispatcher](../../packages/dispatcher/dispatcher/README.md)
- [agent-sdk-wrapper](../../packages/agentSdkWrapper/README.md)
- [browser-typeagent](../../packages/agents/browser/README.md)
- _…and 6 more workspace consumers._

### Files of interest

`./src/index.ts`, `./src/creator.ts`, `./src/generator.ts`, …and 12 more under `./src/`.

---

_Auto-generated against commit `5c9fc637c2f0a96d75d41a3bc9054d06247d26d8` on `2026-07-15T08:50:41.068Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/action-schema docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

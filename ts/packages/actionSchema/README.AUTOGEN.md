<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=1025d8e50def5f0e48e90a54ba5b7fd8130880a0e19c32a422c39e39bc6c69ff -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/action-schema — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/action-schema` package is a TypeScript library that provides tools for parsing, generating, and validating schemas for TypeAgent actions. It plays a critical role in the TypeAgent ecosystem by enabling the definition and enforcement of structured action schemas, which are essential for ensuring consistency and correctness across various components.

## What it does

The primary purpose of this package is to handle action schemas, which define the structure and constraints of actions within the TypeAgent framework. Its key functionalities include:

- **Parsing Action Schemas**: Extract schema definitions from TypeScript source files using functions like `parseActionSchemaSource` and `parseSchemaSource`.
- **Schema Generation**: Create schema definitions from TypeScript types with utilities such as `generateActionSchema` and `generateSchemaTypeDefinition`.
- **JSON Schema Support**: Convert TypeScript schemas to JSON schemas and vice versa using functions like `generateActionJsonSchema` and `parseToolsJsonSchema`.
- **Validation**: Ensure that actions conform to their defined schemas with the `validateAction` function.
- **Serialization**: Serialize and deserialize parsed action schemas using `toJSONParsedActionSchema` and `fromJSONParsedActionSchema`.

These features make the package a foundational component for managing and enforcing schema definitions in TypeAgent-based projects. It is also a dependency for several other packages in the TypeAgent monorepo, such as `@typeagent/action-grammar`, `@typeagent/action-grammar-compiler`, and `@typeagent/core`.

## Setup

To use the `@typeagent/action-schema` package, you need to install it along with its external dependencies. Run the following command to install the package and its required dependencies:

```sh
pnpm install @typeagent/action-schema debug typescript
```

The package does not require any additional setup, such as environment variables or external services. For further details, refer to the hand-written README.

## Key Files

The `@typeagent/action-schema` package is organized into several key modules, each responsible for specific aspects of schema handling:

- **[index.ts](./src/index.ts)**: The main entry point of the package. It exports all the core types and functions, including schema parsing, generation, validation, and serialization utilities.
- **[creator.ts](./src/creator.ts)**: Provides functions to create schema types, such as `string`, `number`, `boolean`, and more complex types like `array` and `object`. This is the starting point for defining new schema types.
- **[generator.ts](./src/generator.ts)**: Contains logic for generating schema definitions from TypeScript types. It also supports generating JSON schemas.
- **[jsonSchemaGenerator.ts](./src/jsonSchemaGenerator.ts)**: Focuses on converting TypeScript schema definitions into JSON schemas. It includes utilities like `wrapTypeWithJsonSchema` for integrating JSON schema structures.
- **[jsonSchemaParser.ts](./src/jsonSchemaParser.ts)**: Handles the reverse process of parsing JSON schemas and converting them into TypeScript schema definitions.
- **[parser.ts](./src/parser.ts)**: Implements functions to parse TypeScript source files and extract schema definitions. This is a critical module for integrating TypeScript-based schemas into the TypeAgent ecosystem.
- **[schemaConfig.ts](./src/schemaConfig.ts)**: Defines configuration types for schema parsing and generation, such as `ParamSpec` and `SchemaConfig`.
- **[type.ts](./src/type.ts)**: Contains the core type definitions used throughout the package, including `SchemaType`, `SchemaObjectField`, and `SchemaTypeDefinition`.

## How to extend

To extend the functionality of the `@typeagent/action-schema` package, follow these steps:

1. **Identify the area to extend**:

   - If you need to add new schema types, start with [creator.ts](./src/creator.ts).
   - For new parsing capabilities, modify or extend [parser.ts](./src/parser.ts).
   - To enhance schema generation, work with [generator.ts](./src/generator.ts) or [jsonSchemaGenerator.ts](./src/jsonSchemaGenerator.ts).

2. **Implement your changes**:

   - Add new functions or modify existing ones in the relevant module.
   - For example, to add a new schema type, define it in [creator.ts](./src/creator.ts) and update the corresponding type definitions in [type.ts](./src/type.ts).

3. **Update exports**:

   - Ensure that your new functions or types are exported in [index.ts](./src/index.ts) so they are accessible to other packages and modules.

4. **Write tests**:

   - Add unit tests for your new functionality to ensure it works as expected. Place your tests in the appropriate test files or create new ones if necessary.

5. **Run tests**:
   - Use the testing framework configured for the monorepo to run all tests and verify that your changes do not introduce regressions.

By following these steps, you can contribute to the `@typeagent/action-schema` package and enhance its capabilities to better suit your project's needs.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/index.js` _(not found on disk)_

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

_Auto-generated against commit `366aaf867a7e8e5d130b6c87a365516bab725269` on `2026-07-07T09:05:05.703Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/action-schema docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

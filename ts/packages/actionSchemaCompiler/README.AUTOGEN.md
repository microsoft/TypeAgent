<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=9112ad03347ce5df75330c17a27772cc2a6349a0c3e86ea9fa85aca1a399599b -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/action-schema-compiler — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/action-schema-compiler` package is a TypeScript library designed to preprocess action schemas authored in TypeScript. It compiles these schemas into a JSON format known as `ParsedActionSchemaGroup`, which can be loaded by the dispatcher to avoid runtime TypeScript compilation.

## What it does

This package provides a command-line tool that processes TypeScript action schema files and outputs them in a JSON format. The main capabilities include:

- Parsing TypeScript action schema definitions.
- Generating a `ParsedActionSchemaGroup` JSON file.
- Loading schema configurations from JSON files.

The primary actions supported by this package are related to compiling and parsing action schemas, such as `compileActionSchema`.

## Setup

To set up the `@typeagent/action-schema-compiler` package, ensure you have the necessary dependencies installed. The package relies on `@oclif/core` and `@oclif/plugin-help` for command-line functionality.

1. Install the package dependencies:

   ```sh
   pnpm install
   ```

2. Ensure you have the required schema configuration files in JSON format alongside your TypeScript schema files.

For detailed setup instructions, see the hand-written README.

## Key Files

The package's architecture revolves around the command-line tool defined in [index.ts](./src/index.ts). Key components include:

- **Command Definition**: The `Compile` class extends `Command` from `@oclif/core` and defines the command-line interface for compiling action schemas.
- **Schema Parsing**: Functions like `parseActionSchemaSource` and `toJSONParsedActionSchema` from `@typeagent/action-schema` are used to parse and convert the schema.
- **Configuration Loading**: The `getSchemaConfig` function loads schema configuration from JSON files.

The TypeScript configuration is managed by [tsconfig.json](./src/tsconfig.json), which extends the base configuration and specifies compilation options.

## How to extend

To extend the functionality of the `@typeagent/action-schema-compiler` package, follow these steps:

1. **Add New Commands**: Start by adding new command classes in [index.ts](./src/index.ts). Extend the `Command` class from `@oclif/core` and define the necessary flags and logic.
2. **Modify Schema Parsing**: If you need to change how schemas are parsed, update the functions imported from `@typeagent/action-schema` or add new parsing logic.
3. **Update Configuration Handling**: Enhance the `getSchemaConfig` function to support additional configuration formats or validation.

After making changes, run the existing tests or add new ones to ensure your modifications work as expected.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

_No public exports declared in `package.json`._

### Dependencies

Workspace:

- [@typeagent/action-schema](../../packages/actionSchema/README.md)

External: `@oclif/core`, `@oclif/plugin-help`

### Used by

- [browser-typeagent](../../packages/agents/browser/README.md)
- [calendar](../../packages/agents/calendar/README.md)
- [code-agent](../../packages/agents/code/README.md)
- [desktop-automation](../../packages/agents/desktop/README.md)
- [discord-agent](../../packages/agents/discord/README.md)
- [email](../../packages/agents/email/README.md)
- [github-cli-agent](../../packages/agents/github-cli/README.md)
- [image-agent](../../packages/agents/image/README.md)
- [list-agent](../../packages/agents/list/README.md)
- [music](../../packages/agents/player/README.md)
- _…and 14 more workspace consumers._

### Files of interest

`./src/index.ts`, `./src/tsconfig.json`.

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T19:00:56.375Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/action-schema-compiler docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

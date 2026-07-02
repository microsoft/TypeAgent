<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=80f5acce55ae2813e3bd7ef2a1a710d654026eddbb1ef038879535a527255036 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/action-grammar-compiler — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `action-grammar-compiler` package is a TypeScript library that provides a command-line interface (CLI) for compiling and formatting `.agr` (Action Grammar) files. It leverages the `action-grammar` library for parsing and serialization, and uses the `oclif` framework to handle command parsing and execution.

## What it does

The package offers two primary commands:

- `compile`: Converts `.agr` grammar files into `.ag.json` format. This involves parsing the `.agr` file, handling any errors or warnings, and serializing the parsed grammar into JSON.
- `format`: Pretty-prints `.agr` grammar files, similar to how `prettier` works for JavaScript. It can format files in-place, check formatting for CI purposes, or write formatted output to a different file.

These commands are accessible via two CLI entry points: `agc` for production use and `agc-dev` for development use with a `ts-node` loader.

## Setup

To use the `action-grammar-compiler` package, you need to install it along with its dependencies. The package provides two CLI binaries:

- `agc` for production
- `agc-dev` for development

You can install the package and its dependencies using `pnpm install`. For detailed setup instructions, refer to the hand-written README.

## Key Files

The package is structured as a thin CLI wrapper around the `action-grammar` library. The main components are:

- [index.ts](./src/index.ts): Exports the `COMMANDS` object for oclif's command registration.
- [compile.ts](./src/commands/compile.ts): Implements the `compile` command, which parses and serializes `.agr` files into `.ag.json` format.
- [format.ts](./src/commands/format.ts): Implements the `format` command, which pretty-prints `.agr` files.

### Command Flow

#### Compile Command

1. **Input**: `.agr` file
2. **Parsing**: Uses `loadGrammarRulesNoThrow()` from `action-grammar` to parse the file.
3. **Error Handling**: Reports any errors or warnings; exits with code 1 on parse failure.
4. **Serialization**: Uses `grammarToJson()` to serialize the parsed grammar into JSON.
5. **Output**: Writes the `.ag.json` file, creating directories as needed.

#### Format Command

1. **Input**: `.agr` file
2. **Parsing**: Uses `parseGrammarRules()` from `action-grammar` to parse the file.
3. **Formatting**: Uses `writeGrammarRules()` to produce canonical formatting.
4. **Output**: Writes or checks the output based on the provided flags.

## How to extend

To extend the `action-grammar-compiler` package, follow these steps:

1. **Add a new command**:

   - Create a new file in the `src/commands` directory.
   - Implement the command using the `oclif` framework.
   - Register the command in the `COMMANDS` object in [index.ts](./src/index.ts).

2. **Modify existing commands**:

   - Open the relevant command file (e.g., [compile.ts](./src/commands/compile.ts) or [format.ts](./src/commands/format.ts)).
   - Make the necessary changes to the command implementation.
   - Ensure that any new functionality integrates with the `action-grammar` library as needed.

3. **Testing**:
   - Write unit tests for your new or modified commands.
   - Run the tests to ensure that your changes work as expected.

By following these steps, you can extend the functionality of the `action-grammar-compiler` package to meet your specific needs.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

_No public exports declared in `package.json`._

### Dependencies

Workspace:

- [@typeagent/action-grammar](../../packages/actionGrammar/README.md)
- [@typeagent/action-schema](../../packages/actionSchema/README.md)

External: `@oclif/core`, `@oclif/plugin-help`

### Used by

- [browser-typeagent](../../packages/agents/browser/README.md)
- [calendar](../../packages/agents/calendar/README.md)
- [code-agent](../../packages/agents/code/README.md)
- [desktop-automation](../../packages/agents/desktop/README.md)
- [discord-agent](../../packages/agents/discord/README.md)
- [github-cli-agent](../../packages/agents/github-cli/README.md)
- ipconfig-agent
- [list-agent](../../packages/agents/list/README.md)
- [music](../../packages/agents/player/README.md)
- [music-local](../../packages/agents/playerLocal/README.md)
- _…and 9 more workspace consumers._

### Files of interest

`./src/index.ts`, `./src/commands/compile.ts`, `./src/commands/format.ts`, …and 1 more under `./src/`.

---

_Auto-generated against commit `127a36a95a15e918be533d6eaaf08adebe9070d9` on `2026-06-26T03:01:52.873Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/action-grammar-compiler docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

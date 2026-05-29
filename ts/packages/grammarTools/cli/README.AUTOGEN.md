<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=4cf459231ac51b819a72178d78c56fd55c771852887c6937dd2d9cc9e61089d1 -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# grammar-tools-cli — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `grammar-tools-cli` package is a TypeScript library that provides a command-line interface (CLI) for grammar exploration, completion preview, and trace visualization. It leverages functionalities from the `grammar-tools-core` package to perform various grammar-related operations, making it a useful tool for developers working with grammar files.

## What it does

The `grammar-tools-cli` package offers several commands to interact with grammar files:

- `load`: Validates a grammar file.
- `complete`: Previews completions for a given input based on the grammar.
- `format`: Formats a grammar file.
- `trace`: Traces matcher execution on a given input.
- `coverage`: Computes coverage against a corpus file.
- `diff`: Diffs two grammar files to highlight differences.
- `collisions`: Analyzes grammar collisions within a directory.

These commands can output results in a human-readable format or as JSON for machine processing. The CLI is designed to facilitate various grammar-related tasks, making it easier to manage and analyze grammar files.

## Setup

To set up the `grammar-tools-cli` package, follow these steps:

1. Install dependencies:

   ```sh
   pnpm install
   ```

2. Ensure the `grammar-tools-core` package is correctly linked in the workspace.

For detailed setup instructions, refer to the hand-written README.

## Key Files

The `grammar-tools-cli` package is structured around a single entry point: [cli.ts](./src/cli.ts). This file defines the CLI commands and their respective handlers. The package imports various functions from `grammar-tools-core` to perform the actual grammar operations.

Key files:

- [cli.ts](./src/cli.ts): Main entry point for the CLI, defines command handling and usage instructions.
- [analyzeCollisions.ts](./src/analyzeCollisions.ts): Implements the `collisions` command to analyze grammar collisions.
- [tsconfig.json](./src/tsconfig.json): TypeScript configuration for the package.

The [cli.ts](./src/cli.ts) file is responsible for parsing command-line arguments, invoking the appropriate functions from `grammar-tools-core`, and handling the output format (either human-readable or JSON).

## How to extend

To extend the `grammar-tools-cli` package, follow these steps:

1. Open [cli.ts](./src/cli.ts) to understand the existing command structure and handlers.
2. Add new commands or modify existing ones by importing necessary functions from `grammar-tools-core`.
3. Ensure new commands are documented in the usage instructions within [cli.ts](./src/cli.ts).
4. Test your changes thoroughly to ensure they work as expected.

To run tests, use the following command:

```sh
pnpm test
```

By following these steps, you can effectively extend the functionality of the `grammar-tools-cli` package.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

_No public exports declared in `package.json`._

### Dependencies

Workspace:

- [action-grammar](../../../packages/actionGrammar/README.md)
- grammar-tools-core

External: _None at runtime._

### Files of interest

`./src/analyzeCollisions.ts`, `./src/cli.ts`, `./src/tsconfig.json`.

---

_Auto-generated against commit `bc2dc7df084977bc3da24a9398fd3a08d55c3e7e` on `2026-05-29T04:54:39.413Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter grammar-tools-cli docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

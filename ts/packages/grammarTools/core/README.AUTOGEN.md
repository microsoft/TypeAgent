<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=f51f205a920f2085507590971dd81534f04695124088d26daaebc90b18eb6c74 -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# grammar-tools-core — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `grammar-tools-core` package provides framework-agnostic grammar language services for TypeAgent `.agr` grammars. It serves as the core library for handling grammar-related operations, including parsing, formatting, diffing, and more. This package is utilized by other packages such as `agr-language`, `grammar-tools-cli`, and `grammar-tools-ui`.

## What it does

`grammar-tools-core` offers a variety of services for working with `.agr` grammars. These services include:

- **Completion**: Provides suggestions for completing partial inputs based on a loaded grammar (`previewCompletion`).
- **Coverage**: Computes coverage reports by running a corpus of inputs against a grammar (`computeCoverage`).
- **Diff**: Computes structural differences between two grammars, identifying added, removed, or changed rules (`diffGrammars`).
- **Formatting**: Formats raw `.agr` source strings (`format`).
- **Trace Formatting**: Formats match traces into human-readable strings suitable for debugging (`formatTrace`).
- **Loading**: Loads grammars from file paths on disk (`loadGrammarFromFile`).
- **Symbol Indexing**: Builds a symbol index for a loaded grammar from its source files (`getSymbolIndex`).

## Setup

To use `grammar-tools-core`, ensure you have the necessary dependencies installed. The package primarily depends on `action-grammar`. No additional environment variables or external accounts are required.

For detailed setup instructions, see the hand-written README.

## Key Files

The package is structured into several key files, each responsible for different aspects of grammar handling:

- **[index.ts](./src/index.ts)**: The main entry point, exporting types and services.
- **[completion.ts](./src/completion.ts)**: Handles completion suggestions for partial inputs.
- **[coverage.ts](./src/coverage.ts)**: Computes coverage reports for grammars.
- **[diff.ts](./src/diff.ts)**: Computes structural differences between grammars.
- **[format.ts](./src/format.ts)**: Formats raw `.agr` source strings.
- **[formatTrace.ts](./src/formatTrace.ts)**: Formats match traces for debugging.
- **[loader.ts](./src/loader.ts)**: Loads grammars from file paths.
- **[symbols.ts](./src/symbols.ts)**: Builds symbol indexes for grammars.

### Detailed File Responsibilities

- **[index.ts](./src/index.ts)**: Exports types and error classes, and aggregates services from other files.
- **[completion.ts](./src/completion.ts)**: Implements the `previewCompletion` function, wrapping the `matchGrammarCompletion` API from `action-grammar` to provide UI-ready completion suggestions.
- **[coverage.ts](./src/coverage.ts)**: Implements the `computeCoverage` function, running a corpus of inputs against a grammar and returning hit counts for rules and parts.
- **[diff.ts](./src/diff.ts)**: Implements the `diffGrammars` function, computing structural differences between two grammars and reporting added, removed, or changed rules.
- **[format.ts](./src/format.ts)**: Implements the `format` function, formatting raw `.agr` source strings.
- **[formatTrace.ts](./src/formatTrace.ts)**: Implements the `formatTrace` function, formatting match traces into human-readable strings.
- **[loader.ts](./src/loader.ts)**: Implements the `loadGrammarFromFile` function, loading grammars from file paths on disk.
- **[symbols.ts](./src/symbols.ts)**: Implements the `getSymbolIndex` function, building a symbol index for a loaded grammar from its source files.

## How to extend

To extend `grammar-tools-core`, follow these steps:

1. **Identify the area to extend**: Determine which service or functionality you need to enhance or add.
2. **Open the relevant file**: Based on the functionality, open the corresponding file (e.g., `completion.ts` for completion-related features).
3. **Follow existing patterns**: Review the existing code to understand the patterns and structures used. For example, if adding a new service, ensure it follows the same structure as other services.
4. **Implement your changes**: Add your new functionality, ensuring it integrates well with the existing codebase.
5. **Write tests**: Add tests for your new functionality to ensure it works as expected. Place tests in the appropriate test files or create new ones if necessary.
6. **Run tests**: Execute the tests to verify your changes. Ensure all tests pass before submitting your changes.

By following these steps, you can effectively extend the capabilities of `grammar-tools-core`.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)

### Dependencies

Workspace:

- [action-grammar](../../../packages/actionGrammar/README.md)

External: _None at runtime._

### Used by

- [agr-language](../../../extensions/agr-language/README.md)
- grammar-tools-cli
- grammar-tools-ui

### Files of interest

`./src/index.ts`, `./src/completion.ts`, `./src/coverage.ts`, …and 8 more under `./src/`.

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T09:44:26.515Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter grammar-tools-core docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

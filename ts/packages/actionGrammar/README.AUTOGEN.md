<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=6bdf546c48ec4b6d3d860deabd6889ee932cbc3cc05e99a7f74662d8c342b517 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# action-grammar — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `action-grammar` package is a TypeScript library that provides a grammar engine for the TypeAgent framework. It parses, compiles, and matches natural language input against predefined grammar rules to produce structured JSON action objects. This allows user utterances to be converted into typed actions that can be processed by agents.

## What it does

The package supports defining grammar rules in `.agr` files, a custom DSL designed for natural language processing. These rules can include literals, wildcards, alternation, optionals, repetition, rule references, imports, and entity declarations. The main functionalities include:

- **Parsing**: Converting `.agr` files into an Abstract Syntax Tree (AST) using `parseGrammarRules`.
- **Compilation**: Transforming the AST into an in-memory `Grammar` representation with `compileGrammar`.
- **Matching**: Two matching backends are available:
  - **Recursive backtracking matcher** (`matchGrammar`): Operates directly on the `Grammar` AST.
  - **NFA/DFA pipeline** (`compileGrammarToNFA`, `matchNFA`, `compileNFAToDFA`, `matchDFA`): Compiles grammar to a token-based NFA and optionally further to a DFA for faster matching.

The package also includes utilities for grammar serialization, dynamic loading, and entity management.

## Setup

To use the `action-grammar` package, ensure you have the following dependencies installed:

- `@anthropic-ai/claude-agent-sdk`
- `debug`
- `dotenv`
- `regexp.escape`

You can install these dependencies using `pnpm install`. For detailed setup instructions, refer to the hand-written README.

## Key Files

The package is structured into several key components:

- **Parsing and Compilation**:

  - [grammarRuleParser.ts](./src/grammarRuleParser.ts): Parses `.agr` files into AST.
  - [grammarCompiler.ts](./src/grammarCompiler.ts): Compiles AST into in-memory `Grammar`.

- **Matching**:

  - [grammarMatcher.ts](./src/grammarMatcher.ts): Implements recursive backtracking matcher.
  - [nfaCompiler.ts](./src/nfaCompiler.ts): Compiles `Grammar` to NFA.
  - [nfaInterpreter.ts](./src/nfaInterpreter.ts): Executes NFA with parallel threads.
  - [dfaCompiler.ts](./src/dfaCompiler.ts): Converts NFA to DFA.
  - [dfaMatcher.ts](./src/dfaMatcher.ts): Implements DFA-based matching.

- **Entity Management**:

  - [entityRegistry.ts](./src/entityRegistry.ts): Manages entities with validators and converters.
  - [builtInEntities.ts](./src/builtInEntities.ts): Provides built-in entity converters.

- **Dynamic Loading**:

  - [dynamicGrammarLoader.ts](./src/dynamicGrammarLoader.ts): Handles runtime rule loading and validation.

- **Utilities**:
  - [grammarRuleWriter.ts](./src/grammarRuleWriter.ts): Pretty-prints grammar rules.
  - [grammarOptimizer.ts](./src/grammarOptimizer.ts): Provides optimization utilities for grammar.

## How to extend

To extend the `action-grammar` package, follow these steps:

1. **Add new grammar rules**:

   - Create or modify `.agr` files with new rules.
   - Use `parseGrammarRules` to parse the new rules into AST.

2. **Implement custom matchers or optimizers**:

   - Extend existing matchers in [grammarMatcher.ts](./src/grammarMatcher.ts) or [dfaMatcher.ts](./src/dfaMatcher.ts).
   - Add new optimization passes in [grammarOptimizer.ts](./src/grammarOptimizer.ts).

3. **Add new entities**:

   - Define new entities in [entityRegistry.ts](./src/entityRegistry.ts).
   - Implement converters and validators for the new entities.

4. **Test your changes**:
   - Write unit tests for new functionalities.
   - Run benchmarks using scripts in the `bench` directory, such as [dfaBenchmark.ts](./src/bench/dfaBenchmark.ts).

For a starting point, open [grammarRuleParser.ts](./src/grammarRuleParser.ts) to understand the parsing logic, and [grammarMatcher.ts](./src/grammarMatcher.ts) for matching logic. Ensure all changes are thoroughly tested before integration.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)
- `./completion` → [./dist/completion.js](./dist/completion.js)
- `./rules` → [./dist/indexRules.js](./dist/indexRules.js)
- `./generation` → [./dist/generation/index.js](./dist/generation/index.js)

### Dependencies

Workspace:

- [@typeagent/action-schema](../../packages/actionSchema/README.md)
- [@typeagent/config](../../packages/config/README.md)

External: `@anthropic-ai/claude-agent-sdk`, `debug`, `dotenv`, `regexp.escape`

### Used by

- [action-grammar-compiler](../../packages/actionGrammarCompiler/README.md)
- [agent-cache](../../packages/cache/README.md)
- [agent-cli](../../packages/cli/README.md)
- [agent-dispatcher](../../packages/dispatcher/dispatcher/README.md)
- [agent-sdk-wrapper](../../packages/agentSdkWrapper/README.md)
- [default-agent-provider](../../packages/defaultAgentProvider/README.md)
- grammar-tools-cli
- grammar-tools-core

### Files of interest

- [./src/generation/index.ts](./src/generation/index.ts)
- [./src/index.ts](./src/index.ts)
- [./src/agentGrammarRegistry.ts](./src/agentGrammarRegistry.ts)
- [./src/bench/benchUtil.ts](./src/bench/benchUtil.ts)
- [./src/bench/dfaBenchmark.ts](./src/bench/dfaBenchmark.ts)
- [./src/bench/grammarOptimizerBenchmark.ts](./src/bench/grammarOptimizerBenchmark.ts)
- [./src/bench/grammarOptimizerSyntheticBenchmark.ts](./src/bench/grammarOptimizerSyntheticBenchmark.ts)
- [./src/builtInEntities.agr](./src/builtInEntities.agr)
- [./src/builtInEntities.ts](./src/builtInEntities.ts)
- [./src/builtInFileLoader.ts](./src/builtInFileLoader.ts)
- _…and 54 more under `./src/`._

---

_Auto-generated against commit `bc2dc7df084977bc3da24a9398fd3a08d55c3e7e` on `2026-05-29T04:54:39.349Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter action-grammar docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=1148c7524cfe271d07d32f8b882330b8fd6b3e2f2212a2ef50ec4e9d72b54423 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/action-grammar — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/action-grammar` package is a TypeScript library that provides a grammar engine for the TypeAgent framework. It enables the parsing, compilation, and matching of natural language input against grammar rules defined in `.agr` files. These rules allow user utterances to be converted into structured JSON action objects, which can then be processed by other components in the TypeAgent ecosystem.

This package is a core dependency for several other TypeAgent packages, such as `@typeagent/core`, `@typeagent/action-grammar-compiler`, and `agent-cli`. It supports both rule-based and machine learning-assisted approaches to grammar generation and matching, making it a versatile tool for natural language understanding.

## What it does

The primary purpose of `@typeagent/action-grammar` is to process natural language input and match it against predefined grammar rules to generate structured actions. These actions are represented as JSON objects, such as:

```json
{
  "actionName": "play",
  "parameters": {
    "track": "Shape of You",
    "artist": "Ed Sheeran"
  }
}
```

### Key Features

1. **Grammar Parsing**:

   - Parses `.agr` files written in a custom domain-specific language (DSL) for defining natural language grammar rules.
   - The DSL supports constructs such as literals, wildcards, alternation, optionals, repetition, rule references, imports, and entity declarations.
   - The `parseGrammarRules` function converts `.agr` files into an Abstract Syntax Tree (AST).

2. **Grammar Compilation**:

   - The `compileGrammar` function transforms parsed grammar rules into an optimized in-memory `Grammar` representation.

3. **Matching**:

   - Two matching backends are available:
     - **Recursive Backtracking Matcher**: Operates directly on the `Grammar` AST and supports complex patterns with wildcards and nested rules.
     - **NFA/DFA Pipeline**: Compiles grammar into a token-based Non-deterministic Finite Automaton (NFA) and optionally further into a Deterministic Finite Automaton (DFA) for faster matching.

4. **Entity Management**:

   - Provides an entity system for defining and managing entities such as dates, times, and numbers.
   - Entities can be used within grammar rules to capture and validate specific types of input.

5. **Dynamic Grammar Loading**:

   - Supports runtime loading and caching of grammar rules, enabling dynamic updates to the grammar.

6. **Grammar Generation**:

   - Includes tools for generating grammar rules from schemas and examples using large language models (LLMs) like Claude.

7. **Collision Analysis**:
   - Provides utilities for detecting and resolving overlaps between grammar rules.

## Setup

To use the `@typeagent/action-grammar` package, follow these steps:

1. Install the package and its dependencies:

   ```bash
   pnpm install
   ```

2. Ensure the following external dependencies are installed in your project:

   - `@anthropic-ai/claude-agent-sdk`
   - `debug`
   - `dotenv`
   - `regexp.escape`

3. If additional setup steps are required, refer to the hand-written README for further details.

## Key Files

The package is organized into several key files, each responsible for specific functionality:

### Parsing and Compilation

- [grammarRuleParser.ts](./src/grammarRuleParser.ts): Implements a recursive descent parser for `.agr` files, converting them into an AST.
- [grammarCompiler.ts](./src/grammarCompiler.ts): Compiles the AST into an in-memory `Grammar` representation.
- [grammarTypes.ts](./src/grammarTypes.ts): Defines types for both in-memory and serialized grammar representations.

### Matching

- [grammarMatcher.ts](./src/grammarMatcher.ts): Implements the recursive backtracking matcher for grammar rules.
- [nfaCompiler.ts](./src/nfaCompiler.ts): Compiles `Grammar` into a token-based NFA.
- [nfaInterpreter.ts](./src/nfaInterpreter.ts): Executes the NFA with parallel threads and priority-based result selection.
- [dfaCompiler.ts](./src/dfaCompiler.ts): Converts NFA to DFA using subset construction.
- [dfaMatcher.ts](./src/dfaMatcher.ts): Implements DFA-based matching for faster performance.

### Entity Management

- [entityRegistry.ts](./src/entityRegistry.ts): Manages entities, including their validators and converters.
- [builtInEntities.ts](./src/builtInEntities.ts): Provides built-in entity converters for common types like dates, times, and ordinals.

### Dynamic Loading

- [dynamicGrammarLoader.ts](./src/dynamicGrammarLoader.ts): Handles runtime loading and validation of grammar rules.

### Utilities

- [grammarRuleWriter.ts](./src/grammarRuleWriter.ts): Provides utilities for pretty-printing grammar rules.
- [grammarOptimizer.ts](./src/grammarOptimizer.ts): Includes optimization utilities for grammar rules.

### Benchmarks

- [dfaBenchmark.ts](./src/bench/dfaBenchmark.ts): Benchmarks DFA vs. NFA performance for various grammars.
- [grammarOptimizerBenchmark.ts](./src/bench/grammarOptimizerBenchmark.ts): Measures the impact of grammar optimization passes.
- [grammarOptimizerSyntheticBenchmark.ts](./src/bench/grammarOptimizerSyntheticBenchmark.ts): Tests synthetic grammars designed to stress specific optimizations.

## How to extend

To extend the `@typeagent/action-grammar` package, you can follow these steps:

1. **Add or Modify Grammar Rules**:

   - Create or update `.agr` files with new rules.
   - Use `parseGrammarRules` to parse the new rules into an AST.
   - Compile the rules into a `Grammar` object using `compileGrammar`.

2. **Implement Custom Matchers or Optimizers**:

   - Extend existing matchers in [grammarMatcher.ts](./src/grammarMatcher.ts) or [dfaMatcher.ts](./src/dfaMatcher.ts).
   - Add new optimization passes in [grammarOptimizer.ts](./src/grammarOptimizer.ts).

3. **Define New Entities**:

   - Add new entity definitions in [entityRegistry.ts](./src/entityRegistry.ts).
   - Implement converters and validators for the new entities.

4. **Enhance Dynamic Loading**:

   - Modify [dynamicGrammarLoader.ts](./src/dynamicGrammarLoader.ts) to support additional runtime loading scenarios.

5. **Test Your Changes**:
   - Write unit tests for any new functionality.
   - Use the benchmark scripts in the `bench` directory to evaluate performance impacts.

For new contributors, a good starting point is [grammarRuleParser.ts](./src/grammarRuleParser.ts) to understand how `.agr` files are parsed, and [grammarMatcher.ts](./src/grammarMatcher.ts) for the matching logic. Be sure to follow the existing patterns and conventions in the codebase.

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
- [@typeagent/common-utils](../../packages/utils/commonUtils/README.md)
- [@typeagent/config](../../packages/config/README.md)

External: `@anthropic-ai/claude-agent-sdk`, `debug`, `dotenv`, `regexp.escape`

### Used by

- [@typeagent/action-browser](../../tools/actionBrowser/README.md)
- [@typeagent/action-grammar-compiler](../../packages/actionGrammarCompiler/README.md)
- [@typeagent/core](../../packages/typeagent-core/README.md)
- [agent-cache](../../packages/cache/README.md)
- [agent-cli](../../packages/cli/README.md)
- [agent-dispatcher](../../packages/dispatcher/dispatcher/README.md)
- [agent-sdk-wrapper](../../packages/agentSdkWrapper/README.md)
- [default-agent-provider](../../packages/defaultAgentProvider/README.md)
- grammar-tools-cli
- grammar-tools-core
- _…and 1 more workspace consumers._

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
- _…and 57 more under `./src/`._

---

_Auto-generated against commit `d71a4baa2697f70bb62c315e67827ecc1ef19e9f` on `2026-07-22T16:16:20.408Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/action-grammar docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

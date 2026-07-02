<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=9a8fbd291a20b37f81d17f56946d34190618dd77f86e631698f205189293a71c -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/action-grammar — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/action-grammar` package is a TypeScript library that provides a grammar engine for the TypeAgent framework. It enables parsing, compiling, and matching natural language input against grammar rules defined in `.agr` files. These rules are used to convert user input, such as natural language commands, into structured JSON action objects that can be processed by agents.

This package is a core component of the TypeAgent ecosystem and is used by several other packages, including `@typeagent/core`, `@typeagent/action-grammar-compiler`, and `agent-cli`.

## What it does

The primary purpose of this package is to process natural language input and match it against predefined grammar rules to produce structured actions. These actions are represented as JSON objects with a specific structure, such as:

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

   - The package parses `.agr` files, which are written in a custom domain-specific language (DSL) designed for defining natural language grammar rules. These rules can include constructs like literals, wildcards, alternation, optionals, repetition, rule references, imports, and entity declarations.
   - The `parseGrammarRules` function converts `.agr` files into an Abstract Syntax Tree (AST).

2. **Grammar Compilation**:

   - The parsed grammar rules are compiled into an in-memory `Grammar` representation using the `compileGrammar` function. This representation is optimized for efficient matching.

3. **Matching**:

   - The package provides two matching backends:
     - **Recursive Backtracking Matcher**: Operates directly on the `Grammar` AST and supports complex patterns with wildcards and nested rules.
     - **NFA/DFA Pipeline**: Compiles grammar into a token-based Non-deterministic Finite Automaton (NFA) and optionally further into a Deterministic Finite Automaton (DFA) for faster matching.

4. **Entity Management**:

   - The package includes an entity system for defining and managing entities such as dates, times, and numbers. These entities can be used within grammar rules to capture and validate specific types of input.

5. **Dynamic Grammar Loading**:

   - The package supports dynamic loading and caching of grammar rules at runtime, enabling flexible and efficient updates to the grammar.

6. **Grammar Generation**:
   - The package includes tools for generating grammar rules from schemas and examples using large language models (LLMs) like Claude.

## Setup

To use the `@typeagent/action-grammar` package, ensure the following dependencies are installed in your project:

- `@anthropic-ai/claude-agent-sdk`
- `debug`
- `dotenv`
- `regexp.escape`

You can install these dependencies using `pnpm install`. If additional setup steps are required, refer to the hand-written README for detailed instructions.

## Key Files

The package is organized into several key components, each responsible for specific functionality:

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

To extend the functionality of the `@typeagent/action-grammar` package, follow these steps:

1. **Add New Grammar Rules**:

   - Create or modify `.agr` files with new rules.
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

For contributors new to the package, a good starting point is [grammarRuleParser.ts](./src/grammarRuleParser.ts) to understand how `.agr` files are parsed, and [grammarMatcher.ts](./src/grammarMatcher.ts) for the matching logic. Be sure to follow the existing patterns and conventions in the codebase.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/index.js` _(not found on disk)_
- `./completion` → `./dist/completion.js` _(not found on disk)_
- `./rules` → `./dist/indexRules.js` _(not found on disk)_
- `./generation` → `./dist/generation/index.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/action-schema](../../packages/actionSchema/README.md)
- [@typeagent/common-utils](../../packages/utils/commonUtils/README.md)
- [@typeagent/config](../../packages/config/README.md)

External: `@anthropic-ai/claude-agent-sdk`, `debug`, `dotenv`, `regexp.escape`

### Used by

- [@typeagent/action-grammar-compiler](../../packages/actionGrammarCompiler/README.md)
- [@typeagent/core](../../packages/typeagent-core/README.md)
- [agent-cache](../../packages/cache/README.md)
- [agent-cli](../../packages/cli/README.md)
- [agent-dispatcher](../../packages/dispatcher/dispatcher/README.md)
- [agent-sdk-wrapper](../../packages/agentSdkWrapper/README.md)
- [default-agent-provider](../../packages/defaultAgentProvider/README.md)
- grammar-tools-cli
- grammar-tools-core
- [snips-bench](../../examples/snipsBench/README.md)

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
- _…and 56 more under `./src/`._

---

_Auto-generated against commit `ff379b098decfab4eb45f78b6fa318358d7fbd75` on `2026-07-01T09:05:58.471Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/action-grammar docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=69ad43fa98ea127d7483ce4c6d26e20125f29ec9c23f9d4ac2a6b34662e421ee -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/action-grammar — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/action-grammar` package is a TypeScript library that serves as the grammar engine for the TypeAgent framework. It processes natural language input by parsing and matching it against grammar rules defined in `.agr` files, which are written in a custom domain-specific language (DSL). The result is a structured JSON action object that can be consumed by other components in the TypeAgent ecosystem.

This package is a foundational part of the TypeAgent system and is utilized by various other packages, such as `@typeagent/core`, `@typeagent/action-grammar-compiler`, and `agent-cli`.

## What it does

The primary function of this package is to convert natural language input into structured JSON actions by matching the input against grammar rules. These rules are defined in `.agr` files, which support a rich set of features, including:

- **Literals**: Match exact words or phrases.
- **Wildcards**: Capture arbitrary input.
- **Alternation**: Match one of several options.
- **Optionals**: Allow parts of a rule to be optional.
- **Repetition**: Match repeated patterns.
- **Rule References**: Reuse rules within other rules.
- **Imports**: Include rules from other `.agr` files.
- **Entity Declarations**: Define and validate specific types of input, such as dates or numbers.

### Key Features

1. **Grammar Parsing**:

   - Parses `.agr` files into an Abstract Syntax Tree (AST) using the `parseGrammarRules` function.

2. **Grammar Compilation**:

   - Converts the parsed AST into an optimized in-memory `Grammar` representation using `compileGrammar`.

3. **Matching**:

   - Supports two matching backends:
     - **Recursive Backtracking Matcher**: Operates directly on the `Grammar` AST, suitable for complex patterns.
     - **NFA/DFA Pipeline**: Compiles grammar into a Non-deterministic Finite Automaton (NFA) and optionally into a Deterministic Finite Automaton (DFA) for faster matching.

4. **Entity Management**:

   - Provides a system for defining and managing entities like dates, times, and numbers, which can be used within grammar rules.

5. **Dynamic Grammar Loading**:

   - Enables runtime loading and caching of grammar rules for dynamic updates.

6. **Grammar Generation**:

   - Includes tools for generating grammar rules from schemas and examples using large language models (LLMs) like Claude.

7. **Collision Analysis**:
   - Detects and resolves overlapping grammar rules to ensure unambiguous matching.

## Setup

To get started with `@typeagent/action-grammar`, follow these steps:

1. **Install the package**:

   ```bash
   pnpm install
   ```

2. **Ensure external dependencies are installed**:

   - `@anthropic-ai/claude-agent-sdk`
   - `debug`
   - `dotenv`
   - `regexp.escape`

3. **Environment Configuration**:
   - If additional setup is required, refer to the hand-written README for details.

## Key Files

The package is organized into several key files, each responsible for specific functionality:

### Parsing and Compilation

- [grammarRuleParser.ts](./src/grammarRuleParser.ts): Parses `.agr` files into an AST.
- [grammarCompiler.ts](./src/grammarCompiler.ts): Compiles the AST into an in-memory `Grammar` representation.
- [grammarTypes.ts](./src/grammarTypes.ts): Defines types for in-memory and serialized grammar representations.

### Matching

- [grammarMatcher.ts](./src/grammarMatcher.ts): Implements the recursive backtracking matcher.
- [nfaCompiler.ts](./src/nfaCompiler.ts): Compiles `Grammar` into a token-based NFA.
- [nfaInterpreter.ts](./src/nfaInterpreter.ts): Executes the NFA with parallel threads and priority-based result selection.
- [dfaCompiler.ts](./src/dfaCompiler.ts): Converts NFA to DFA for faster matching.
- [dfaMatcher.ts](./src/dfaMatcher.ts): Implements DFA-based matching.

### Entity Management

- [entityRegistry.ts](./src/entityRegistry.ts): Manages entities, including validators and converters.
- [builtInEntities.ts](./src/builtInEntities.ts): Provides built-in entity converters for common types like dates and numbers.

### Dynamic Loading

- [dynamicGrammarLoader.ts](./src/dynamicGrammarLoader.ts): Handles runtime loading and validation of grammar rules.

### Utilities

- [grammarRuleWriter.ts](./src/grammarRuleWriter.ts): Provides utilities for pretty-printing grammar rules.
- [grammarOptimizer.ts](./src/grammarOptimizer.ts): Includes optimization utilities for grammar rules.

### Benchmarks

- [dfaBenchmark.ts](./src/bench/dfaBenchmark.ts): Benchmarks DFA vs. NFA performance.
- [grammarOptimizerBenchmark.ts](./src/bench/grammarOptimizerBenchmark.ts): Measures the impact of grammar optimization passes.

## How to extend

To extend the functionality of `@typeagent/action-grammar`, follow these steps:

1. **Add or Modify Grammar Rules**:

   - Create or update `.agr` files with new rules.
   - Use `parseGrammarRules` to parse the rules into an AST.
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
   - Write unit tests for new functionality.
   - Use benchmark scripts in the `bench` directory to evaluate performance impacts.

For new contributors, a good starting point is [grammarRuleParser.ts](./src/grammarRuleParser.ts) to understand how `.agr` files are parsed, and [grammarMatcher.ts](./src/grammarMatcher.ts) for the matching logic. Follow the existing patterns and conventions in the codebase to ensure consistency.

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

_Auto-generated against commit `c05d6b3db71921fcd7c869c99c733420352f4145` on `2026-07-28T05:29:45.865Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/action-grammar docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

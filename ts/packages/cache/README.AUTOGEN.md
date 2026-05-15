<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=88de2560c339c76edc3e2e3be768ea7f2d2aab9b9a549cfb943d098d24bdfc3a -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# agent-cache — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `agent-cache` package is a TypeScript library designed to manage the construction cache for TypeAgent requests. It facilitates the caching of parsed grammar and rules derived from user requests, enabling local translations of user requests without relying on the LLM (Large Language Model). This package is essential for optimizing the performance and efficiency of TypeAgent by reducing the dependency on external LLM services.

## What it does

The `agent-cache` package provides functionalities to explain how user requests are transformed into actions and to create constructions that can be cached. These constructions are used to perform translations of user requests locally, bypassing the LLM. The package supports multiple explainers, each with its own validator and construction creator, allowing for exploration of changes to the explainer prompt and schema.

Key actions supported by the package include:

- `createMessage`: Creates a message based on user input.
- `explainRequest`: Explains how a user request is transformed into an action.
- `cacheConstruction`: Caches the construction derived from the explanation.
- `loadConstructionCacheFile`: Loads a construction cache file for use.

These actions enable the creation, explanation, caching, and loading of constructions, respectively.

## Setup

To set up the `agent-cache` package, ensure you have the necessary environment variables and dependencies configured. The package relies on several internal and external dependencies, including `async`, `chalk`, `debug`, `regexp.escape`, and `typechat`.

For detailed setup instructions, including environment variables and configuration steps, refer to the hand-written README.

## Key Files

The `agent-cache` package is organized into several key components:

- **Cache**: Manages the construction cache, including loading and storing constructions. Key files include [cache.ts](./src/cache/cache.ts), [constructionStore.ts](./src/cache/constructionStore.ts), and [grammarStore.ts](./src/cache/grammarStore.ts).
- **Explanation**: Handles the explanation of user requests and the creation of constructions. Key files include [explainerFactories.ts](./src/explanation/explainerFactories.ts), [genericExplainer.ts](./src/explanation/genericExplainer.ts), and [schemaInfoProvider.ts](./src/explanation/schemaInfoProvider.ts).
- **Constructions**: Defines the structure and management of constructions. Key files include [constructionCache.ts](./src/constructions/constructionCache.ts), [constructionJSONTypes.ts](./src/constructions/constructionJSONTypes.ts), and [matchPart.ts](./src/constructions/matchPart.ts).
- **Grammar**: Converts constructions to grammar and manages grammar matching. Key files include [exportGrammar.ts](./src/grammar/exportGrammar.ts) and [grammarStore.ts](./src/cache/grammarStore.ts).

### Key Files and Their Responsibilities

- [index.ts](./src/index.ts): Main entry point, exporting types and functionalities.
- [indexBrowser.ts](./src/indexBrowser.ts): Browser-specific entry point, exporting constructions and match parts.
- [indexGrammar.ts](./src/indexGrammar.ts): Grammar-specific entry point, exporting grammar conversion functionalities.
- [cache.ts](./src/cache/cache.ts): Manages the construction cache, including loading and storing constructions.
- [constructionStore.ts](./src/cache/constructionStore.ts): Handles the storage and retrieval of constructions.
- [explainWorkQueue.ts](./src/cache/explainWorkQueue.ts): Manages the work queue for processing explanations.
- [factory.ts](./src/cache/factory.ts): Provides factory methods for creating explainers and caches.
- [grammarStore.ts](./src/cache/grammarStore.ts): Manages grammar storage and matching.

## How to extend

To extend the `agent-cache` package, follow these steps:

### Adding a new explainer

1. Locate the list of supported explainers in [explainerFactories.ts](./src/explanation/explainerFactories.ts).
2. Create a new explainer by cloning an existing one. For example, to create `v5` from `v4`:
   - Copy the code and schemas from `explanationV4.ts`, `explanationSchemaV4.ts`, and `actionExplanationSchemaV4.ts` to new files with `V5` suffix.
   - Rename all `V4` suffixes in the new files to `V5`.
   - Add the new explainer to `explainerFactories.ts` by adding a new entry in the `explainerFactories` array.
   - Use `@config explainer v5` in the CLI or shell to start using the new explainer.

### Modifying existing components

- To modify the cache management, start with [cache.ts](./src/cache/cache.ts) and [constructionStore.ts](./src/cache/constructionStore.ts).
- To update the explanation logic, refer to [genericExplainer.ts](./src/explanation/genericExplainer.ts) and [schemaInfoProvider.ts](./src/explanation/schemaInfoProvider.ts).
- For changes to constructions, look into [constructionCache.ts](./src/constructions/constructionCache.ts) and [matchPart.ts](./src/constructions/matchPart.ts).
- To adjust grammar handling, review [exportGrammar.ts](./src/grammar/exportGrammar.ts) and [grammarStore.ts](./src/cache/grammarStore.ts).

### Testing

Ensure that any new or modified components are thoroughly tested. The package relies on the `test-lib` dependency for testing utilities. Run tests to verify the functionality and integration of your changes.

By following these steps, you can effectively extend and customize the `agent-cache` package to meet your specific requirements. For more detailed instructions and examples, refer to the hand-written README.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)
- default → [./dist/indexBrowser.js](./dist/indexBrowser.js)
- `./grammar` → [./dist/indexGrammar.js](./dist/indexGrammar.js)

### Dependencies

Workspace:

- [@typeagent/action-schema](../../packages/actionSchema/README.md)
- [@typeagent/agent-sdk](../../packages/agentSdk/README.md)
- [@typeagent/common-utils](../../packages/utils/commonUtils/README.md)
- [action-grammar](../../packages/actionGrammar/README.md)
- [aiclient](../../packages/aiclient/README.md)
- [telemetry](../../packages/telemetry/README.md)
- [test-lib](../../packages/testLib/README.md)
- [typechat-utils](../../packages/utils/typechatUtils/README.md)

External: `async`, `chalk`, `debug`, `regexp.escape`, `typechat`

### Used by

- [agent-api](../../packages/api/README.md)
- [agent-cache-explorer](../../packages/cacheExplorer/README.md)
- [agent-cli](../../packages/cli/README.md)
- [agent-dispatcher](../../packages/dispatcher/dispatcher/README.md)
- [agent-sdk-wrapper](../../packages/agentSdkWrapper/README.md)
- [cache-rest-endpoint](../../examples/cacheRESTEndpoint/README.md)
- [default-agent-provider](../../packages/defaultAgentProvider/README.md)
- [desktop-automation](../../packages/agents/desktop/README.md)
- [schema-studio](../../examples/schemaStudio/README.md)

### Files of interest

- [./src/index.ts](./src/index.ts)
- [./src/cache/cache.ts](./src/cache/cache.ts)
- [./src/cache/constructionStore.ts](./src/cache/constructionStore.ts)
- [./src/cache/explainWorkQueue.ts](./src/cache/explainWorkQueue.ts)
- [./src/cache/factory.ts](./src/cache/factory.ts)
- [./src/cache/grammarStore.ts](./src/cache/grammarStore.ts)
- [./src/cache/sortMatches.ts](./src/cache/sortMatches.ts)
- [./src/cache/types.ts](./src/cache/types.ts)
- [./src/constructions/constructionCache.ts](./src/constructions/constructionCache.ts)
- [./src/constructions/constructionJSONTypes.ts](./src/constructions/constructionJSONTypes.ts)
- _…and 35 more under `./src/`._

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T19:00:56.375Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter agent-cache docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

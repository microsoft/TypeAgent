<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=b42435ca613716fa1637eddeef14179024f5d890c02b1440af384e697b150d60 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# agent-cache — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `agent-cache` package is a TypeScript library that provides a construction cache for TypeAgent requests. It enables efficient local processing of user requests by caching parsed grammar and rules derived from these requests. This reduces the dependency on external Large Language Models (LLMs) for request translation, improving performance and reducing latency.

## What it does

The primary purpose of the `agent-cache` package is to optimize the handling of user requests by caching "constructions" — parsed grammar and rules derived from user inputs. These constructions allow the system to process similar requests locally without repeatedly querying an LLM. This is achieved through the following key functionalities:

- **Explanation**: The package can explain how a user request is transformed into an action using the `explainRequest` action. This explanation is used to generate constructions.
- **Caching**: Constructions derived from explanations are cached using the `cacheConstruction` action. This allows for efficient reuse of previously processed requests.
- **Local Translation**: Cached constructions are used to perform local translations of user requests, bypassing the need for LLM interaction.
- **Loading and Managing Cache**: The `loadConstructionCacheFile` action allows loading pre-existing construction cache files, while other utilities manage the storage and retrieval of cached constructions.

The package supports multiple explainers, each with its own validator and construction creator. This modularity allows for experimentation with different explainer prompts and schemas to optimize the translation process.

## Setup

The `agent-cache` package does not require extensive setup beyond installing its dependencies. However, it relies on several internal and external dependencies, including:

- Internal dependencies: `@typeagent/action-grammar`, `@typeagent/action-schema`, `@typeagent/agent-sdk`, `@typeagent/aiclient`, `@typeagent/common-utils`, `telemetry`, `test-lib`, and `typechat-utils`.
- External dependencies: `async`, `chalk`, `debug`, `regexp.escape`, and `typechat`.

Ensure that these dependencies are installed and properly configured in your development environment. For additional setup details, refer to the hand-written README.

## Key Files

The `agent-cache` package is organized into several key modules, each responsible for specific aspects of the caching and explanation process. Below is an overview of the key files and their responsibilities:

### Cache Management

- [cache.ts](./src/cache/cache.ts): Manages the construction cache, including loading and storing constructions.
- [constructionStore.ts](./src/cache/constructionStore.ts): Handles the storage and retrieval of constructions.
- [explainWorkQueue.ts](./src/cache/explainWorkQueue.ts): Manages the work queue for processing explanations.
- [factory.ts](./src/cache/factory.ts): Provides factory methods for creating explainers and caches.
- [grammarStore.ts](./src/cache/grammarStore.ts): Manages grammar storage and matching.
- [sortMatches.ts](./src/cache/sortMatches.ts): Implements sorting logic for matching results.
- [types.ts](./src/cache/types.ts): Defines types and interfaces for cache and grammar management.

### Explanation

- [explainerFactories.ts](./src/explanation/explainerFactories.ts): Maintains a registry of supported explainers and their configurations.
- [genericExplainer.ts](./src/explanation/genericExplainer.ts): Provides a generic implementation for explainers.
- [schemaInfoProvider.ts](./src/explanation/schemaInfoProvider.ts): Supplies schema-related information for explanations.

### Constructions

- [constructionCache.ts](./src/constructions/constructionCache.ts): Defines the structure and management of constructions.
- [constructionJSONTypes.ts](./src/constructions/constructionJSONTypes.ts): Specifies JSON types for serializing and deserializing constructions.
- [matchPart.ts](./src/constructions/matchPart.ts): Handles matching logic for construction parts.

### Grammar

- [exportGrammar.ts](./src/grammar/exportGrammar.ts): Converts constructions to grammar for local processing.
- [grammarStore.ts](./src/cache/grammarStore.ts): Manages grammar storage and matching.

### Entry Points

- [index.ts](./src/index.ts): Main entry point, exporting core types and functionalities.
- [indexBrowser.ts](./src/indexBrowser.ts): Browser-specific entry point, exporting constructions and match parts.
- [indexGrammar.ts](./src/indexGrammar.ts): Grammar-specific entry point, exporting grammar conversion functionalities.

## How to extend

The `agent-cache` package is designed to be extensible, allowing contributors to add new explainers, modify existing components, or enhance its functionality. Below are some guidelines for extending the package:

### Adding a New Explainer

1. **Clone an Existing Explainer**:

   - Navigate to the [./src/explanation](./src/explanation) directory.
   - Copy the code and schema files of an existing explainer (e.g., `explanationV4.ts`, `explanationSchemaV4.ts`, and `actionExplanationSchemaV4.ts`) and rename them with a new version suffix (e.g., `V5`).
   - Update all references to the old version (e.g., `V4`) in the new files to the new version (e.g., `V5`).

2. **Register the New Explainer**:

   - Add an entry for the new explainer in [explainerFactories.ts](./src/explanation/explainerFactories.ts).
   - Use the new explainer's name as the key and its factory function as the value.

3. **Activate the New Explainer**:
   - Use the CLI or shell command `@config explainer v5` to start using the new explainer.

### Modifying Existing Components

- **Cache Management**: To modify how constructions are cached, start with [cache.ts](./src/cache/cache.ts) and [constructionStore.ts](./src/cache/constructionStore.ts).
- **Explanation Logic**: To update how user requests are explained, refer to [genericExplainer.ts](./src/explanation/genericExplainer.ts) and [schemaInfoProvider.ts](./src/explanation/schemaInfoProvider.ts).
- **Constructions**: For changes to the structure or handling of constructions, look into [constructionCache.ts](./src/constructions/constructionCache.ts) and [matchPart.ts](./src/constructions/matchPart.ts).
- **Grammar Handling**: To adjust grammar-related functionalities, review [exportGrammar.ts](./src/grammar/exportGrammar.ts) and [grammarStore.ts](./src/cache/grammarStore.ts).

### Testing

- Use the `test-lib` dependency to write and run tests for any new or modified components.
- Ensure that all changes are thoroughly tested to maintain the package's reliability and functionality.

By following these guidelines, you can effectively extend and customize the `agent-cache` package to meet specific requirements. For additional details, refer to the hand-written README.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/index.js` _(not found on disk)_
- default → `./dist/indexBrowser.js` _(not found on disk)_
- `./grammar` → `./dist/indexGrammar.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/action-grammar](../../packages/actionGrammar/README.md)
- [@typeagent/action-schema](../../packages/actionSchema/README.md)
- [@typeagent/agent-sdk](../../packages/agentSdk/README.md)
- [@typeagent/aiclient](../../packages/aiclient/README.md)
- [@typeagent/common-utils](../../packages/utils/commonUtils/README.md)
- [telemetry](../../packages/telemetry/README.md)
- [test-lib](../../packages/testLib/README.md)
- [typechat-utils](../../packages/utils/typechatUtils/README.md)

External: `async`, `chalk`, `debug`, `regexp.escape`, `typechat`

### Used by

- [@typeagent/core](../../packages/typeagent-core/README.md)
- [agent-api](../../packages/api/README.md)
- [agent-cache-explorer](../../packages/cacheExplorer/README.md)
- [agent-cli](../../packages/cli/README.md)
- [agent-dispatcher](../../packages/dispatcher/dispatcher/README.md)
- [agent-sdk-wrapper](../../packages/agentSdkWrapper/README.md)
- [cache-rest-endpoint](../../examples/cacheRESTEndpoint/README.md)
- [default-agent-provider](../../packages/defaultAgentProvider/README.md)
- [desktop-automation](../../packages/agents/desktop/README.md)
- schema-studio

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

_Auto-generated against commit `ff379b098decfab4eb45f78b6fa318358d7fbd75` on `2026-07-01T09:05:58.471Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter agent-cache docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=b2de7573d833ba21a443dadc2495747c2616c8ed5ec05e5677117ed26f287760 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/memory-service — AI-generated documentation

> 📝 **Placeholder documentation — not yet AI-authored.** Re-run `pnpm docs:generate:llm --package memory-service` to populate this file, or read [`./README.md`](./README.md) for the hand-written documentation in the meantime. The deterministic Reference section below is already populated.

## Overview

Transport-independent memory corpus service

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)
- `./rpc` → [./dist/rpcFacade.js](./dist/rpcFacade.js)
- `./benchmark` → [./dist/benchmarkBridge.js](./dist/benchmarkBridge.js)
- `./performance-experiments` → [./dist/memoryPerformanceExperimentConfig.js](./dist/memoryPerformanceExperimentConfig.js)
- `./agent-edition-validation` → [./dist/agentEditionValidation.js](./dist/agentEditionValidation.js)
- `./procedure-markdown` → [./dist/procedureMarkdown.js](./dist/procedureMarkdown.js)
- `./procedureMarkdown` → [./dist/procedureMarkdown.js](./dist/procedureMarkdown.js)
- `./view-text` → [./dist/viewText.js](./dist/viewText.js)
- `./view-detail` → [./dist/viewDetail.js](./dist/viewDetail.js)
- `./view-types` → [./dist/viewTypes.js](./dist/viewTypes.js)
- `./view-packages` → [./dist/viewPackages.js](./dist/viewPackages.js)

### Dependencies

Workspace:

- [@typeagent/aiclient](../../../packages/aiclient/README.md)
- [@typeagent/common-utils](../../../packages/utils/commonUtils/README.md)
- [@typeagent/config](../../../packages/config/README.md)
- [@typeagent/conversation-memory](../../../packages/memory/conversation/README.md)
- [@typeagent/knowledge-processor](../../../packages/knowledgeProcessor/README.md)
- [@typeagent/knowpro](../../../packages/knowPro/README.md)
- [@typeagent/memory-storage](../../../packages/memory/storage/README.md)
- [@typeagent/textpro](../../../packages/textPro/README.md)

External: `isomorphic-git`, `node-diff3`, `proper-lockfile`, `typechat`

### Used by

- [@typeagent/benchmarks](../../../packages/benchmarks/README.md)
- [@typeagent/browser](../../../packages/agents/browser/README.md)
- [@typeagent/browser-control-rpc](../../../packages/agents/browserControlRpc/README.md)
- [@typeagent/memory-agent](../../../packages/agents/memory/README.md)
- [@typeagent/memory-client](../../../packages/memory/client/README.md)
- [@typeagent/memory-mcp-server](../../../packages/memory/mcp-server/README.md)
- [@typeagent/package-installation](../../../packages/packageInstallation/README.md)
- [@typeagent/procedure-artifacts](../../../packages/procedureArtifacts/README.md)
- [agent-dispatcher](../../../packages/dispatcher/dispatcher/README.md)
- [agent-server](../../../packages/agentServer/server/README.md)
- _…and 2 more workspace consumers._

### Files of interest

- [./src/indexSchema.ts](./src/indexSchema.ts)
- [./src/index.ts](./src/index.ts)
- [./src/acquisitionTypes.ts](./src/acquisitionTypes.ts)
- [./src/agentEdition.ts](./src/agentEdition.ts)
- [./src/agentEditionValidation.ts](./src/agentEditionValidation.ts)
- [./src/agentSessionDistillation.ts](./src/agentSessionDistillation.ts)
- [./src/agentSessionParsing.ts](./src/agentSessionParsing.ts)
- [./src/agentSessionStore.ts](./src/agentSessionStore.ts)
- [./src/agentSessionTypes.ts](./src/agentSessionTypes.ts)
- [./src/batchImport.ts](./src/batchImport.ts)
- _…and 124 more under `./src/`._

### Environment variables

_8 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `TYPEAGENT_BENCHMARK_COMMIT_DOCUMENTS`
- `TYPEAGENT_BENCHMARK_MAINTENANCE_MODE`
- `TYPEAGENT_BENCHMARK_MODEL`
- `TYPEAGENT_EMBEDDING_PROVIDER`
- `TYPEAGENT_MEMORY_FAST_MODEL`
- `TYPEAGENT_MEMORY_PERF_EXPERIMENTS`
- `TYPEAGENT_MEMORY_PREPARED_INDEXING`
- `TYPEAGENT_MEMORY_VIEW_MODEL_ENDPOINT`

---

_Auto-generated against commit `9d0c0c6135eb00ff717e8a30ef83acbb6dfe076c` on `2026-11-15T08:18:54.858Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/memory-service docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

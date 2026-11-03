<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=4a0ad52c2ba4de94d6ff8020c1fa4fc8bffd7b0d4930f2172323a8b34d122c54 -->
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
- `./agent-edition-validation` → [./dist/agentEditionValidation.js](./dist/agentEditionValidation.js)
- `./procedure-markdown` → [./dist/procedureMarkdown.js](./dist/procedureMarkdown.js)
- `./procedureMarkdown` → [./dist/procedureMarkdown.js](./dist/procedureMarkdown.js)
- `./view-text` → [./dist/viewText.js](./dist/viewText.js)

### Dependencies

Workspace:

- [@typeagent/aiclient](../../../packages/aiclient/README.md)
- [@typeagent/common-utils](../../../packages/utils/commonUtils/README.md)
- [@typeagent/config](../../../packages/config/README.md)
- [@typeagent/conversation-memory](../../../packages/memory/conversation/README.md)
- [@typeagent/knowledge-processor](../../../packages/knowledgeProcessor/README.md)
- [@typeagent/knowpro](../../../packages/knowPro/README.md)
- [@typeagent/textpro](../../../packages/textPro/README.md)

External: `isomorphic-git`, `node-diff3`, `proper-lockfile`, `typechat`

### Used by

- [@typeagent/benchmarks](../../../packages/benchmarks/README.md)
- [@typeagent/browser](../../../packages/agents/browser/README.md)
- [@typeagent/browser-control-rpc](../../../packages/agents/browserControlRpc/README.md)
- [@typeagent/memory-agent](../../../packages/agents/memory/README.md)
- [@typeagent/memory-client](../../../packages/memory/client/README.md)
- [@typeagent/memory-mcp-server](../../../packages/memory/mcp-server/README.md)
- [@typeagent/procedure-artifacts](../../../packages/procedureArtifacts/README.md)
- [agent-dispatcher](../../../packages/dispatcher/dispatcher/README.md)
- [agent-server](../../../packages/agentServer/server/README.md)

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
- _…and 110 more under `./src/`._

### Environment variables

_9 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `TYPEAGENT_BENCHMARK_COMMIT_DOCUMENTS`
- `TYPEAGENT_BENCHMARK_MAINTENANCE_MODE`
- `TYPEAGENT_BENCHMARK_MODEL`
- `TYPEAGENT_EMBEDDING_MODEL`
- `TYPEAGENT_EMBEDDING_PROVIDER`
- `TYPEAGENT_EMBEDDING_SIZE`
- `TYPEAGENT_MEMORY_FAST_MODEL`
- `TYPEAGENT_MEMORY_PERF_EXPERIMENTS`
- `TYPEAGENT_MEMORY_VIEW_MODEL_ENDPOINT`

---

_Auto-generated against commit `dfbb1dd26cd55181537e3d66daacfa5821e02f18` on `2026-11-01T08:18:02.889Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/memory-service docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

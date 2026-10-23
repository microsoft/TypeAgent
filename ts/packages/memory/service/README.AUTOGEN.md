<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=66fd8ef12fe26a3de13619dd803d0f156a0bdafeee98f8a38e83d8c7b2c5e791 -->
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
- `./agent-edition-validation` → [./dist/agentEditionValidation.js](./dist/agentEditionValidation.js)
- `./procedure-markdown` → [./dist/procedureMarkdown.js](./dist/procedureMarkdown.js)
- `./procedureMarkdown` → [./dist/procedureMarkdown.js](./dist/procedureMarkdown.js)
- `./view-text` → [./dist/viewText.js](./dist/viewText.js)

### Dependencies

Workspace:

- [@typeagent/aiclient](../../../packages/aiclient/README.md)
- [@typeagent/config](../../../packages/config/README.md)
- [@typeagent/conversation-memory](../../../packages/memory/conversation/README.md)
- [@typeagent/knowpro](../../../packages/knowPro/README.md)
- [@typeagent/textpro](../../../packages/textPro/README.md)

External: `isomorphic-git`, `node-diff3`, `proper-lockfile`, `typechat`

### Used by

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
- [./src/agentEdition.ts](./src/agentEdition.ts)
- [./src/agentEditionValidation.ts](./src/agentEditionValidation.ts)
- [./src/batchImport.ts](./src/batchImport.ts)
- [./src/boundedIngestionGroup.ts](./src/boundedIngestionGroup.ts)
- [./src/changeReceipts.ts](./src/changeReceipts.ts)
- [./src/corpusAccess.ts](./src/corpusAccess.ts)
- [./src/durableRunbookJson.ts](./src/durableRunbookJson.ts)
- [./src/eventSegmentStore.ts](./src/eventSegmentStore.ts)
- _…and 60 more under `./src/`._

### Environment variables

_1 environment variable referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `TYPEAGENT_MEMORY_VIEW_MODEL_ENDPOINT`

---

_Auto-generated against commit `78429ec5b77de3febc4f6d2ac9b640a83796a087` on `2026-10-19T22:57:12.751Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/memory-service docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

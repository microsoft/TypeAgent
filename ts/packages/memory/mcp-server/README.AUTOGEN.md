<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=f4868a8486e0ad1231ff913a39963c0ed3fe5dc9281469e86814c5678dc100d6 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/memory-mcp-server — AI-generated documentation

> 📝 **Placeholder documentation — not yet AI-authored.** Re-run `pnpm docs:generate:llm --package memory-mcp-server` to populate this file, or read [`./README.md`](./README.md) for the hand-written documentation in the meantime. The deterministic Reference section below is already populated.

## Overview

MCP transport adapter for the TypeAgent memory service

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/index.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/aiclient](../../../packages/aiclient/README.md)
- [@typeagent/config](../../../packages/config/README.md)
- [@typeagent/memory-client](../../../packages/memory/client/README.md)
- [@typeagent/memory-service](../../../packages/memory/service/README.md)

External: `@modelcontextprotocol/ext-apps`, `@modelcontextprotocol/sdk`, `zod`

### Used by

- [agent-server](../../../packages/agentServer/server/README.md)

### Files of interest

`./src/index.ts`, `./src/agentSessionTools.ts`, `./src/graphTools.ts`, …and 14 more under `./src/`.

### Environment variables

_3 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `TYPEAGENT_MEMORY_DIR`
- `TYPEAGENT_MEMORY_PREVIEWS`
- `TYPEAGENT_MEMORY_VIEW_MODEL_ENDPOINT`

---

_Auto-generated against commit `dfbb1dd26cd55181537e3d66daacfa5821e02f18` on `2026-11-01T08:18:02.889Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/memory-mcp-server docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

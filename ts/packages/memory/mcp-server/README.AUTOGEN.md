<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=069ad808fcc4af8633036bd0756ad50cbad9ec67b5cdccca4f718506b8f24196 -->
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

External: `@modelcontextprotocol/sdk`, `zod`

### Used by

- [agent-server](../../../packages/agentServer/server/README.md)

### Files of interest

`./src/index.ts`, `./src/memoryMcpServer.ts`, `./src/memoryServiceHost.ts`, …and 2 more under `./src/`.

### Environment variables

_1 environment variable referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `TYPEAGENT_MEMORY_DIR`

---

_Auto-generated against commit `698fc097c4b8743475487a6ec91e80c3a0ac4f25` on `2026-09-22T17:27:42.286Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/memory-mcp-server docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

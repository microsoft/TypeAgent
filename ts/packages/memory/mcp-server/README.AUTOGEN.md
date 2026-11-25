<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=456ed218b7930fa32a69026e70857470684637ffaa9ad6e5cdc355658ba90258 -->
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

`./src/index.ts`, `./src/agentSessionTools.ts`, `./src/frameTools.ts`, …and 15 more under `./src/`.

### Environment variables

_3 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `TYPEAGENT_MEMORY_DIR`
- `TYPEAGENT_MEMORY_PREVIEWS`
- `TYPEAGENT_MEMORY_VIEW_MODEL_ENDPOINT`

---

_Auto-generated against commit `9d0c0c6135eb00ff717e8a30ef83acbb6dfe076c` on `2026-11-15T08:18:54.858Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/memory-mcp-server docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

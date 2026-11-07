<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=5d6bc032c780985dda6d086e3f108bff4034f73e97fc8e10ed7f9f6063d35133 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/package-installation — AI-generated documentation

> 📝 **Placeholder documentation — not yet AI-authored.** Re-run `pnpm docs:generate:llm --package package-installation` to populate this file, or read [`./README.md`](./README.md) for the hand-written documentation in the meantime. The deterministic Reference section below is already populated.

## Overview

Shared npm acquisition and memory-view package lifecycle

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/memoryViewPackages.js](./dist/memoryViewPackages.js)
- `./mcp-types` → [./dist/mcpTypes.js](./dist/mcpTypes.js)
- `./sources/*` → `./dist/sources/*.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/common-utils](../../packages/utils/commonUtils/README.md)
- [@typeagent/memory-service](../../packages/memory/service/README.md)

External: `debug`, `proper-lockfile`, `semver`

### Used by

- [default-agent-provider](../../packages/defaultAgentProvider/README.md)

### Files of interest

- [./src/mcpTypes.ts](./src/mcpTypes.ts)
- [./src/memoryViewPackages.ts](./src/memoryViewPackages.ts)
- [./src/sources/catalogSource.ts](./src/sources/catalogSource.ts)
- [./src/sources/config.ts](./src/sources/config.ts)
- [./src/sources/feedAuth.ts](./src/sources/feedAuth.ts)
- [./src/sources/feedSource.ts](./src/sources/feedSource.ts)
- [./src/sources/packageMeta.ts](./src/sources/packageMeta.ts)
- [./src/sources/paths.ts](./src/sources/paths.ts)
- [./src/sources/pathSource.ts](./src/sources/pathSource.ts)
- [./src/sources/registry.ts](./src/sources/registry.ts)
- _…and 1 more under `./src/`._

### Environment variables

_3 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `TYPEAGENT_FEED_DISCOVERY_REGISTRIES`
- `TYPEAGENT_FEED_REGISTRY`
- `TYPEAGENT_FEED_SCOPES`

---

_Auto-generated against commit `662fa5fd25f07909786f77858a7f46d4cb298388` on `2026-11-07T04:05:42.641Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/package-installation docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

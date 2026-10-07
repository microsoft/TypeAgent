<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=f24bc3fe16266fe0eb8a00bde439024365f97792ff2336a8eb3fd854b635fee5 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# git-story — AI-generated documentation

> 📝 **Placeholder documentation — not yet AI-authored.** Re-run `pnpm docs:generate:llm --package git-story` to populate this file, or read [`./README.md`](./README.md) for the hand-written documentation in the meantime. The deterministic Reference section below is already populated.

## Overview

Attach agent session stories to git commits

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

_No public exports declared in `package.json`._

### Dependencies

Workspace:

- [@typeagent/agent-harness-hooks](../../packages/agent-harness-hooks/README.md)
- [@typeagent/conversation-memory](../../packages/memory/conversation/README.md)

External: `@hono/node-server`, `commander`, `hono`, `tirith`, `zod`

### Files of interest

`./src/server/routes/daemonApiHandler.ts`, `./src/server/routes/sessionsApiHandler.ts`, `./src/server/routes/storyCommitsApiHandler.ts`, …and 31 more under `./src/`.

### Environment variables

_3 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `GIT_STORY_ADAPTER`
- `GIT_STORY_COPILOT_HOME`
- `GIT_STORY_STATE_DIR`

---

_Auto-generated against commit `1bf6503cb5d677c90339f54e7b8f920b3c559e43` on `2026-10-06T19:49:12.309Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter git-story docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

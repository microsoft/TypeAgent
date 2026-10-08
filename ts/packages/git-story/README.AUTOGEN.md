<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=1ebb9b0b7f8b3afc495dadf7d658a98cd115a300aec9afa95d63f6b6c58ae6b9 -->
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

`./src/server/routes/daemonApiHandler.ts`, `./src/server/routes/sessionsApiHandler.ts`, `./src/server/routes/storyCommitsApiHandler.ts`, …and 32 more under `./src/`.

### Environment variables

_3 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `GIT_STORY_ADAPTER`
- `GIT_STORY_COPILOT_HOME`
- `GIT_STORY_STATE_DIR`

---

_Auto-generated against commit `a6feb4ed73292b6ed4bcfa6d7baa42ae3226a1ff` on `2026-10-08T05:34:04.069Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter git-story docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

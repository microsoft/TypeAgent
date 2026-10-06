<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=50c83eb9a6eecadf48891b44d0e14ef51fa67229e3c141a1239a2d287ce6cd4b -->
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

External: `@hono/node-server`, `commander`, `hono`, `tirith`, `zod`

### Files of interest

`./src/server/routes/daemonApiHandler.ts`, `./src/server/routes/sessionsApiHandler.ts`, `./src/server/routes/storyCommitsApiHandler.ts`, …and 29 more under `./src/`.

### Environment variables

_3 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `GIT_STORY_ADAPTER`
- `GIT_STORY_COPILOT_HOME`
- `GIT_STORY_STATE_DIR`

---

_Auto-generated against commit `c1e0705511b1c745b87cdbb31f169aa35f38735a` on `2026-10-06T09:47:10.588Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter git-story docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

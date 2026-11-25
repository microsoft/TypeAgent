<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=f716e9b2f84312da9114c0f7e2c30857f28976395311d99443c88c420831160a -->
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

`./src/server/routes/daemonApiHandler.ts`, `./src/server/routes/sessionsApiHandler.ts`, `./src/server/routes/storyCommitsApiHandler.ts`, …and 33 more under `./src/`.

### Environment variables

_3 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `GIT_STORY_ADAPTER`
- `GIT_STORY_COPILOT_HOME`
- `GIT_STORY_STATE_DIR`

---

_Auto-generated against commit `b3c4e608c6280955b07f16043cd6cb938cee1ef3` on `2026-10-08T07:49:20.478Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter git-story docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

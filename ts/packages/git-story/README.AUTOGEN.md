<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=eb5ffbbaac40ce322a98d1b95dd23b1ee3e97a4194c40a315f10897a9b51d1ae -->
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

_Auto-generated against commit `6ca443dd8dcff0c82180eae8a16c9991ad4dff9d` on `2026-10-07T01:59:13.101Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter git-story docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

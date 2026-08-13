<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=5a55c28e63f390d00bd7ba8647105949c204baf5b55c0398a6bb95c977465e49 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/benchmarks — AI-generated documentation

> 📝 **Placeholder documentation — not yet AI-authored.** Re-run `pnpm docs:generate:llm --package benchmarks` to populate this file, or read [`./README.md`](./README.md) for the hand-written documentation in the meantime. The deterministic Reference section below is already populated.

## Overview

TypeAgent translation bench: catalog, action-parameters grader, simple-action dataset synthesizer

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/index.js` _(not found on disk)_
- `./translationBench` → `./dist/translationBench/index.js` _(not found on disk)_
- `./internal` → `./dist/index.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/action-schema](../../packages/actionSchema/README.md)
- [@typeagent/agent-sdk](../../packages/agentSdk/README.md)
- [@typeagent/aiclient](../../packages/aiclient/README.md)
- [agent-dispatcher](../../packages/dispatcher/dispatcher/README.md)
- [default-agent-provider](../../packages/defaultAgentProvider/README.md)

External: `commander`, `js-yaml`, `zod`

### Used by

_None._

### Files of interest

- [./src/index.ts](./src/index.ts)
- [./src/translationBench/index.ts](./src/translationBench/index.ts)
- [./src/translationBench/synthesizer/catalogGenerator/index.ts](./src/translationBench/synthesizer/catalogGenerator/index.ts)
- [./src/translationBench/synthesizer/goldSchema.ts](./src/translationBench/synthesizer/goldSchema.ts)
- [./src/translationBench/synthesizer/index.ts](./src/translationBench/synthesizer/index.ts)
- [./src/core/model-prices.generated.json](./src/core/model-prices.generated.json)
- [./src/core/paths.ts](./src/core/paths.ts)
- [./src/core/prices.ts](./src/core/prices.ts)
- [./src/core/rateLimiter.ts](./src/core/rateLimiter.ts)
- [./src/core/types.ts](./src/core/types.ts)
- _…and 36 more under `./src/`._

---

_Auto-generated against commit `f74ed3ce0a3e0edee3262495549cb41f30e944af` on `2026-08-13T08:06:45.967Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/benchmarks docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

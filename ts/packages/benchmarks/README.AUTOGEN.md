<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=0a814b1f3f9f34d1efba2399fae7343843b9fbd3506cefac433038d42e39c4ba -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/benchmarks — AI-generated documentation

> 📝 **Placeholder documentation — not yet AI-authored.** Re-run `pnpm docs:generate:llm --package benchmarks` to populate this file, or read [`./README.md`](./README.md) for the hand-written documentation in the meantime. The deterministic Reference section below is already populated.

## Overview

TypeAgent translation and conversation-memory benchmarks

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
- [@typeagent/memory-service](../../packages/memory/service/README.md)
- [agent-dispatcher](../../packages/dispatcher/dispatcher/README.md)
- [default-agent-provider](../../packages/defaultAgentProvider/README.md)

External: `commander`, `gpt-tokenizer`, `hyparquet`, `js-yaml`, `zod`

### Used by

_None._

### Files of interest

- [./src/index.ts](./src/index.ts)
- [./src/translationBench/index.ts](./src/translationBench/index.ts)
- [./src/translationBench/policy/index.ts](./src/translationBench/policy/index.ts)
- [./src/translationBench/public_datasets/Seal-Tools/index.ts](./src/translationBench/public_datasets/Seal-Tools/index.ts)
- [./src/translationBench/public_datasets/Seal-Tools/toTypeAgentSchema.ts](./src/translationBench/public_datasets/Seal-Tools/toTypeAgentSchema.ts)
- [./src/translationBench/synthesizer/catalogGenerator/index.ts](./src/translationBench/synthesizer/catalogGenerator/index.ts)
- [./src/translationBench/synthesizer/goldSchema.ts](./src/translationBench/synthesizer/goldSchema.ts)
- [./src/translationBench/synthesizer/index.ts](./src/translationBench/synthesizer/index.ts)
- [./src/core/fileJson.ts](./src/core/fileJson.ts)
- [./src/core/model-prices.generated.json](./src/core/model-prices.generated.json)
- _…and 83 more under `./src/`._

### Environment variables

_1 environment variable referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `TB_PICKER_MODEL`

---

_Auto-generated against commit `2aa994c086fa18c9bd62cd60d0b62e431d82b60d` on `2026-10-27T18:11:07.641Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/benchmarks docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

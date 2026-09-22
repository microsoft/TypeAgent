<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=ae26280caa235a7344e478bf6b286fab1d3a77a56c62e2374a19a9e9b00cd40d -->
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

External: `commander`, `gpt-tokenizer`, `js-yaml`, `zod`

### Used by

_None._

### Files of interest

- [./src/index.ts](./src/index.ts)
- [./src/translationBench/index.ts](./src/translationBench/index.ts)
- [./src/translationBench/policy/index.ts](./src/translationBench/policy/index.ts)
- [./src/translationBench/synthesizer/catalogGenerator/index.ts](./src/translationBench/synthesizer/catalogGenerator/index.ts)
- [./src/translationBench/synthesizer/goldSchema.ts](./src/translationBench/synthesizer/goldSchema.ts)
- [./src/translationBench/synthesizer/index.ts](./src/translationBench/synthesizer/index.ts)
- [./src/core/fileJson.ts](./src/core/fileJson.ts)
- [./src/core/model-prices.generated.json](./src/core/model-prices.generated.json)
- [./src/core/paths.ts](./src/core/paths.ts)
- [./src/core/prices.ts](./src/core/prices.ts)
- _…and 68 more under `./src/`._

---

_Auto-generated against commit `f91ce5a8ac8c035dddb8c0bf0c3e0447584b36dd` on `2026-09-22T20:43:08.408Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/benchmarks docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

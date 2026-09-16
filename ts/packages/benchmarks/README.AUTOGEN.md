<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=440891bcc3b192173caa15e6a81fe1d2e77982361882c93553c368ccb547b6da -->
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
- `./translationBench/runner` → `./dist/translationBench/runner/index.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/action-schema](../../packages/actionSchema/README.md)
- [@typeagent/agent-cache](../../packages/cache/README.md)
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
- [./src/translationBench/public_datasets/Seal-Tools/index.ts](./src/translationBench/public_datasets/Seal-Tools/index.ts)
- [./src/translationBench/public_datasets/Seal-Tools/toTypeAgentSchema.ts](./src/translationBench/public_datasets/Seal-Tools/toTypeAgentSchema.ts)
- [./src/translationBench/runner/index.ts](./src/translationBench/runner/index.ts)
- [./src/translationBench/synthesizer/goldSchema.ts](./src/translationBench/synthesizer/goldSchema.ts)
- [./src/translationBench/synthesizer/index.ts](./src/translationBench/synthesizer/index.ts)
- [./src/core/model-prices.generated.json](./src/core/model-prices.generated.json)
- [./src/core/paths.ts](./src/core/paths.ts)
- _…and 85 more under `./src/`._

### Environment variables

_12 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `LITELLM_API_KEY`
- `LITELLM_BASE_URL`
- `LOCAL_LITELLM_API_KEY`
- `LOCAL_LITELLM_OPENAI_BASE_URL`
- `OPENAI_API_KEY`
- `OPENAI_ENDPOINT`
- `OPENAI_MODEL`
- `OPENAI_MODEL_WIRE_API`
- `SEAL_CASE_IDS`
- `SEAL_MAX_CASES`
- `SEAL_MODELS`
- `TYPEAGENT_MODEL_PROVIDER`

---

_Auto-generated against commit `f2d4868e2ec60055f4b2a6fd8dce29e8b1290e06` on `2026-09-16T20:55:29.410Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/benchmarks docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

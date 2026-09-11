# @typeagent/benchmarks — agent notes

## Layout

- `src/core/` — domain-agnostic infrastructure.
  - `rateLimiter.ts` — cross-process tokens-per-minute limiter (shared SQLite).
  - `tokenEstimate.ts` — model-agnostic prompt token estimate for reservations.
- `src/translationBench/`
  - `runConfig.ts` + `config.schema.json` — pure JSON run-config loader/resolver.
  - `synthesizer/` — dataset generation, quality gates, negative fairness.
  - `runner/` — suite execution, scoring, checkpoints, reports, explainer.
  - `policy/` — eligible-gold allowlist + action quality picker.
  - `scripts/tbEval.ts`, `scripts/tbGenerate.ts` — thin production CLIs.
- Assets (`config.schema.json`, prompt packs) are copied to `dist/` by
  `scripts/copyAssets.mjs` during build.

## Config: JSON + commander, no `TB_*` env

Run configuration is a JSON file validated by `config.schema.json`. Runtime
overrides are **commander flags**, prop-drilled into the library — do not read
`process.env.TB_*`.

```bash
# eval (requires a pre-approved artifact; never auto-approves)
node dist/translationBench/scripts/tbEval.js \
  --draft ./artifacts/benchmark-draft-1000.jsonl \
  --approved ./artifacts/benchmark-approved-1000.jsonl \
  --config ./run-config.json \
  --batch eval

# generate
node dist/translationBench/scripts/tbGenerate.js \
  --source ./source/anchors.jsonl \
  --manifest ./source/source-manifest.json \
  --config ./run-config.json \
  --batch synthesizer
```

`tb-eval` refuses to mint `approval.status: "approved"` and fails when draft
content drifts from the approved file. See
`src/translationBench/config/run-config.example.json`.

## Credential env boundary

`OPENAI_*` / `AZURE_*` env is the `@typeagent/aiclient` contract
(`initRuntimeConfigFromProcessEnv()`) and is intentionally kept.

## TPM rate limiter

`createRateLimiter(tpmLimits, { dbPath, estTokensPerCall, maxWaitMs?, onWait? })`
requires `dbPath`. Concurrent `run()` calls reserve tokens against the shared
SQLite ledger over a rolling 60s window and settle to actual usage.

## Runner library

Import via package subpath (not star-exported from the main barrel — names
overlap synthesizer checkpoint helpers):

```ts
import {
  runTranslationBench,
  scoreTranslationBench,
} from "@typeagent/benchmarks/translationBench/runner";
```

Callers own dispatcher bootstrap (`initializeCommandHandlerContext`). The runner
only crosses into agent-dispatcher at `translateRequest`.

## local/ is gitignored

Scratch run artifacts stay under `local/` (gitignored). Committed code lives
under `src/`.

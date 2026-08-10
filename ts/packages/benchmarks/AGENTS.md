# @typeagent/benchmarks — agent notes

## Layout

- `src/core/` — domain-agnostic infrastructure. `rateLimiter.ts` is a
  cross-process tokens-per-minute limiter backed by a shared SQLite ledger.
  `tokenEstimate.ts` estimates a call's prompt-token cost via `gpt-tokenizer`
  (`o200k_base`) plus a +5% headroom offset via `estimatePromptTokens`.
  `o200k_base` is used as a **model-agnostic** approximation for every model the
  benchmark drives (GPT and non-GPT); it is not a per-model tokenizer, just a
  stable basis for the reservation. Callers pass the result as the `est`
  (pre-flight reservation) argument to `rateLimiter.run()`, which then settles to
  actual usage, so cross-tokenizer drift self-corrects.
- `src/translationBench/` — translation-bench domain. `runConfig.ts` is the pure
  run-config loader/resolver (no env, no I/O beyond reading the config file).
- Assets (`config.schema.json`, prompt packs) are copied to `dist/` by
  `scripts/copyAssets.mjs` during build.

## Config: JSON + commander, no `TB_*` env

Run configuration is a JSON file validated by `config.schema.json`. Runtime
overrides are passed as **commander flags and prop-drilled** — do not read
`process.env.TB_*`. `local/runs/**/runnerCli.mjs` builds the command and
resolves the config; runners consume the resolved object.

## Credential env boundary

`OPENAI_*` / `AZURE_*` env is the `@typeagent/aiclient` contract
(`initRuntimeConfigFromProcessEnv()`) and is intentionally kept. Only our own
config-knob env was removed.

## TPM rate limiter

`createRateLimiter(tpmLimits, { dbPath, estTokensPerCall, maxWaitMs?, onWait? })`
requires `dbPath`. Concurrent `run()` calls reserve tokens against the shared
SQLite ledger over a rolling 60s window and settle to actual usage. Awaited
calls block until budget frees, so concurrency stays within the per-minute
quota across processes. For long runs omit `maxWaitMs` (unbounded wait);
set it only when a bounded wait-or-throw is desired (e.g. tests).

# Seal-Tools translation-bench runner

Self-contained harness that evaluates `seal-tools-validation.jsonl` (700 rows,
each with its own candidate tools) across every model in `run-config.json`. It
builds the suite directly, keeps per-row schemas, and honors per-model
concurrency plus a shared TPM rate limiter.

## Run

From `ts/packages/benchmarks`:

```sh
pnpm run build

# Smoke: 20 cases across all models
pnpm run seal-eval --batch eval_smoke

# Smoke: a few cases, one model
pnpm run seal-eval --max-cases 5 --models azure/gpt-4.1-mini

# Exact cases
pnpm run seal-eval --case-ids sealtools-dev-easy-0,sealtools-dev-difficult-200

# Full: 700 cases × all models in base.eval.models
pnpm run seal-eval
```

Outputs land in `eval/results/`: `results-<slug>.json`,
`report-<slug>.html`, `checkpoint-<slug>.jsonl` per model, plus a top-level
`summary.json`. Reruns resume from the checkpoint.

Reports use the creator's official `calculate_score_ToolLearning` metrics as
the primary score: Format ACC, Tool P/R/F1, and Parameter P/R/F1. These are
corpus-level micro metrics. TypeAgent's stricter row-level pass/fail and failure
taxonomy remain in the report as supplemental diagnostics.

TypeAgent pass excludes any row whose gold actions contain `API_call_*` (28 of
700 rows in the validation set) and the audited source-quality exclusions in
`typeAgentOverrides.ts`. Required parameters must be present. Optional
parameters may be absent from either side; when both sides provide one, its
value is compared. Values ignore string case and JSON scalar type, including
numeric formatting such as `"19.0"` versus `19`. Action names, parameter names,
arrays, and object structure remain significant. The official Seal score still
uses the untouched source gold for all 700 rows.

After changing only the TypeAgent scoring contract, rescore saved results
without making provider calls:

```sh
node dist/translationBench/public_datasets/Seal-Tools/eval/rescoreResults.js \
  src/translationBench/public_datasets/Seal-Tools/eval/results/full
```

The primary score is the case-insensitive variant requested for this run. It
folds API names, parameter names, and all nested string values. The report also
keeps the creator's official case-sensitive score as a reference.

The implementation preserves the creator's matching behavior, including its
first-gold match for duplicate tool names and omission of P/R/F1 when any count
is zero. Raw model responses preserve numeric lexemes so Python distinctions
such as `1` versus `1.0` survive TypeAgent's JSON parser.

## Models and reasoning effort

Model ids in `run-config.json` must be real gateway routes. Reasoning effort is
**not** part of the model id — express it as `id#effort`:

```json
"azure/gpt-5.6-luna#none",
"azure/gpt-5.6-luna#low"
```

Both route the same `azure/gpt-5.6-luna` id at two efforts. The base id drives
the API call, TPM budget, and concurrency; the effort sets the translation
scenario. Omit the suffix to inherit the gateway default. Valid efforts:
`minimal, low, medium, high, none, xhigh, max`.

The `models` map keys are the bare base ids. `tpmLimit` and `maxConcurrency`
are looked up by base id; `concurrencyByModel` is derived from
`tpmLimit * headroom`, capped by `maxConcurrency`. A shared SQLite TPM limiter
enforces `tpmLimit`. No prompt cache key is set anywhere in the path.

## Flags

`--dataset --config --batch --models --case-ids --max-cases --out-dir --env-file
--instance-dir --rate-limiter-db --no-rate-limit`

## Before a full run

- 700 × 8 = 5,600 translations. Real cost on shared model infra — smoke first.
- Needs gateway credentials (`.env` / `.env.real`) and network/VPN reachable.

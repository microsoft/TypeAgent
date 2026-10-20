# DroidCall analysis

Local snapshot and call-shape analysis for the public
[`mllmTeam/DroidCall`](https://huggingface.co/datasets/mllmTeam/DroidCall)
dataset ([paper](https://arxiv.org/abs/2412.00402),
[source](https://github.com/UbiquitousLearning/DroidCall)).

## Files

- `raw/` contains the full HuggingFace dataset snapshot. Its large files use
  the source repository's Git LFS rules.
- `get-dataset.ts` downloads every source file at the pinned HuggingFace
  revision.
- `droidCallParser.ts` parses code-format calls such as
  `result1 = dial(phone_number=result0)` and maps the dependency to `"#0"`.
  It reuses Seal-Tools' Python-literal parser for argument values.
- `analyze.ts` classifies canonical train/test rows and validates the parser
  against all chat-format assistant outputs.
- `toTypeAgentSchema.ts` filters multi-call rows and converts each row's tool
  catalog and gold calls to the TypeAgent evaluation schema.
- `droid-call-multi-action.jsonl` contains all 2,682 converted multi-action
  rows, ordered by the train split and then the test split.
- `eval/` contains the dedicated DroidCall grader and the resumable model
  runner. It writes checkpoints, raw trajectories, JSON results, HTML reports,
  and a combined summary.
- `analysis.json` and `docs/DroidCall.md` contain the generated machine-readable
  and human-readable analysis.

## Categories

The three buckets are mutually exclusive:

1. Single tool: exactly one gold call.
2. Multi-call, nested: two or more calls with a `#N` result reference in
   any argument. The reference can be the whole value or part of a string, and
   it can occur inside an array or object.
3. Multi-call, without nesting: two or more calls with no result reference.

## Run

From `ts/packages/benchmarks`:

```bash
pnpm run build
node dist/translationBench/public_datasets/DroidCall/index.js
```

Run the 30-row matrix across every model in `eval/run-config.json`:

```bash
node dist/translationBench/public_datasets/DroidCall/eval/test-run.js \
  --max-cases 30 \
  --out-dir output/droidcall/multi-action-30
```

The 1,000-row run selects only independent multi-action rows, then applies the
1,000-row limit. It excludes all nested result dependencies:

```bash
node dist/translationBench/public_datasets/DroidCall/eval/runEval.js \
  --batch eval_1000 \
  --out-dir output/droidcall/multi-action-1000 \
  --rate-limiter-db output/droidcall/multi-action-1000/rate-limiter.sqlite
```

The runner executes the seven distinct base models in parallel. The two Luna
reasoning variants run sequentially because they share one model quota. Within
each lane, `run-config.json` derives case concurrency from TPM and caps it at
the deployment's configured maximum. A shared SQLite ledger enforces TPM.

Runs resume from one fingerprinted checkpoint per model. Keep the same output
directory and arguments to resume. The runner verifies the checkpoint and raw
trajectory journal before it skips completed rows.

Build a LaTeX report from any completed run directory:

```bash
node src/translationBench/public_datasets/DroidCall/eval/results/full/build-latex-report.mjs \
  --results-dir output/droidcall/multi-action-1000
```

With no arguments, the report builder reads `eval/results/full/`. It labels
partial runs with their actual row count and reads scores from the saved result
files instead of embedding them in the report source.

To refresh the complete pinned source snapshot before analysis:

```bash
node dist/translationBench/public_datasets/DroidCall/index.js --download
```

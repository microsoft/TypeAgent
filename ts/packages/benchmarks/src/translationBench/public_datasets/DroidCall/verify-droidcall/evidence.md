# DroidCall verification

## Goal

Verify the full pinned HuggingFace snapshot, generated analysis, parser reuse,
and benchmark package build.

Final resources:

- `raw/`, containing the eight files from the pinned HuggingFace revision
- `docs/DroidCall.md`, generated from the canonical train and test rows
- the built DroidCall analysis command under `dist/`

## Environment

Working directory:
`ts/packages/benchmarks`

Runtime: Node.js v24.14.1.

## Live download and analysis

The built command downloaded all eight files from HuggingFace and regenerated
the report.

```text
$ node dist/translationBench/public_datasets/DroidCall/index.js --download
downloading DroidCall_code_short.jsonl
downloading DroidCall_train.jsonl
downloading DroidCall_test.jsonl
downloading annotated_api.jsonl
downloading README.md
downloading .gitattributes
downloading figures/data_generation.png
downloading figures/intent.png

full: rows=10271 calls=14325
single=7589 nested=1151 non_nested=1531
```

The integrity check queried the same pinned HuggingFace revision, compared its
file list with the downloader contract, and checked every local file against
the byte count and SHA-256 hash in `analysis.json`.

```text
source_revision=42563ae614280d2891d57f1e7057c4bc50dd27bd
repository_files=8 local_files=8 exact_match=true
rows=10271 calls=14325
single=7589 nested=1151 non_nested=1531
```

## Build and focused test

```text
$ pnpm run build
$ pnpm run jest-esm --testPathPattern=translationBench.droidCall.spec.js --runInBand
PASS dist/test/translationBench.droidCall.spec.js
  ✓ parses and classifies DroidCall code

Test Suites: 1 passed, 1 total
Tests:       1 passed, 1 total
```

Prettier also passed for the DroidCall source, README, and test.

## Package suite status

The full benchmark package suite has unrelated failures in the existing dirty
worktree. The DroidCall test passes. The failing suites are
`translationBench.datasetGenerator.spec.js`, whose fixtures omit newly required
negative-assessment fields, and `translationBench.llmCost.spec.js`, which
imports a missing runner export.

```text
Test Suites: 2 failed, 25 passed, 27 total
Tests:       9 failed, 234 passed, 243 total
```

These failures do not touch the DroidCall downloader, parser, analysis, or
focused test.

## Multi-action conversion

The built converter regenerated the filtered dataset from the pinned train and
test files.

```text
$ node dist/translationBench/public_datasets/DroidCall/index.js
built 2682 multi-action eval rows
```

The generated file has the expected split and dependency counts.

```text
$ jq -s '{rows:length, strict:(map(select(.order == "strict"))|length), independent:(map(select(.order == "any"))|length)}' src/translationBench/public_datasets/DroidCall/droid-call-multi-action.jsonl
{
  "rows": 2682,
  "strict": 1151,
  "independent": 1531
}
```

## Converter and grader test

```text
$ pnpm run build
$ pnpm run jest-esm --testPathPattern=translationBench.droidCall.spec.js --runInBand
PASS dist/test/translationBench.droidCall.spec.js
  ✓ matches the official DroidCall contract

Test Suites: 1 passed, 1 total
Tests:       1 passed, 1 total
```

## Released grader audit

The released score follows upstream `result_checker.py` at commit
`3f7ba458bee480a86c602edff6cc7ec9cfd555db`. The worker pins BERTScore 0.3.13
and Transformers 4.48.1. Transformers 5 is not compatible with that BERTScore
release.

The full converted corpus resolves to the 24 APIs in the annotated catalog.
The audit found the source defects that the official scorer inherits.

```text
rows=2682 calls=6736
duplicate_name_rows=488 duplicate_calls_beyond_first=669
reference_rows=1151 reference_values=1724 embedded_references=92
semantic_gold_arguments=1709 optional_gold_arguments=3229
missing_apis=0 unknown_gold_arguments=7
missing_required_gold_arguments=2 invalid_reference_targets=1
```

A direct comparison used the same three string pairs with upstream
`bert_score.score()` and the persistent `BERTScorer` used by the local worker.
The floating-point scores and threshold decisions matched exactly.

```text
[(0.9320355653762817, 0.9320355653762817, True, True),
 (0.995942234992981, 0.995942234992981, True, True),
 (0.8961057066917419, 0.8961057066917419, True, True)]
```

The saved 240 trajectories were rescored without new model calls. The result
is in `output/droidcall/multi-action-30/official-summary.json`. The scorer
decodes preserved JSON number lexemes back to Python integers and floats before
comparison; the focused test covers that boundary.

```text
azure/gpt-4.1            soft 76.9% exact 36.7% arguments 113/159
azure/gpt-4.1-mini       soft 73.9% exact 33.3% arguments 111/159
azure/gpt-5.4-nano       soft 70.6% exact 33.3% arguments 110/159
azure/gpt-5.6-sol        soft 75.4% exact 33.3% arguments 113/159
azure/gpt-5.6-terra      soft 73.5% exact 33.3% arguments 110/159
azure/gpt-5.6-luna#none  soft 78.6% exact 36.7% arguments 118/159
azure/gpt-5.6-luna#low   soft 76.2% exact 36.7% arguments 113/159
azure/gpt-4o             soft 81.4% exact 40.0% arguments 119/159
```

## Live model matrices

The local LiteLLM environment supplied the endpoint and credentials. The run
did not print keys or endpoint values.

The five-row smoke run completed all eight configured model specs and wrote 40
raw trajectory records. Its artifacts are in
`output/droidcall/multi-action-5/`.

The 30-row run completed 240 translations. Its first 30 rows contain 15 strict
dependencies and 15 independent multi-calls.

```text
$ node dist/translationBench/public_datasets/DroidCall/eval/test-run.js --max-cases 30 --out-dir output/droidcall/multi-action-30
DroidCall eval: 30 case(s) × 8 model(s)
azure/gpt-4.1: format 100.0%, tool F1 97.3%, errors 0
azure/gpt-4.1-mini: format 100.0%, tool F1 97.3%, errors 0
azure/gpt-5.4-nano: format 100.0%, tool F1 95.9%, errors 0
azure/gpt-5.6-sol: format 100.0%, tool F1 93.7%, errors 0
azure/gpt-5.6-terra: format 96.7%, tool F1 91.4%, errors 1
azure/gpt-5.6-luna#none: format 100.0%, tool F1 93.7%, errors 0
azure/gpt-5.6-luna#low: format 100.0%, tool F1 93.7%, errors 0
azure/gpt-4o: format 100.0%, tool F1 95.9%, errors 0
wrote output/droidcall/multi-action-30/summary.json
```

Artifact validation checked every saved request and response.

```text
$ wc -l output/droidcall/multi-action-30/checkpoint-*.jsonl output/droidcall/multi-action-30/trajectories.jsonl
31 lines in each of 8 checkpoint files
240 output/droidcall/multi-action-30/trajectories.jsonl

$ jq -s '{records:length, unique:(map([.setupid,.rowid,.scenarioId,.callIndex]|join("|"))|unique|length), withRequest:(map(select(.request != null))|length), withResponse:(map(select(.response != null))|length)}' output/droidcall/multi-action-30/trajectories.jsonl
{
  "records": 240,
  "unique": 240,
  "withRequest": 240,
  "withResponse": 240
}
```

The resume check used the same output directory. Every model restored 30 rows
from its checkpoint, and the trajectory journal stayed at 240 lines.

## 1,000-row command

The `eval_1000` batch resolves to 1,000 rows and all eight configured model
specs.

```text
$ node --input-type=module -e '<load eval_1000 from run-config.json>'
{"maxCases":1000,"models":8}
```

```bash
node dist/translationBench/public_datasets/DroidCall/eval/test-run.js \
  --max-cases 1000 \
  --out-dir output/droidcall/multi-action-1000
```

## Completed 1,000-row independent run

The `eval_1000` profile filters to `order: "any"` before taking 1,000 rows.
The preflight checked the selected source cases before any model request.

```text
{
  "caseOrder": "any",
  "maxCases": 1000,
  "eligible": 1531,
  "selected": 1000,
  "nested": 0,
  "independent": 1000
}
```

The completed matrix used seven concurrent base-model lanes. The two Luna
reasoning variants shared one serial lane. Per-model case concurrency was 10,
20, 20, 8, 10, 10, and 10 for gpt-4.1, gpt-4.1-mini, gpt-5.4-nano,
gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna, and gpt-4o, respectively. The shared
SQLite TPM ledger remained enabled.

```text
azure/gpt-4.1            soft 88.2% exact 56.9% tool F1 99.4% param F1 78.2% errors 0
azure/gpt-4.1-mini       soft 88.7% exact 57.7% tool F1 99.3% param F1 78.9% errors 0
azure/gpt-5.4-nano       soft 88.0% exact 56.4% tool F1 99.1% param F1 75.5% errors 4
azure/gpt-5.6-sol        soft 88.5% exact 57.5% tool F1 97.7% param F1 76.8% errors 0
azure/gpt-5.6-terra      soft 88.8% exact 57.1% tool F1 97.6% param F1 77.0% errors 0
azure/gpt-5.6-luna#none  soft 88.7% exact 56.4% tool F1 98.1% param F1 76.2% errors 0
azure/gpt-5.6-luna#low   soft 88.2% exact 55.8% tool F1 98.0% param F1 76.2% errors 0
azure/gpt-4o             soft 88.2% exact 56.5% tool F1 99.5% param F1 77.6% errors 0
```

Every checkpoint contains its header plus 1,000 completed rows. Every result
file contains 1,000 rows with `order: "any"`, `resultReference: false`, and
`dimensions.dependency: "parallel"`.

```text
$ wc -l output/droidcall/multi-action-1000/checkpoint-*.jsonl output/droidcall/multi-action-1000/trajectories.jsonl
1001 each across 8 checkpoint files
8000 output/droidcall/multi-action-1000/trajectories.jsonl

resultFiles=8 resultRows=8000
wrongOrder=0 dependent=0 resultReference=0
trajectoryLines=8000 trajectoryGroups=8000 duplicateCallKeys=0
```

The run was interrupted after 4,269 completed translations and restarted from
the exact saved counts. A final rerun restored all 1,000 rows for every model,
issued no model requests, and left the trajectory journal at 8,000 lines.

One malformed response exposed a guard that required every saved response to
reconstruct a complete action list. The final runner keeps the raw response and
scores it as a format failure instead of aborting the matrix. The finished
artifact set has one parseable raw response for each scored row.

## Grader parity

The upstream source was fetched directly from the pinned commit. Its SHA-256 is
recorded here so the audited contract can be reproduced.

```text
upstream result_checker.py
59c8256a72f14cc2ac6ce1d08938cb6beec209e8eb00c65460815b96d592f0df
```

The paper and released code disagree. The paper uses a 0.75 semantic threshold
and says to average parameter accuracy across function calls. The released code
uses 0.85 and averages one combined parameter score per sample. The local worker
records both contracts and the TypeAgent MIME adjustment separately.

A four-row differential fixture checked the released contract against the
pinned upstream script. It covered defaults, unordered lists, duplicate-name
collapse, missing tools, and ignored extra tools. Both implementations returned
the same scores.

```text
upstream: soft 0.75, exact 0.75
local:    soft 0.75, exact 0.75
```

The saved 1,000-row outputs were rescored without model calls. The released and
adjusted ranges are:

```text
released soft: 88.0% to 88.8%
released exact: 55.8% to 57.7%
adjusted soft: 88.2% to 88.9%
adjusted exact: 56.2% to 58.4%
```

This run cannot reproduce the paper's model results. It contains 1,000 training
rows, while the paper evaluates the 200-row test split. It also uses a different
prompt, candidate-tool set, and output parser. The paper does not specify enough
edge-case behavior to define an exact executable scorer.

## Report

The report builder read the completed result directory and produced a 15-page
PDF. Tectonic completed successfully. Poppler rendered all pages for visual
inspection. The 15-page contact sheet has no clipped text, overlapping elements,
or broken tables. Full-size checks of the summary, scoring, results, and final
pages confirmed that the smaller text remains legible.

```text
$ pdfinfo output/droidcall/multi-action-1000/typeagent-droidcall-translation-eval.pdf
Title: TypeAgent DroidCall Translation Evaluation
Pages: 15
Page size: 612 x 792 pts (letter)
File size: 113639 bytes
PDF version: 1.5
```

The report contains the dataset breakdown, TypeAgent conversion, all three
scoring contracts, all eight model scores, and expected versus actual failure
examples.

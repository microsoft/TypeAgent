# Conversation-memory benchmarks

BEAM and LongMemEval evaluation against the durable TypeAgent memory service.
No Python interpreter, environment, package or subprocess is required. Python
judge files are read as pinned data, never executed.

| Dataset          | Run selection                                             | Runtime and scoring                                                         |
| ---------------- | --------------------------------------------------------- | --------------------------------------------------------------------------- |
| `beam` (default) | `--split`, `--stage`, optional `--unit`                   | BM25/content/event RAG, or native content answering; BEAM rubric            |
| `longmemeval`    | `--variant`, `--max-questions`, optional `--question-ids` | Production-native content memory and pinned official yes/no judge templates |

Options specific to the other dataset are rejected. `--mode agent` means the
native memory-service answer, not an autonomous tool loop. LongMemEval does not
inherit BEAM's `100k` split, smoke sampling, external RAG, batch imports or
two-hour bridge deadline. Existing BEAM commands and artifacts are unchanged.

## Build and offline tests

From the TypeAgent checkout:

```powershell
if (Test-Path $PROFILE) { . $PROFILE }
$repo = (git rev-parse --show-toplevel).Trim()
$reposRoot = Split-Path $repo
Set-Location (Join-Path $repo 'ts')
pnpm run build
pnpm --filter @typeagent/benchmarks run jest-esm --runInBand --testPathPattern='memoryBench[.]spec[.]js'
pnpm --filter @typeagent/benchmarks test:memory
```

The offline suite covers normalization, gold separation, isolation, durable
readiness/restart, native citations, judge-failure resume, progress and numerical
parity with synthetic Python-reference fixtures. It does not require the AMB
checkout or model authentication.

## Prepare the BEAM protocol once

The upstream checkout must be pinned to AMB commit
`16fcebb0066537e890c6015c9d4a2b2eac952249`. The Node preparation command reads
templates from that Git revision as data; it never imports or executes Python.
It writes a local JSON artifact rather than redistribute complete upstream
prompts without an upstream license file.

```powershell
$amb = Join-Path $reposRoot 'agent-memory-benchmark'
$output = Join-Path $reposRoot 'memory-benchmark-runs\typescript'
$protocol = Join-Path $output 'protocol.json'

# For a new checkout only:
git clone https://github.com/vectorize-io/agent-memory-benchmark.git $amb
git -C $amb switch --detach 16fcebb0066537e890c6015c9d4a2b2eac952249

pnpm --filter @typeagent/benchmarks memory-bench prepare-protocol `
    --amb-root $amb --output $protocol
```

Reuse an existing pinned checkout as-is. No upstream provider-registry patch or
Python dependency installation is needed. Subsequent runs only need the prepared
protocol JSON, not the upstream checkout.

## Run BEAM

The in-process service uses normal TypeAgent configuration for extraction,
embeddings, search, native answers and common answer/judge generation.
`TYPEAGENT_BENCHMARK_MODEL` can select an existing configured model.
For Azure CLI authentication, ensure `Get-Command az` succeeds in the launching
shell and the existing Azure sign-in is usable. Never put keys in commands or
result files.

### Maintenance and publication policy

New BEAM bridge runtimes default to `maintenanceMode: "manual"` and ten-document,
8 MiB publication groups with a 250 ms bounded admission window. This defers
autonomous maintenance across conversations without disabling informational
view capabilities or selecting a different native reader. Derived content
availability can differ; identical answers are not guaranteed. Model/extraction concurrency
remains controlled by the existing index settings, not publication group size.
Slow admissions may produce smaller checkpoints; an oversized source is never
truncated to meet a group budget.

These BEAM policy variables do not configure LongMemEval. Its production factory
retains automatic maintenance and its sessions are imported sequentially outside
batch groups. Shared product scheduler and query-cache fixes apply to both paths;
BEAM's larger publication groups do not automatically combine LongMemEval sessions.

For controlled comparisons, set `TYPEAGENT_BENCHMARK_MAINTENANCE_MODE` to
`automatic` or `manual`, and `TYPEAGENT_BENCHMARK_COMMIT_DOCUMENTS` to a positive
integer up to 100 (`2` selects the previous publication boundary). Effective
processing policy is recorded in capabilities and the configuration fingerprint.
Use separate fresh output roots for each variant; do not resume the historical
stopped run under this changed policy.

At completion, results record maintenance status and explicitly state
`drainPerformed: false`, `drainSeconds: null`. Foreground completion is not a
claim that deferred work is finished or eliminated. The bridge exposes
`maintenanceStatus` and bounded `drainMaintenance` operations for separately
measuring maintenance completion. A drain can report pending/deferred/failed work;
report that state and elapsed drain time rather than treating it as success.
Keep the fixed BEAM questions and recall thresholds unchanged in comparisons.

Resume preserves the original per-unit `ingestionSeconds`; subsequent
ready-store ingestion/replay durations are recorded separately in
`ingestionReplaySeconds`. Replays must not replace cold-ingestion measurements.

```powershell
$progress = Join-Path $reposRoot 'codeDocs\TypeAgent\forAgent\projects\inProgress\2026-10-22_memory-benchmarks\progress.json'
$cache = Join-Path $output 'datasets'

pnpm --filter @typeagent/benchmarks memory-bench run `
    --repo $repo --output $output --progress $progress --protocol $protocol `
    --cache $cache --dataset beam --stage suite
```

The suite uses pinned Hugging Face Parquet shards, downloaded/decoded directly
in Node. Cache metadata records the immutable dataset revision, shard hashes
and JSON-export hash. A cache-provenance mismatch fails explicitly.

Order: 100k, 500k, 1m, 10m. Within each split: smoke, qualification, full.
Within each stage: BM25 RAG, content RAG, native content, event RAG. The suite
stops on import, retrieval, authentication, network/service outages, persistence
errors or invalid configuration. These are infrastructure failures, not
question outcomes.

Provider content filtering and malformed model JSON/schema responses are
logged and saved as terminal per-question failures. The suite continues to
later questions, providers and stages without changing prompts, switching
models, bypassing filters or fabricating predictions. A failed judge retains
the generated prediction and native citations for later analysis.

Per-run and per-category reports distinguish:

- `completed`: scored questions plus terminal question failures.
- `scored`, `blocked`, `failed`: counts of scored answers, provider-blocked
  responses and malformed responses, respectively.
- `coverage`: scored questions divided by all selected questions.
- `accuracy`: correct divided by scored questions, explicitly labeled
  `accuracyDenominator: "scored-questions"`; `null` when nothing was scored.
- `correctOverTotal`: correct divided by all selected questions, including
  unanswered questions in the denominator. It is not a fabricated zero score.

Do not compare scored-only accuracy without coverage or present it as complete
benchmark accuracy. Categories with no scored answers also have null accuracy.
A run with question failures finishes as `complete-with-errors`; this advances
the suite but is not a claim that every question produced a valid score.

For one stage:

```powershell
pnpm --filter @typeagent/benchmarks memory-bench run `
    --repo $repo --output $output --progress $progress --protocol $protocol `
    --cache $cache --dataset beam --split 100k --stage smoke `
    --provider content --mode rag
```

`--input <json-file>` accepts a local dataset export for a single stage and
labels its provenance `local-json-sha256`. It is rejected for suites so one
local split cannot accidentally stand in for other length tiers.
`--unit <id>` selects the complete smoke/qualification conversation. Smoke asks
one question per category, qualification asks all that conversation's questions,
and full asks all split questions. Documents are never truncated.

## Run LongMemEval

LongMemEval uses the configured **agent-server production durable-memory
factory**, including normal extraction, informational views, drafts and
synopses. It creates corpora lazily and imports original sessions sequentially,
with one Markdown source per original session position. Repeated session IDs,
empty cleaned turns, roles and original dates are preserved. The question date
is supplied as typed temporal metadata; there is no preliminary search or
BEAM-style external RAG. Questions, reference answers and evidence labels are
not included in indexed construction payloads.

The default `--variant s-cleaned` uses the same pinned dataset as the previous
qualification-tools runner. `--variant oracle` uses the **official evidence-only
variant**, not a hand-truncated S history. It is useful for a small operational
smoke test, but cannot establish full-history retrieval quality or S accuracy.
Both variants validate all 500 questions before selection.

| Variant     | File                         | Raw SHA-256                                                        |
| ----------- | ---------------------------- | ------------------------------------------------------------------ |
| `s-cleaned` | `longmemeval_s_cleaned.json` | `d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442` |
| `oracle`    | `longmemeval_oracle.json`    | `821a2034d219ab45846873dd14c14f12cfe7776e73527a483f9dac095d38620c` |

Dataset repository: `xiaowu0162/longmemeval-cleaned` on Hugging Face, immutable
revision `98d7416c24c778c2fee6e6f3006e7a073259d48f`.
The judge is `src/evaluation/evaluate_qa.py` from
`xiaowu0162/LongMemEval`, revision
`9e0b455f4ef0e2ab8f2e582289761153549043fc`, raw SHA-256
`ecce9c4c79dc89d99534ac17b383a5cbb5b9f0c69ee98adaf0684742e3d95251`.
Five templates are extracted and routed by question type/abstention; the Python
file is never executed. No separate `prepare-protocol` step is needed.
`--protocol` can alias `--judge-source` for this dataset, but not both.

Reuse already verified local inputs. If missing, acquire the immutable files
outside the source tree; each run checks the raw hashes:

```powershell
$inputs = Join-Path $reposRoot 'memory-benchmark-artifacts\inputs'
$lmeOutput = Join-Path $reposRoot 'memory-benchmark-runs\longmemeval'
New-Item -ItemType Directory -Force $inputs, $lmeOutput | Out-Null
$revision = '98d7416c24c778c2fee6e6f3006e7a073259d48f'
$file = 'longmemeval_s_cleaned.json' # or longmemeval_oracle.json
Invoke-WebRequest `
    "https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/$revision/$file" `
    -OutFile (Join-Path $inputs $file)
Invoke-WebRequest `
    'https://raw.githubusercontent.com/xiaowu0162/LongMemEval/9e0b455f4ef0e2ab8f2e582289761153549043fc/src/evaluation/evaluate_qa.py' `
    -OutFile (Join-Path $inputs 'evaluate_qa.py')
```

One question with all of its supplied histories:

```powershell
pnpm --filter @typeagent/benchmarks memory-bench run `
    --dataset longmemeval --variant s-cleaned --repo $repo `
    --input (Join-Path $inputs 'longmemeval_s_cleaned.json') `
    --judge-source (Join-Path $inputs 'evaluate_qa.py') `
    --output $lmeOutput --progress (Join-Path $lmeOutput 'progress.json') `
    --max-questions 1 --work-minutes 30 --authorized-live-benchmark
```

For an oracle smoke test, change **both** `--variant oracle` and the input file
to `longmemeval_oracle.json`. Question IDs/order and all supplied evidence
sessions are retained. `--question-ids id1,id2` selects diagnostic cases in the
original deterministic seeded order, not caller order. Duplicate/unknown IDs
fail. No failed case is replaced to improve coverage.

For the original fixed first-50 target, use `--max-questions 50`; omit
`--question-ids`. A sufficiently long authorized invocation can use
`--work-minutes unlimited`; this removes only the external work bound, not the
startup, ownership, frozen-identity or close checks. Normal work values are
1-30 minutes plus a five-minute cleanup reserve. Startup is separately bounded
by `--startup-minutes 1` through `10` (default `2`). There is no hidden BEAM
two-hour import limit on this path.

LongMemEval uses the normal configured reader and judge models, recording the
**observed** judge model; it does not claim the official GPT-4o evaluator.
`TYPEAGENT_BENCHMARK_MODEL` is a BEAM bridge override, not a LongMemEval judge
override. Authorization is explicit, and no credentials belong in artifacts.

### LongMemEval latency qualification

To measure a fresh fixed first-20 S-cleaned target with complete histories:

```powershell
$env:TYPEAGENT_MEMORY_SEARCH_TRACE = '1'
pnpm --filter @typeagent/benchmarks memory-bench run `
    --dataset longmemeval --variant s-cleaned --repo $repo `
    --input (Join-Path $inputs 'longmemeval_s_cleaned.json') `
    --judge-source (Join-Path $inputs 'evaluate_qa.py') `
    --output $lmeOutput --progress (Join-Path $lmeOutput 'progress.json') `
    --max-questions 20 --work-minutes unlimited --startup-minutes 10 `
    --continue-after-import-failure --authorized-live-benchmark
```

Use a fresh output/store; do not resume a pre-policy run. The frozen arm records
the observed `accessAdmissionPolicy`, currently `foreground-fair-v1`. This is a
shared product policy, not a benchmark-only priority override. Automatic
maintenance, normal model configuration and all original history sessions stay
enabled; no run-wide maintenance hold or manual BEAM policy is applied.

The owned run writes `latency-progress.json` at startup, every 15 seconds using
single-flight atomic snapshots, and at final shutdown. It includes grading
progress, current import elapsed time, worker PID/memory, completed-history
source bytes and cumulative input bytes, per-history driver/job elapsed times,
and ingestion read/write reservation wait/hold sums, maxima and counts.
Completed histories retain their worker memory sample in the durable ledger.
Per-question and whole-run p50/p95/max distributions include first-five/last-five
cohorts and their median input sizes. `nonOverlappingCohorts` is false below ten
completed histories. Source bytes are logical imported Markdown bytes, not
physical index/disk size.

`accessByPriority` retains traced reservation counts, totals and maxima for each
access kind/class. Ingestion measurements exclude maintenance even when it
inherits the same trace ID. Only the new access stages feed these aggregates;
legacy overlapping `queue.*` stages are not added again. Missing measurements
are null, not zero; without the trace flag, only driver/job/memory observations
are available. Invalid timing records or report-write errors are explicit run
failures, not fabricated zero-latency results.

Compare within-question trends first: each question has a separate corpus.
Across-question cohorts also mix corpus sizes, source lengths, extraction costs,
provider retries and background debt. Driver wall time includes admission,
polling and, after recovery, downtime; it is not exclusive product work.
Neither a flat latency curve nor a successful run proves UI SLOs, completed
maintenance, answer quality or a causal speedup against the historical run.

### LongMemEval progress, interruption and resume

The CLI prints a `run-directory` JSON record identifying its new
`memory-longmemeval-*` child. That directory owns its isolated store, lock,
manifest, worker spec/logs, process admission/termination receipts,
`benchmark-state.json`, `progress.json`, `hypotheses.json` and `scorecard.json`.
An optional shared `--progress` registry receives a namespaced
`longmemeval:<runId>` entry. Worker logs are not a heartbeat; durable progress
advances at source, answer and grade transitions.

Progress includes question X of Y, histories completed/total, graded count,
passed/incorrect count, graded-only pass percentage, skipped imports and
supported close. A one-question pass is **not** 500-question accuracy:
the scorecard retains the complete dataset denominator and reports
`fullScheduleAccuracy: null` while coverage is incomplete.

To stop safely after the current question, write this inside the owned run:

```powershell
@{ stop = $true } | ConvertTo-Json |
    Set-Content -Encoding utf8 (Join-Path $runDirectory 'stop-after-question.json')
```

Wait for acknowledgement, supported close and worker exit. Remove that specific
request file only when intentionally continuing. To resume a compatible package
run, repeat the same dataset/model/options command with
`--resume $runDirectory`. The previous worker/watchdog must have exited.
Stale locks require ownership inspection; do not delete them blindly.

The new package state schema is `typeagent-memory-longmemeval-v1`. Changes to
dataset, protocol, compiled product/dependencies, engine, model/configuration or
construction reject incompatible resume. Existing qualification-tools stores
and the stopped 50-question run remain historical, **not** resumable by the new
engine. Do not bypass this by supplying a previous engine hash.

`--continue-after-import-failure` permits only verified terminal import failures:
the case is marked skipped-import, no answer is generated from incomplete
history, and the fixed target is not replenished. Cancellation, provenance,
judge/provider outages and other failures remain failures. Hypotheses, native
citations and reader diagnostics persist before judging, allowing judge-only
recovery without regenerating the answer.

### Qualification tools versus benchmarks

LongMemEval dataset preparation, official-template routing, case execution,
scorecards, supervision and campaign orchestration now live in this package.
The old `longmemeval-live.mjs`, `longmemeval-runner.mjs` and
`longmemeval-campaign.mjs` paths are temporary delegating compatibility modules;
build the package before using them. Old launcher flags are retained, including
the file-valued legacy `--dataset`; the unified CLI instead uses
`--dataset longmemeval --input <file>`.

Readiness/fault-injection gates, crash probes, component/storage
microbenchmarks, ingestion profiling, tracing and AP/QED qualification remain
under `tools/memory-maintenance-qualification`. They reuse neutral checkpoint,
source-recovery, observer and watchdog helpers from `memoryBench/shared`.
The benchmark package never imports qualification tools. The tested lifecycle
and execution implementations remain ESM JavaScript compiled/copied by `tsc`
with declarations; dataset/protocol contracts and CLI are TypeScript. This avoids
rewriting supervision/recovery policy during relocation.

The compatibility campaign module now delegates to the package campaign;
it keeps its prior allowance, disk-reserve and supported-close policy. It is
not a way to restart an old-engine artifact.

## BEAM resume and outputs

Rerun the same command to reuse ready imports and saved predictions under the
same fingerprint. A judge outage does not force answer regeneration; native
citations are saved with the pending prediction. Changed data, product code,
compiled adapter, protocol or model configuration requires a fresh output root.
Python outputs are historical evidence, not compatible TypeScript checkpoints.
The v2 question-outcome policy requires a fresh output root; v1 fail-fast
checkpoints are not migrated or silently combined with it. Within the same v2
fingerprint, scored questions and terminal failures are not retried on resume.
Infrastructure failures still preserve pending predictions for judge-only
resume without regenerating answers.

The harness supports only BEAM's 100k, 500k, 1m and 10m splits. After the
BEAM-only scope cleanup, rebuild and prepare a fresh protocol artifact. Adapter
and protocol fingerprints change, so use a fresh output root rather than
resuming or combining previously fingerprinted results.

- `progress.json`: active stage, exact question counts, scores, licensing and
  explicit failures; previous run entries remain available.
- `<run>/results.json`: predictions/citations, `questionFailures` with phase,
  kind, error and timestamp, per-category metrics, provenance,
  retrieval aliases, timings, process resource usage and run-directory size.
- `<run>/provider-state.json`: isolated corpora, source hashes, readiness and
  ingestion timings.
- `<run>/memory`: run-owned durable memory. Personal profile corpora are unused.
- `<run>/run.lock`: prevents concurrent writers to the same run. It is removed
  on normal completion/failure. After a hard process termination, inspect its
  recorded PID and remove only that specific stale lock before resuming.

SIGINT/SIGTERM request graceful interruption at the next operation boundary;
the current service request is allowed to finish before cleanup.

## Protocol and limits

Answer/judge prompts match the pinned AMB protocol. BEAM reports mean
0/0.5/1 rubric compliance and `correct = score >= 0.5`, including event ordering.
The additional ordering diagnostic uses AMB semantic alignment followed by F1
and normalized Kendall tau-b; it is not full original BEAM evaluator parity.
Configured non-Gemini models remain explicitly diagnostic, not comparable
Gemini-leaderboard submissions.

BM25 preserves rank-bm25's formula, stable ties and 512-token `cl100k_base`
chunks, including independent UTF-8 decoding at chunk boundaries. Retrieval
aliases are retained for diagnostics; the upstream Python BM25 provider dropped
those aliases. This corrects recall reporting, not answer ranking.

Content batches are bounded below 6 MiB before overhead; events are appended
in bounded groups with stable turn identities. Content/event RAG evidence is
bounded to 24,000 characters. Native content answers retain the product's
12-fragment / 24,000-character evidence budgets and cannot silently become
extractive answers. Native event answering is unsupported.

Content imports remain `sourceType: "text"`; they do not bypass literal-text
handling by masquerading as Markdown. The product now uses shared lossless
DocPart splitting/packing for text, Markdown/HTML and VTT. Durable extraction
uses a 24,000-token `o200k_base` budget; message embeddings use separate
7,500-token windows under both extraction and embedding tokenizers. Shared
indexing and hosted embedding requests also enforce the final 8,000-token
`cl100k_base` ceiling. This product change requires a fresh fingerprint/output
root; do not resume or combine the old oversized-input run with new results.

Normalization preserves speaker/role, original IDs, source timestamps, session
boundaries, including sparse BEAM session anchors. QA/rubrics/gold
answers are never indexed. BEAM retrieval recall is conversation-level, not
validated turn coverage. Whole-dataset hydration remains nonstreaming.
Confidence intervals and whole-process-tree sampling remain follow-up work.

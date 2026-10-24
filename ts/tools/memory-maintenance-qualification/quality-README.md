# Memory quality: offline contracts and preparation

Public BEAM/LongMemEval inference now belongs to the general
[memory benchmark package](../../packages/benchmarks/src/memoryBench/README.md).
Use `pnpm --filter @typeagent/benchmarks memory-bench run --dataset longmemeval`
with its documented pinned inputs and explicit authorization. The former
LongMemEval live/runner/campaign modules here are compatibility delegates;
build the benchmark package first. Historical stores cannot resume under the
new package engine. Product readiness, fault injection, recovery probes and
profiling remain in this directory.

This lane adds **offline evaluation utilities**, not a memory implementation,
inference runner, factual judge, or new lifecycle harness. It makes no model calls,
reads no credentials, and opens no production stores. No LongMemEval, AP-news,
BenchmarkQED, or production-quality result has been measured here. Unit-test
answers and annotations exercise formats only.

`quality-cli.mjs lifecycle-review` delegates to the existing `evaluate.mjs`
`reviewPacket`. Continue using the existing lifecycle/live harness and configured
production API/permission paths for any separately authorized execution.
`offline-models.mjs` is an orchestration fixture, **not** a quality baseline; its
injected answers must not be scored as production results. No new mock memory,
fallback answer, keyword factual judge, or alternate production execution path
has been introduced.

## Blocking CI checks

Run the offline suite from `ts` with `pnpm run test:memory-quality`. It is also
included in the root script phase of `test:local` and the summarized CI runner.
These deterministic contract, fixture, resume, and entrypoint checks belong in
blocking CI on every supported Node version; they do not require model access
or a local API configuration.

Keep asynchronous entrypoint checks independent, or explicitly await nested
`t.test` calls. An unawaited asynchronous test inside a synchronous parent can be
cancelled when the parent finishes on Node 22. Authorization checks assert the
expected validation error, not just any rejection, so missing files or product
dependencies cannot masquerade as a successful authorization check.

Live inference, external-dataset downloads, factual-quality judging, and
wall-clock benchmark comparisons remain separate, explicitly authorized work.
Passing the offline suite does not establish LongMemEval answer accuracy.

## Frozen pilot and custody

The source baseline is B0, commit
`6c5d8dc89190a3602376bdb4cc9d4b87930587ac`. These tools do not rebuild it or
re-establish the integration owner's build/test baseline.

`quality-fixtures/manifest.json` has frozen raw-byte SHA-256:

```text
5cc1a0c51a8feadf26028c8e4bb4207b5bbfee0cb604242c2ed1658a8ca63f77
```

It binds the construction, evaluator-only expectations, and rubric files by
SHA-256. Its split inventory is immutable: **24 distinct authored source bundles,
12 wiki and 12 brief; six development and six locked holdout per kind**.
Each bundle contains two distinct dated, revisioned sources. These are authored
synthetic pilot material, not recovered historical runs, independent reviewed
gold, or a general-purpose benchmark. Every expectation has a verifiable source
quote/revision. Gold is **pending independent human review**.

Construction and evaluator files are separate. Export only the development
packet to repair workers. Do not hand them the fixture directory, evaluator
file, locked sources, LongMemEval questions/references, or QED question packets.
The files provide logical separation, **not filesystem access control**: the
integration owner must apply evaluator custody/access controls. Holdout inspection
for tuning retires those cases; use fresh preregistered confirmation material.
Do not edit/reformat frozen JSON. A change must create a new reviewed experiment
identity rather than update this hash to keep tests green.

Commands below assume the repository's `ts` directory in PowerShell. All output
paths must be new, project-local paths. No downloads or live execution are needed:

```powershell
if (Test-Path $PROFILE) { . $PROFILE }
node --test tools\memory-maintenance-qualification\quality-contract.test.mjs tools\memory-maintenance-qualification\quality-adapters.test.mjs
node tools\memory-maintenance-qualification\quality-cli.mjs freeze
node tools\memory-maintenance-qualification\quality-cli.mjs export-development --output .\development-construction.json
node tools\memory-maintenance-qualification\quality-cli.mjs --help
```

Tests create and remove their own project-local `quality-fixtures/cli-test-*`
directory. They never use OS temporary directories. Formatting uses the
repository-pinned `node_modules\.bin\prettier.cmd` on `quality-*.mjs` and this
README only; frozen JSON is already formatted.

## Artifact scorecards

`quality-contract.mjs` validates the freeze, source witnesses, run identities,
and explicit schedule. `quality-artifacts.mjs` aggregates **human annotations**.
It does not decide whether a claim or paraphrase is true. Quote checks establish
that a human's witness exists; they are not semantic scoring.

Create an evaluator-held run JSON before execution:

- `schemaVersion: 1`, unique `id`, `manifestHash` above, `split`, `caseIds`,
  positive integer `generations`, and SHA-256 `permissionRecordHash`.
- `arms`: unique `id`, full `sourceCommit`, SHA-256 `patchHash`,
  `configurationHash`, `providerSettingsHash`, `promptHash`, `schemaHash`,
  `indexHash`, `eligibleSourcesHash`; nonempty `nodeVersion`, `provider`, `model`,
  `indexGeneration`, `configurationIdentity`. Record actual settings/identities,
  not secrets. For `B0`, the commit must match the frozen baseline and patch hash
  must be SHA-256 of the empty string (unmodified baseline).
- Holdout runs must schedule all 12 heldout bundles and three generations per
  arm: **36 outputs, only 12 independent source-bundle clusters per arm**.
  Development schedules may use a subset. Unrun arms are not inferred.
- Hash the exact JSON object with the exported `identity` function
  (`SHA256(JSON.stringify(object))`, key-order-sensitive). Retain this frozen run
  externally before execution and use it unchanged for all records.

Outputs JSON is `{runHash, records}`. Record IDs are `arm:caseId:generation`,
with one row for **every** scheduled attempt:

- `status: "ok"` requires actual `saved`, `rendered`, `serializedRequest` strings,
  and measured `telemetry: {calls, tokens, latencyMs}`. Retain these original
  artifacts and the existing lifecycle receipt. No expected answer is injected.
- `"failed"`/`"missing"` requires a `reason`. Never synthesize a hypothesis.
  An absent row is an error; explicitly represented failures are scored and
  reported. Successful telemetry totals exclude unknown failed-attempt cost.

Annotations JSON is `{runHash, records}`. Only successful attempts have labels:

- `id`, `reviewer`, `reviewedAt`, and `savedHash`, `renderedHash`, `requestHash`
  bind labels to the exact strings using `identity`.
- `savedConsistent`, `lifecyclePassed`: human booleans after checking actual
  saved/rendered artifacts and the existing lifecycle receipt. This is not an
  automatic lifecycle certification.
- `admission`: `admitted`, `covered`, `contribution`, `distinct`, `blocked`,
  `conflicted`, `ambiguous`, or `stale`; `legitimateProgress` is a separate human boolean.
- `claims`: enumerate **all** externally verifiable rendered claims as
  `{id, quote, supported, rationale, witnesses}`. Supported claims require
  witnesses; unsupported claims still need their output quote and rationale.
- `expectations`: exactly one row for every frozen expectation:
  `{id, preserved, selected, rationale, witness, outputQuote?, requestQuote?}`.
  Preservation needs an actual rendered quote; selected evidence needs a quote
  present in both the original source and actual serialized request.
  Keep output qualification recall separate from selected-evidence coverage.
- Witnesses are `{sourceId, revision, quote}` against the exact bundle sources.
- `errors`: nonnegative integer counts for `attribution`, `status`, `correction`,
  `unknownState`, `citationRevision`, `critical`.

Scoring also requires a separate independent gold approval:
`{status: "approved-independent-human-review", manifestHash, expectationsHash,
reviewer, author, reviewedAt, evidence}`. `expectationsHash` is the frozen
evaluator-file hash from the manifest. Reviewer and author must differ. Approval
is an externally retained human attestation, not identity authentication.
**No real approval is included**; checked-in pending gold cannot be scored.
Tests fabricate approval objects solely to validate this contract.

```powershell
node tools\memory-maintenance-qualification\quality-cli.mjs score-artifacts --run .\run.json --outputs .\outputs.json --annotations .\human-annotations.json --review .\independent-gold-approval.json --output .\scorecard.json
node tools\memory-maintenance-qualification\quality-cli.mjs compare --input .\scorecard.json --baseline B0 --candidate candidate --output .\paired-comparison.json
```

Gates follow the frozen plan: zero critical errors, at least 95% qualification
recall, at least 98% supported-claim precision, and no missing/failed output or
saved/lifecycle failure. Empty precision/recall denominators are `null`, never
perfect scores; gates become indeterminate unless another condition fails.
Failed/missing outputs contribute zero qualification/selected-evidence recall
and are omission-bearing; precision is explicitly observed-output-only.

Comparison averages paired recall differences within each source bundle, then
uses a seeded paired cluster bootstrap (2,000 resamples, seed `20261020`).
It reports complete and failed/missing pairs, actual cluster count, omission
counts, and uncertainty. Three generations do not become three independent
bundles. One cluster has no meaningful interval (`null`). Improvement requires
at least four baseline omission-bearing outputs, at least 50% reduction, no
precision reduction, no critical error, full paired coverage, and the candidate
gate; otherwise report limited evidence/failure rather than an improvement claim.
This is a small pilot, not a production guarantee or full statistical analysis.

### Blinded usefulness, separately

`score-usefulness --run ... --outputs ... --review ... --output ...` accepts an
evaluator packet with `runHash`, `baseline`, `candidate`, `assignments`, `records`.
Each assignment is `{id: "caseId:generation", first: outputId, second: outputId}`;
freeze `blindingKeyHash: identity(assignments)` before human review. Give reviewers
opaque first/second artifacts, **not this arm-unblinding key**.

Each review has matching `id`, `firstHash`/`secondHash` computed over
`{saved, rendered}`, and two distinct `votes`:
`{reviewer, verdict: "first"|"second"|"tie", rationale, witnesses}`.
Disagreement needs a third independent `adjudication` in the same vote shape,
or stays unresolved. Report candidate wins/ties/losses, disagreement,
adjudication, missing reviews, failed pairs, and both scheduled/decided
denominators. The artifact scorecard leaves usefulness pending rather than
inventing a proxy.

## LongMemEval: official-format diagnostic preparation

Public format/scoring references, verified at pinned commit
[`9e0b455`](https://github.com/xiaowu0162/LongMemEval/tree/9e0b455f4ef0e2ab8f2e582289761153549043fc):

- [README field definitions and hypothesis JSONL](https://github.com/xiaowu0162/LongMemEval/blob/9e0b455f4ef0e2ab8f2e582289761153549043fc/README.md).
- [Official `evaluate_qa.py`](https://github.com/xiaowu0162/LongMemEval/blob/9e0b455f4ef0e2ab8f2e582289761153549043fc/src/evaluation/evaluate_qa.py).
  Persisted `autoeval_label` is **`{model, label: boolean}`**, not the bare boolean
  printed to stdout. Actual scoring needs separate model/credential permission.

Obtain an official exported `longmemeval_s.json`, `longmemeval_m.json`, or
`longmemeval_oracle.json` through its published distribution, without modifying
histories. Record repository/revision above, source `path`, and actual raw-file
SHA-256 (`Get-FileHash`). The repository pin documents the adapter's verified
format; an external dataset file's actual identity is its recorded hash, not
an assertion that the data itself is stored at that Git revision.

Plan JSON:

```json
{
  "provenance": {
    "repository": "https://github.com/xiaowu0162/LongMemEval",
    "revision": "9e0b455f4ef0e2ab8f2e582289761153549043fc",
    "path": "data/longmemeval_s.json",
    "sha256": "<actual lowercase raw-file SHA-256>"
  },
  "seed": "<preregistered seed>",
  "quotas": {
    "single-session-user": 8,
    "single-session-assistant": 7,
    "single-session-preference": 7,
    "temporal-reasoning": 7,
    "knowledge-update": 7,
    "multi-session": 7,
    "abstention": 7
  }
}
```

Positive quotas must total 50 and include all seven strata; `_abs` suffix
identifies abstentions without changing the original official `question_type`.
Selection ranks IDs by seeded SHA-256 within strata, independent of file order.
Keep oracle/full-history variants separate in reports.

```powershell
node tools\memory-maintenance-qualification\quality-cli.mjs prepare-longmemeval --input .\longmemeval_s.json --plan .\lme-plan.json --output .\lme-prepared
```

Prepared files:

- `manifest.json`: pinned provenance, frozen original-row hashes, strata, seed.
- `construction.json`: only original ordered timestamped history, cutoff, IDs,
  roles and content. Evidence-turn `has_answer`, evidence-session IDs, reference
  answers, extra evaluator metadata and questions are excluded.
- `reader-only.json`: evaluator-held questions/date for later authorized reading,
  **not construction or indexing**.
- `evaluator-only.json`: exact original rows, preserving all official evaluation
  fields, question type/date, answer/session labels and any extra metadata.

History/date array mismatches, duplicate/unknown cases, invalid labels/dates, and
history later than the official cutoff fail. No history is truncated, re-sorted,
or replaced. Timezone-free official dates are compared as UTC; original strings
are retained.

Later actual attempt records use `{question_id, status, hypothesis}`. Export
refuses absent/failed/empty hypotheses instead of filling answers:

```powershell
node tools\memory-maintenance-qualification\quality-cli.mjs export-lme-hypotheses --input .\lme-prepared --outputs .\actual-lme-attempts.json --output .\hypotheses.jsonl
node tools\memory-maintenance-qualification\quality-cli.mjs summarize-lme-labels --input .\lme-prepared --labels .\official-evaluation-results.jsonl --output .\diagnostic-scores.json
```

The second command imports **already obtained** official nested-label output;
it does not run the official model-based judge. Missing scores remain in the
50-question denominator and are reported per stratum. This is an **adapted
50-question diagnostic**, never official full-suite performance. Neither
preparation nor unit tests establish that those 50 real questions were run.

## BenchmarkQED/AP-news: pinned preparation

Verified public references at commit
[`103bd22`](https://github.com/microsoft/benchmark-qed/tree/103bd2258e219621e1c8a7e96df3a8c1f6ac6fdb):

- [Dataset documentation and AP-news distribution](https://github.com/microsoft/benchmark-qed/blob/103bd2258e219621e1c8a7e96df3a8c1f6ac6fdb/docs/datasets.md)
  and [terms](https://github.com/microsoft/benchmark-qed/blob/103bd2258e219621e1c8a7e96df3a8c1f6ac6fdb/datasets/LICENSE).
- [AutoQ Question dataclass](https://github.com/microsoft/benchmark-qed/blob/103bd2258e219621e1c8a7e96df3a8c1f6ac6fdb/benchmark_qed/autoq/data_model/question.py)
  uses `id`, `text`, optional `question_type`, `references`, `attributes`.
- [Assertion export implementation](https://github.com/microsoft/benchmark-qed/blob/103bd2258e219621e1c8a7e96df3a8c1f6ac6fdb/benchmark_qed/autoq/io/question.py)
  exports `question_id`, `question_text`, `assertions`, `claims`; assertion
  fields include `statement`, `source_count`, `score`, `rank`, optional nested
  validation/supporting assertions. These **are not** dataclass/answer fields.
- [`generated_questions_v2` local/global assertion exports](https://github.com/microsoft/benchmark-qed/tree/103bd2258e219621e1c8a7e96df3a8c1f6ac6fdb/datasets/AP_news/generated_questions_v2)
  are the supported input profile. V1 lists of question strings do not contain
  assertions and intentionally fail this importer.
- [Raw AP records](https://github.com/microsoft/benchmark-qed/tree/103bd2258e219621e1c8a7e96df3a8c1f6ac6fdb/datasets/AP_news/raw_data)
  use `altids.itemid`, integer `version`, `headline`, `firstcreated`,
  `versioncreated`, and `body_nitf`. Raw UTF-8 may have a BOM.

No AP corpus is redistributed here. The operator must accept dataset terms and
obtain the **pinned** raw export and v2 assertion files. The official downloader
currently targets `main`; it does not by itself pin this experiment. Preserve the
actual raw bytes, license/usage fields and inventory outside worker inputs.
Toolkit assertion chunk `source_id`/short IDs are not assumed to be AP item IDs.
Human witnesses must resolve against original AP text and raw article hashes.

First inventory authorized local files without sending any content externally:

```powershell
node tools\memory-maintenance-qualification\quality-cli.mjs inventory-qed --articles .\ap-raw --local .\data_local_questions_assertions.json --global .\data_global_questions_assertions.json --output .\qed-inventory.json
```

Create a plan with the pinned repository/revision above,
`provenance.path: "datasets/AP_news/generated_questions_v2"`,
`provenance.sha256` equal to inventory `combinedSha256`,
`corpusInventoryHash`, `localSha256`, `globalSha256` from that inventory,
`termsAccepted: true`, a preregistered `seed`, and **`topicViewsHash`** binding
topic-bound view definitions frozen **before** any heldout question access.
Do not include `inputScope`/`expectedArticles` for a real corpus: production
preparation requires all **1,397** articles. The explicitly labelled
`adapter-test-fixture` subset bypass exists only for synthetic unit tests.

```powershell
node tools\memory-maintenance-qualification\quality-cli.mjs prepare-qed --articles .\ap-raw --local .\data_local_questions_assertions.json --global .\data_global_questions_assertions.json --plan .\qed-plan.json --output .\qed-prepared
```

Preparation freezes **20 local and 20 global questions, ten development and ten
holdout per category**. `construction.json` contains source documents only,
including original NITF and version/date metadata. All questions, assertions,
claims, nested evaluation metadata and split membership are evaluator-only.
The manifest records hashes/IDs, not hidden text. Keep both the manifest and
question packet away from repair workers. Retain original raw records separately
for provenance. Exact file bytes and combined corpus/question identities are
checked; malformed/duplicate data, invalid scores, missing provenance, incomplete
corpus and unaccepted terms fail.

AutoQ assertions are **pending human review, not reviewed gold or reference
answers**. `validate-qed-reviews --input .\qed-prepared --articles .\ap-raw
--review .\qed-human-reviews.json --output .\qed-review-validation.json`
requires each question's frozen `rowHash`, prepared `manifestHash`, independent
`author`/`reviewer`, `reviewedAt`, approved status, and every assertion rank with
`approved: true` and original-source witnesses `{sourceId, sourceHash, quote}`.
All raw article identities must still match the frozen manifest. Rejected or
changed assertions require a new preregistered experiment, not silent gold edits.

**Prepared data is not execution.** Saved-article quality and downstream reading
must be run and scored separately through the authorized production path and the
official toolkit with its settings recorded. AutoE execution/scoring is not
implemented or authorized by this adapter. No QED scores are manufactured here.
The independent reviewer and integration owner still need to approve gold,
freeze actual execution/configuration and permissions, obtain official datasets,
and authorize any later inference/scoring run.

## Isolated 19-source regression qualification

The existing configured-role live runner also supports `--baseline19` with
`--authorized-live-timeline`. This is a **fresh reproduction**, not a replay of
the October 11 runtime index or missing model responses. It requires separate
user authorization, a passing offline lifecycle/preflight receipt, the normal
configured models, and a frozen compiled checkpoint. Never fetch credentials,
substitute endpoints, or use an active user corpus to make the trial pass.

```powershell
if (Test-Path $PROFILE) { . $PROFILE }
node tools\memory-maintenance-qualification\live-qualification.mjs --product (Get-Location).Path --fixtures $fixtureRoot --output $ownedArtifactRoot --checkpoint $compiledCheckpoint --authorized-live-timeline --baseline19
```

The three original delta batches are applied with maintenance paused until all
19 active source revisions are present. Only then are the normal Wiki, Projects,
and Topics families resumed. Temporal-extension sources, human edit decisions,
and forgetting are not exercised by this scope. Original sources are read-only;
the runner creates its own store. Choose one content-only Markdown projection
per logical source and retain actual raw hashes/locators; Windows line-ending
normalization in a fixture manifest is not proof of runtime byte identity.

For this scope the external watchdog caps **total worker time at thirty-five
minutes from spawn**, including startup and the model preflight. Thirty minutes
are available before the five-minute cleanup reserve begins. This allowance is
time-based, not a request-count limit; other scopes retain their existing bounds.
There is no automatic repeat. First unexpected target
failures retain local terminal job details for diagnosis and stop the trial.
The baseline19 preflight also saves its original synopsis prompt and returned
model JSON in owned local artifacts before validation. These can contain source
content: retain them under the run's access policy, never in a public scorecard.
Known fixed synopsis validation messages have safe diagnostic categories; unknown
provider messages remain redacted. This capture does not retry a rejected output
or relax source evidence checks.
For a separately authorized, one-call diagnostic without corpus ingestion, use
`--authorized-live-preflight --capture-synopsis` instead of the timeline flags.
Capture alone does not authorize inference. Refresh the compiled checkpoint
after any production repair before starting another preflight.
Full eligible drain and enabled-path unchanged cold-reopen zero-call checks are
required before a clean-family claim; a partial run is not success. Actual
semantic review and the independent artifact benchmark remain separate gates.
Family activation refreshes its expected head and retries only the existing
`ViewBuildStaleError`, using the same deadline-bounded guard as offline
qualification. Semantic/provider failures are not retried by that guard.

### Resuming a bounded baseline19 run

Add `--resume $ownedRunDirectory` to the same authorized baseline19 command.
This reopens the existing isolated store; it does not create another corpus.
Each invocation gets its own 30-minute work/preflight allowance plus a five-minute
cleanup reserve. There is no automatic loop across invocations.

Resume requires the same physical product/fixture roots, fixture-plan hash,
compiled checkpoint, model/config dependency checkpoint and configured provider
identity. The owner/receipt IDs must match and both previous owned process IDs
must be absent. An exclusive run lock prevents concurrent invocations.
Prior receipts, preflight captures, admission and termination records are archived
before new inference. A stale lock from an outer-process crash requires explicit
ownership inspection; it is never silently deleted.

Completed operations must be an exact plan prefix. Actual latest mapped revisions
must still be ready and hash-identical. Recovery handles an acknowledged prefix,
a ready commit whose ledger acknowledgement was interrupted, and an existing
in-flight ingestion job. A failed/interrupted source can be explicitly retried on
the same source ID with a new retained revision and recorded predecessor; it is
not duplicated as another source. New admission is persisted before waiting.
Unexpected sources, duplicate canonical identities, changed completed content or
real product/role failures stop the run rather than being treated as progress.

This continuation scope is **baseline19 only** and admits bounded interruptions,
not automatic retries of a blocked view target. The full temporal/human-edit/
forget timeline still requires a fresh run. Successful source ingestion does not
by itself certify maintained-view drain or the cold-reopen checks.

## Executing the full LongMemEval suite

`longmemeval-live.mjs` runs real production ingestion, retrieval and synthesized
answers, followed by model judging. It is separate from the offline preparation
CLI and requires `--authorized-live-benchmark`.

```powershell
if (Test-Path $PROFILE) { . $PROFILE }
node tools\memory-maintenance-qualification\longmemeval-live.mjs --product (Get-Location).Path --dataset $officialCleanedDataset --judge-source $pinnedOfficialJudgeSource --output $ownedArtifactRoot --authorized-live-benchmark
# Later, explicitly authorize one more bounded invocation:
node tools\memory-maintenance-qualification\longmemeval-live.mjs --product (Get-Location).Path --dataset $officialCleanedDataset --judge-source $pinnedOfficialJudgeSource --output $ownedArtifactRoot --authorized-live-benchmark --resume $ownedBenchmarkRun
```

The pinned cleaned S dataset contains all 500 questions (SHA-256
`d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442`,
Hugging Face revision `98d7416c24c778c2fee6e6f3006e7a073259d48f`).
The seed `typeagent-longmemeval-full-2026-10-20` freezes an answer-independent
full-suite order. Construction contains only original session dates, roles,
turn text and positions. Official cleaned data has repeated IDs and empty turns;
both are preserved rather than deduplicated or replaced. The diagnostic adapter
also accepts the cleaned filenames.

The explicitly selected full-suite `historyPolicy: "official-supplied"` retains
all official history, auditing timestamps after the question rather than changing
the dataset. The pinned S export has 1,475 such sessions across 76 questions,
all on the question's calendar day. The diagnostic default remains strict
timestamp cutoff validation. Question text/date are supplied only at reading;
reference answers and evidence annotations are used only for evaluation.

The measured arm uses **FileMemoryService constructor defaults**, with one
Markdown document per original session position. The harness does not override
the index factory, source synopses, informational views, view drafts, answer mode,
answer limits, job polling interval, model settings or embedding settings.
Enabled background maintenance runs normally; the harness neither pauses it nor
forces an extra drain before answering. Actual service capabilities are frozen
in the run state. This measures the default document-memory answer path, not
native conversation-event ingestion or the quality of generated wiki articles.

The harness calls `answer()` directly, with the original question/reference date
and observational `includeDiagnostics`. There is no extra preliminary search.
The default indexed reader receives source-owned canonical dates separately from
question time. Its diagnostics record exactly the supplied fragments, source
IDs, temporal context and public response, without hidden reasoning. Selection
diagnostics additionally record eligible source IDs, full-question lexical terms,
candidate block identities, posting/language/preference score contributions,
block admission, emitted fragment counts, and actual read/response use. Candidate
admission is distinct from delivery: a selected block can emit no fragments when
the read budget is exhausted. Missing candidates are not assigned invented scores.
Diagnostics do not change reader input or answer configuration. Historical preliminary
recall@20 fields remain unmeasured, not zero, in new scorecards.

Default indexed answers consider the entire eligible corpus, rather than only
the last 32 manifest sources. They retain query terms beyond an eight-token
prefix, do not amplify every entity of a generic queried type, and allocate
bounded windows across relevance-ranked blocks before expanding long turns.
Multiple necessary turns from one session are allowed. Informational-view
construction retains its separate diversity policy. Output bounds remain 12
fragments, 2,000 UTF-16 characters per fragment, 32,000 read characters and 24,000
answer snippet characters. The reader requires supported named-event identity
and both operands for a comparison; prompt qualification is not a proof of
semantic entailment.

The previous KnowPro-only arm explicitly disabled synopses and maintained views.
Its immutable results are component diagnostics, not customer-default accuracy.
Do not resume those stores with this implementation or combine their scores with
a new default-configured run. Component-specific benchmark modes are not exposed.

Judge templates are loaded verbatim from the pinned official evaluator source
(SHA-256 `ecce9c4c79dc89d99534ac17b383a5cbb5b9f0c69ee98adaf0684742e3d95251`).
The actual judge uses the normal configured model/default generation settings,
**not an assumed `gpt-4o-2024-08-06` official judge**. Its actual provider model is
recorded. Invalid judge responses fail explicitly; no automatic positive labels
or invented independent-human approvals are supplied.

By default, each invocation has a 35-minute total cap with five minutes reserved for cleanup.
Job waits and the judge observe the work deadline. Aborting a polling delay
reaches the normal job-cancellation path and removes its abort listener.
The runner does not inject a global fetch abort below the production client:
in-flight production calls can finish during cleanup, under the outer watchdog
cap. Attempt outcome and close-start time are persisted before awaiting
supported close, so a forced shutdown does not leave an unqualified
`IN_PROGRESS` outcome.

For a separately authorized correctness pilot without a duration/call-count
budget, use `--work-minutes unlimited --max-questions 25`. This disables the
worker's work/total deadlines and the watchdog's post-admission time cap. Startup
health checks, normal provider request timeouts, ownership, checkpoint checks and
explicit error reporting remain active. There is no benchmark request-count cap.
The runner finishes only after the requested 25 additional questions have been
answered and judged, or an actual execution failure; negative judgments do not
stop the run. The selected prefix retains complete official histories. Its
accuracy is a 25-question pilot result, not full-500 performance. Freeze the
selected IDs before starting, and do not resume beyond 25 under that pilot's
authorization.

Use `--max-questions 1` to stop an invocation after its next completed
answer/judgment without changing the frozen 500-question schedule or order.
The default is 500; valid limits are integers from 1 to 500. Reaching the
invocation limit produces `PARTIAL_QUESTION_LIMIT`, not a full-suite success.
The same explicit resume command continues with the next unfinished case.
Completed histories and saved
hypotheses are reusable across explicit resume invocations; a failed non-budget
case requires review before retry. Corpus identity, dataset/plan, compiled and
model dependencies, benchmark implementation and configuration are frozen.
Configuration identity omits an absent optional model name, so Azure identities
compare exactly after JSON persistence.

Normal resume never bypasses checkpoint checks after a repair. A reviewed
recovery must use a separate store copy, preserve original receipts/state, and
record the original state hash, before/after runtime and engine identities,
exact patch hash, changed compiled files, unchanged model/config dependencies
and authorization. Validate retained completed-source hashes and readiness
without inference before continuing. Report such a run as a repaired
continuation, not an unchanged baseline. A copied lock directory can have a
fresh directory timestamp even when file timestamps are preserved; after
confirming the old owners exited, let normal stale-lock recovery handle it.
Do not delete an unverified live lock.

Local outputs include the manifest, resumable state, hypotheses, per-attempt
receipts, observed provider usage and scorecard. Missing questions stay missing.
Full-schedule accuracy is `null` until all 500 are judged; observed-prefix accuracy
is labeled incomplete, never a full-suite leaderboard score. Dollar cost remains
unknown without verified pricing. Official reference answers do not require us
to invent human approval for the unrelated, still-provisional local artifact gold.

## Profiling LongMemEval ingestion

Historical analysis is read-only and makes no provider calls:

```powershell
node tools\memory-maintenance-qualification\ingestion-profile.mjs analyze --run $ownedBenchmarkRun --output $newAbsoluteProfileDirectory
```

It reports completed-job wall time and nonoverlapping persisted boundaries:
admission through chunking, index preparation (extraction, embeddings and
indexing), persistence, and post-index completion. Missing milestones/job IDs
remain explicitly unknown. Failed/cancelled work is not included in the completed
job totals. Provider fetch durations overlap and are not an exclusive wall-time
breakdown.

For a separately authorized bounded diagnostic run, pass the normal supervised
runner arguments after `--`:

```powershell
node tools\memory-maintenance-qualification\ingestion-profile.mjs run --output $newAbsoluteProfileDirectory -- --product (Get-Location).Path --dataset $officialCleanedDataset --judge-source $pinnedOfficialJudgeSource --output $ownedArtifactRoot --authorized-live-benchmark --max-questions 1
```

The profile output directory must be new and its parent must exist. Use a
separate owned diagnostic run, not an immutable measured store. Normal checkpoint,
resume, authorization and deadline checks remain in force; this command does
not authorize future batches or bypass a runtime-identity change.

The wrapper enables the existing production `TYPEAGENT_MEMORY_SEARCH_TRACE=1`
flag, retains supervisor stdout/stderr and emits a 30-second process heartbeat.
It analyzes the actual worker's `stderr-<startedEpochMs>.log` only after confirming
worker/supervisor exit. A supplied log with zero stage events is reported as
unavailable, not successful timing capture. A nonzero runner exit code is
preserved; missing capture after a successful runner, analysis errors or lifecycle
validation errors fail profiling explicitly.

Reports correlate inclusive stage durations with ingestion trace/job IDs.
Nested stages cannot be summed into a critical path. This is stage instrumentation,
not a native CPU/disk profile, and its overhead must be measured before throughput
comparison. Reports omit source prose, answers, credentials and endpoint URLs;
raw worker logs remain local diagnostic artifacts under existing custody rules.

### Isolated development ingestion profile

After building, run representative synthetic Markdown, HTML and text admissions,
then a replacement, without loading benchmark questions, references or stores:

```powershell
node tools\memory-maintenance-qualification\ingestion-profile.mjs development --product (Get-Location).Path --output $newAbsoluteProfileDirectory --authorized-development-inference --native-worker-cpu
```

This uses the existing configured production service/model and a fresh store.
The watchdog bounds the invocation to 30 minutes. The optional native CPU profile
samples the worker, not merely its supervisor. Inspect the persisted outcome
and timing report before interpreting a partial or failed run.

Stage observations distinguish parsing/structural splitting, token-aware chunk
assembly, logical extraction calls, extraction attempts/output counts, embedding
calls/attempts/items, file API read/write/copy activity, serialization, segment
collection, admission, serialized queue wait/work and post-index cleanup.
Entities, topics and actions normally share one extraction response; their output
counts are not three separate provider calls. SDK-internal HTTP retries are not
observed by a model-method attempt counter.

Filesystem spans measure awaited API/logical wall time, not physical disk service
time or device I/O bytes. Parsing includes structural splitting; final token
chunk assembly is a separate span. Inclusive nested durations and concurrent
provider calls must not be added to infer an exclusive job critical path.
Enabled tracing/sampling overhead must be measured before throughput claims.

Segment-store hooks include validated file reads/writes, JSON parse/serialization,
hashing and root-queue wait/work. Coverage is explicitly partial: service-owned
file wrappers alone do not capture all index or segment activity. Use interval
unions to understand concurrent reads; a sum of overlapping API spans is not
elapsed disk time. Per-file tracing can produce many events even for small input
documents and is intentionally opt-in.

For an explicit development-only trace-off control, add `--no-stage-timing` to
the development command above. Its fingerprinted policy is retained in the
spec/state/admission/report; zero stage events are `INTENTIONALLY_DISABLED`,
not missing capture. Provider metadata, persisted job boundaries and optional
`--native-worker-cpu` remain available. This switch does not disable capture for
the benchmark profiling command. Model outputs and request counts may vary, so
one trace-on/off pair is not a controlled overhead or throughput estimate.

Segment GC marks at most eight independent nodes concurrently and deduplicates
shared nodes. Root publication and sweep remain guarded and ordered; failed
marking drains in-flight reads and cannot sweep. This does not enable concurrent
mutation of a corpus or parallel full-suite workers.

Answers now include optional actual-reader diagnostics. Preliminary search,
answer retrieval, text-reader evidence and knowledge-reader evidence have
separate source sets and recall denominators. Returned citations identify
supplied reader evidence, not an independent entailment judgment. Context/prompt,
synopsis schema and cache changes require a new measured arm rather than silently
resuming an older compiled checkpoint.

### Bounded serial full-suite controller

Only after repairing and qualifying the chosen arm, explicitly authorize an
overall allowance and launch a fresh frozen run:

```powershell
node tools\memory-maintenance-qualification\longmemeval-campaign.mjs --output $newAbsoluteControllerDirectory --allowance-minutes 120 --minimum-free-gib 2 -- --product (Get-Location).Path --dataset $officialCleanedDataset --judge-source $pinnedOfficialJudgeSource --output $ownedArtifactRoot --authorized-live-benchmark
```

The controller resumes only `PARTIAL_BOUNDED_WORK` or `PARTIAL_QUESTION_LIMIT`
after supported close and verified worker/supervisor exit. It stops on product,
checkpoint or close failures, no committed progress, insufficient remaining
allowance or disk reserve. Each invocation gets 1-30 work minutes plus five
minutes cleanup; two more minutes are reserved by the controller. The default
2 GiB free-space floor is not a full-suite storage-capacity estimate.

To restart a cleanly stopped controller, use the identical command and
`--resume-controller`. Original deadline, runner arguments and controller source
identity remain frozen; restart does not renew authorization. An interrupted
controller requires the exact recorded supervisors/workers to have exited and a
clean termination receipt. A stale lock or missing owned-run identity requires
explicit inspection/recovery; never remove an unverified live lock.
Invocation ownership, progress and heartbeat timestamps are persisted through
ordered atomic journal writes as well as reported on stdout.

The controller does not copy the whole store at every invocation and does not
parallelize mutations to a shared index. Cross-case worker concurrency requires
separate stores and measured provider, memory and storage capacity. Runtime,
schema or prompt repairs require a new arm or an explicitly audited migration,
not bypassing the normal checkpoint guards.

### Known-failure temporal repair diagnostic

For an explicitly authorized, fresh-store diagnostic selection, use
`--question-ids` with the exact IDs preregistered in the investigation.
Selection preserves the pinned construction order and rejects unknown or
duplicate IDs. It does not turn inspected failures into an unseen holdout.

```powershell
$ids = '77eafa52,gpt4_74aed68e,gpt4_59149c77,c4ea545c,gpt4_9a159967'
node tools\memory-maintenance-qualification\longmemeval-live.mjs --product (Get-Location).Path --dataset $officialCleanedDataset --judge-source $pinnedOfficialJudgeSource --output $ownedArtifactRoot --question-ids $ids --max-questions 5 --work-minutes unlimited --authorized-live-benchmark
```

Unlimited work must be explicitly authorized; startup validation remains
bounded. No request-count limit is introduced. The runner creates a new owned
directory, fresh corpora and frozen compiled/engine/config identities. Do not
resume an older arm after changing code, schema or prompts.

Historical construction now carries typed session/turn scopes. Question time
is a separate query/reader reference, not historical evidence or an import
timestamp. Official supplied-history eligibility includes same-day sessions
after question time. Optional answer diagnostics contain translated/compiled
queries, fallback decisions, selected references, reader public responses and
native combiner groups, never hidden reasoning.

To stop cooperatively, create `stop-after-question.json` inside that owned run
directory with `{"stop":true}`. The runner checks before admitting a question
and after grading, durably acknowledges the boundary and executes supported
close. Remove the marker before intentionally resuming. This control does not
turn a forced kill into a clean shutdown or cancel an already admitted question.

### Contextual relative-time windows

Default indexed answering, KnowPro answering/combination, and service query
translation share a policy for temporally used words such as "just", "recently"
and "soon". They imply context-dependent windows, not a fixed number of days or
an automatically exact event date. Useful qualified estimates and supported
bounds are permitted, with assumptions and owning-source citations. Explicit
dates take precedence; vague future plans do not prove completion. Domain scale,
midnight, event duration, non-temporal word senses, and source/event ownership
still matter. Inferences are not promoted into canonical imported event dates
or unsupported hard retrieval cutoffs.

### Lightweight progress snapshot

Each live run writes `progress.json` alongside `benchmark-state.json`. Both files
use the existing atomic file replacement helper, with the full ledger written
first; this is not a transaction across both files. A persistence failure is
explicit, not a silently stale success. The snapshot updates at durable state
transitions, including history admission/completion, answering, judging and close.
It is not a periodic heartbeat or proof that a process is still alive; inspect
`updatedAt`, job progress and termination receipts when diagnosing a stall.

- `currentQuestion.number`, `.total`, `.id`, `.status`: question X of this
  invocation's target, not X of the frozen 500-question inventory.
- `currentQuestion.historiesCompleted`, `.historiesTotal`, `.sourceKey`: current
  history-level progress. Detailed extraction progress remains in the owned job.
- `gradedQuestions`, `passedQuestions`, `failedQuestions`, `passPercentage`:
  pass percentage among graded answers only; null before the first grade.
- `completionPercentage`: graded questions divided by the invocation target.
- `executionFailures`: execution errors, separate from incorrect graded answers.
- `targetQuestionIds`, `targetGraded`, `outcome`, `supportedClose`: frozen
  invocation scope and lifecycle. A normal 50-of-500 run ends with
  `PARTIAL_QUESTION_LIMIT`, `targetGraded: true` and supported close complete,
  not a claim to have executed all 500.

Resumed invocation percentages exclude previously completed cases, while the
full ledger/scorecard preserve cumulative results. No question text, answers,
source text, provider request payloads or credentials enter the lightweight file.

For an authorized 50-question iteration, omit `--question-ids` and use
`--max-questions 50 --work-minutes unlimited` on a fresh owned output root. This
uses the first 50 questions in the pinned answer-independent construction order.
It may overlap earlier development questions; it is not a new holdout.

### Continue past failed question imports

Startup retains its default two-minute allowance. An explicitly larger retained
store can use `--startup-minutes 10`; only integer allowances from one to ten
minutes are accepted, before opening a run. This changes only the watchdog's
initialization/admission deadline, not work duration, request limits or product
settings. There is no unlimited-startup mode. Specs/admission receipts preserve
the chosen allowance. A startup timeout is not evidence of resumed ingestion
throughput, and the last progress snapshot can remain stale after a forced exit.
With `TYPEAGENT_MEMORY_SEARCH_TRACE=1`, the harness also gives initialization
an existing product timing context and emits `service.initialize` duration;
otherwise that wrapper is inactive. Enabling diagnostics adds observation
overhead and should be recorded when comparing restart throughput.

With explicit `--continue-after-import-failure`, a terminally failed ingestion
job fails that question, records its job/stage/progress and failure category,
and continues to the next question's independent corpus. The incomplete corpus
is never answered or graded, and its failed history is not silently omitted.
Cancellation, filesystem/persistence errors, provenance mismatches, answer
failures and judge failures remain fatal. Without this flag, import failures
retain the original fail-fast behavior.

This mode freezes the first `--max-questions` IDs as the iteration target,
including already graded and failed questions on resume. For an existing
iteration it verifies the original attempt's IDs against the pinned construction
prefix. It does not replace failed cases with later questions or run another
50 after the existing grades.

Progress retains `passPercentage` among graded answers and `completionPercentage`
as graded/target. Additional `skippedImportQuestions`, `processedQuestions`,
`processedPercentage` and `targetProcessed` count terminal import failures as
processed, not graded or passed. An exhausted target with import failures ends
`QUESTION_TARGET_COMPLETED_WITH_IMPORT_FAILURES`, not full-suite success.

Resuming across a reviewed harness-only update additionally requires
`--previous-engine-hash <exact-prior-hash>` with this mode. Prior state,
progress, scorecard, hypotheses, admission and termination receipts are archived
before startup; the engine transition is recorded. Compiled product, dataset,
model/configuration and dependency identity checks remain mandatory. This is not
permission to resume changed product code against old stores.

The provider observer now records response time, per-choice finish reason,
content character count, refusal presence and tool-call count, alongside existing
usage/model/status metadata. It still returns the original response unchanged
and records no prompt, answer, refusal text or credentials. These fields help
distinguish future empty responses, filtering and truncation; they cannot
retroactively recover bodies or finish reasons absent from old observations.

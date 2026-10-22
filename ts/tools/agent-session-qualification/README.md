# Agent session qualification

Standalone runner over the **compiled production** `FileMemoryService`. No build,
dependency installation, credential changes, or persistent configuration changes
are performed. Run from `ts` in a profile-initialized PowerShell:

```powershell
if (Test-Path $PROFILE) { . $PROFILE }
node --test .\tools\agent-session-qualification\evaluate.test.mjs
node .\tools\agent-session-qualification\evaluate.mjs --fixture-root '<fixtures>' --run-directory '<new-persistent-run>' --mode protocol
node .\tools\agent-session-qualification\evaluate.mjs --fixture-root '<fixtures>' --run-directory '<another-new-run>' --mode live --provider copilot --embeddings copilot --case case-one,case-two
```

The run directory's parent must exist; the run directory **must not exist**.
`--case` is repeatable. Defaults: `--mode protocol`, `--provider configured`,
`--embeddings none`, `--max-model-calls 80`, `--timeout-ms 1200000` (twenty-minute
default; explicit values up to 7200000/two hours are supported), and
`--max-questions 3` per case. Set questions to zero for import-only metrics.
Every tracked chat/embedding invocation has a 120-second deadline.
`--max-model-calls` is shared by chat completions and uncached embedding
invocations, including additional observed embedding HTTP retries. Cache hits
consume no calls. Raise the explicit budget for long embedding-enabled pilots
(for example `--max-model-calls 5000 --timeout-ms 7200000`).
Live question runs additionally assess up to eight artifacts in stable memory-ID order
in one bounded judge call using only each body and its original evidence.
Capacity-blocked/no-artifact support assessments retain a zero denominator.

## Wall-time and CPU profiling

[profile.mjs](./profile.mjs) is an opt-in wrapper over the same evaluator and
compiled production service. It does not change model routing, call limits,
import chunks, cache identity, polling intervals or privacy checks. It hooks
storage/index/session methods, actual corpus read/write-lock admission, model
calls, metric-log persistence and asynchronous filesystem operations. Hook
contracts fail explicitly if production methods change.

From `ts`, with the existing S05 failed checkpoint available:

```powershell
if (Test-Path $PROFILE) { . $PROFILE }
$reposRoot = Split-Path -Parent (Split-Path -Parent (Get-Location).Path)
$runs = Join-Path $reposRoot 'memoryDemo\validation\agent-sessions'
$outer = Join-Path $runs ('profile-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$cpu = Join-Path $outer 'cpu'
New-Item -ItemType Directory -Path $cpu -ErrorAction Stop | Out-Null
node --cpu-prof --cpu-prof-interval=10000 "--cpu-prof-dir=$cpu" --cpu-prof-name=profile.cpuprofile .\tools\agent-session-qualification\profile.mjs --profile-directory (Join-Path $outer 'timing') --fixture-root (Join-Path $reposRoot 'memoryDemo\fixtures\agent-sessions') --run-directory (Join-Path $outer 'run') --case longmemeval-s-000 --mode live --provider copilot --embeddings copilot --max-model-calls 5000 --max-questions 1 --timeout-ms 7200000 --resume-from (Join-Path $runs '2026-10-21-s-live-05-recovery')
```

This forks the same failed state used by S07, retaining its source/request/model
checks and final original-state immutability audit. It profiles the remaining
import, QA, restart/replay, privacy rebuild and harness accounting, **not** a
fresh 510-event import or a retrospective decomposition of the old run chain.
Omit `--resume-from` for a new import. Profile output must be new, outside the
evaluation directory and outside the original checkpoint.

- `timing\progress.json`: current aggregate snapshot, refreshed every 30 seconds.
- `timing\profile.json`: final observed window, mutually exclusive wall buckets,
  inclusive/self operation durations, open operations, HTTP status counts and
  numeric Retry-After values, filesystem failure codes, CPU/resource usage and
  event-loop delay/utilization.
- `cpu\profile.cpuprofile`: V8 sampling profile at 10 ms, including startup.
- `run\`: unchanged evaluator receipt, call logs and case artifacts.

Wall buckets select the highest-priority active leaf operation; simultaneous
categories are explicit. They partition elapsed time but do not prove causal
critical-path ownership. Inclusive operation totals overlap; self durations
subtract the union of direct child spans, not detached asynchronous work.
Provider logical spans include response consumption and endpoint discovery;
HTTP spans stop at response headers. Native SQLite I/O and SDK child-process
internals are not filesystem-hooked. CPU sampling and profiling overhead must
be considered when comparing to an uninstrumented run.

No contents, prompts, credentials, endpoint URLs or general headers enter the
timing aggregates. Progress failures are surfaced rather than silently ignored.
The wrapper restores hooks on completion. The profiling tests are included with:

```powershell
node --test .\tools\agent-session-qualification\evaluate.test.mjs .\tools\agent-session-qualification\rescore.test.mjs .\tools\agent-session-qualification\profile.test.mjs .\tools\scripts\test\agentSessionScale.spec.mjs
```

### Deterministic storage comparison

[agent-session-storage-benchmark.mjs](../agent-session-storage-benchmark.mjs)
compares the compiled segmented generation store with the existing single-binary-
file snapshot store using identical fixed extracted records and normalized
1536-dimensional float32 vectors. It asserts exact message/vector roundtrips and
records an input hash, write/read/collection timings, filesystem operations and
final logical file/byte inventories:

```powershell
if (Test-Path $PROFILE) { . $PROFILE }
node .\tools\agent-session-storage-benchmark.mjs '<unused-output-directory>'
```

New segmented publications use readable, byte-targeted JSON records and binary
vector blocks rather than numeric-vector JSON leaves. A hashed publication
catalog retains shared immutable artifacts; ordinary collection is scheduled
separately, while source-removal cleanup remains synchronous. A bounded verified
byte cache avoids rereading unchanged backing without sharing mutable vectors.
Legacy v1 checkpoints remain readable and are not rewritten in place.

The profiler distinguishes `.segments` artifacts as `index-json` and
`index-binary`; earlier profiles classified many of these as `other-json`.
Compare aggregate filesystem totals across versions rather than treating those
role labels as unchanged. Inclusive stage totals overlap. File reuse reduces
persisted work but does not make full logical hydration, serialization or hashing
O(delta). Binary I/O is buffered; no OS memory mapping is used.

## Fixture contract

`manifest.json`:

```json
{
  "schemaVersion": 1,
  "cases": [
    {
      "caseId": "case-one",
      "sessionId": "public-session",
      "repository": "owner/repository",
      "importType": "agent-session-jsonl",
      "input": "imports\\case-one.jsonl",
      "gold": "gold\\case-one.json",
      "sha256": "<SHA256 of exact input file bytes>",
      "provenance": {
        "public": true,
        "license": "MIT",
        "sourceUrl": "https://example.org/public-trajectory"
      }
    }
  ]
}
```

Inputs must be whole normalized, licensed public trajectories, not private
sessions. Provenance/license validation checks the manifest declaration, not the
legal validity of a third party's license claim. Events use production normalized
schema v1, unique IDs, matching session IDs, and text of at most 12,000 UTF-16
characters. The production parser remains authoritative. Any parser losses,
redacted text changes, cursor/accounting differences, fabricated citations, or
invalid model schemas fail the run; nothing is silently repaired or truncated.
Import requests contain at most 64 KiB and 100 records, followed by an explicit
empty final request.
Optional `case.goldSha256` is checked against exact gold-file bytes before memory
runtime initialization or QA. The actual gold hash is retained in the case
receipt; the evaluator-only copy uses those same verified bytes. Optional artifact
provenance such as `artifact.rowSha256` and `artifact.responseRevision` remains in
the fixture-manifest snapshot, never in imported memory.

Gold:

```json
{
  "questions": [
    {
      "questionId": "original-benchmark-question-id",
      "question": "What happened?",
      "answer": "Evaluator reference answer.",
      "answerType": "optional benchmark label",
      "evidenceEventIds": ["original-event-id"],
      "requiredTerms": ["optional deterministic term"]
    }
  ]
}
```

`questions` may be empty. Gold never enters source import, distillation, retrieval,
or answer prompts. Only the question enters each answer prompt; reference answers
enter the separate judge prompt after all paired answers for that question.
Question text is forwarded unchanged to every answer arm and the judge,
including any `Question date: ...` prefix from the benchmark projection.

## Modes and interpretation

- **Protocol:** explicitly controlled offline persistence/substring index and
  empty-memory extraction. No model or network calls. Tests projection, cursor,
  exact source retention, no-work replay/restart, and source-forget tombstones;
  does **not** measure semantic quality. Scope filtering is not applicable when
  extraction yields no memories.
- **Live:** production KnowPro indexing/search. A single tracked chat model supplies
  KnowPro, distillation, all answer arms, and judge roles. With `--provider copilot`,
  the runner obtains `gpt-6-luna` context/prompt/output limits from the existing
  shared client's `listModels().capabilities.limits` and records that source and
  the exact advertised limits. Missing, disabled, invalid, or conflicting entries
  fail; identical duplicates are accepted. Output reservation is bounded to
  `min(8192, advertised maximum)`. Other providers retain the explicit conservative
  64k context/48k input/8192 output budget. Serialized admission uses UTF-8 byte
  upper-bound accounting. Output reservation is an admission estimate, not a
  provider generation cap (the adapter rejects completion-limit settings).
  Full context is explicitly capacity-blocked if it does not fit.
- **Embeddings:** `--embeddings none` preserves the original disabled configuration.
  `--embeddings copilot` is live-only and explicitly selects the production
  embedding-provider route, `text-embedding-3-small`, 1536 dimensions, without
  fallback to another provider/model or lexical-only success. This overrides
  conflicting named embedding profiles in process memory only, not on disk.
  Provider-managed identity and document/query roles are preserved; all three
  DocMemory embedding lanes use the tracked production cache. Tracking sits below
  that cache. Embedding admission uses the already-installed conversation
  dependency `gpt-tokenizer`, explicitly **cl100k_base**, not UTF-8 byte counts or
  the chat tokenizer. Special-token-looking public strings are counted literally.
  Inputs remain unchanged. Actual counts must be at most 8192 tokens per item;
  an over-limit item fails without truncation. Aggregate-overlimit inputs are
  split sequentially at 300,000 actual tokens and the smaller of the production
  model's batch size and 2048 items. These are the documented
  [OpenAI-compatible embedding API ceilings](https://developers.openai.com/api/reference/resources/embeddings/methods/create),
  not freshly advertised Copilot capabilities. Every resulting raw API invocation
  is individually timed, hashed, budgeted, cancellable, and identity/role tracked;
  per-item counts, batch totals, and tokenizer package/version are retained.
  Vector order matches original input order; failures never return partial
  success. Provider failures and admission refusals invalidate the run even if a
  consumer tries to degrade.
  The adapter may refresh authentication once after HTTP 401/403, using the same
  model/provider; each observed HTTP attempt is recorded and budgeted. The
  scoped fetch wrapper propagates cancellation and retains only whitelisted
  returned model/token usage metadata—never endpoints, headers, bodies, or vectors.
- `configured` consumes normal defaults and existing process environment.
  `config.local.yaml` and `.env` are intentionally **not** read; operational
  `loadConfigSync` uses nonexistent run-local override paths.
  `copilot` uses the existing signed-in direct chat adapter with requested
  `gpt-6-luna`, no fallback model, and no tool-equipped SDK agent sessions.
  Authentication failure is a failure, never a success substitute.

Paired arms are no-memory, raw episode RAG, repository-scoped distilled memory,
and admitted full context. Scores expose deterministic required-term counts,
supplied-evidence support, original-event validity, and optional gold-evidence
recall separately. Judge judgments are **same-model-role assessments**, not
independent human evaluation. These trace regressions and self-baselines do not
reproduce other systems or constitute an official comparative benchmark.
Artifact support is explicitly a self-model-role assessment, **not**
independently established atomic-claim precision and not a satisfied 95% gate.
All public text is untrusted evidence without execution authority.

## Persistent outputs

`receipt.json`, `fixture-manifest.json`, `model-calls.json` (live),
`embedding-calls.json` (when embeddings are invoked), and per-case
`input.jsonl`, `gold.evaluator-only.json`, `artifacts.json`,
`source-projections.json` (complete pre-forget source text and exact event spans),
and `results.json`.
Top-level `predictions.<caseId>.<arm>.jsonl` files contain exactly
`{"question_id":"<original ID>","hypothesis":"<answer>"}` records for subsequent
official LongMemEval scoring. Separate case files avoid conflating the same
question in oracle and long-history conditions. Capacity-blocked/unanswered arms
produce no prediction record. These files are **predictions only**, not official
scores; no official GPT-4o scorer is invoked here.
The production service writes checkpoints under `state`. Original question IDs,
answers, judgments, source offsets, denominators, per-chunk timings, replay call
deltas, elapsed time, observed peak RSS, and disk bytes are retained.
Zero-denominator rates are `null`, never vacuous 100%.
KnowPro message locators are explicitly distinguished from verified source-char
locators. KnowPro message chunks can reflow whitespace (including punctuation
spacing); the runner requires a unique, contiguous alignment preserving every
non-whitespace character to the exact source, records the corresponding original
character range, and does not call that snippet verbatim evidence. Arbitrary
wrappers, changed words/punctuation, ambiguous matches, stale identities, and
incorrect source-char snippets fail validation. Independently verified complete
original episode projections, deduplicated by source, supply raw RAG—not the
reflowed snippet. Every projected event still resolves with exact UTF-16 offsets
and byte-for-byte-identical JavaScript text against the original event.

Capacity blocks are explicitly scoped to the **harness conservative admission
budget**, using recorded SDK-advertised limits for Copilot. They do not establish
a physical provider-context failure. Historical runs retain their original
64k/48k facts; the runner never rewrites previous receipts.

The final destructive check forgets one source in the run's own corpus and
verifies invalidation/reimport rejection. `artifacts.json` preserves the
pre-forget checkpoint for evaluation; `state` intentionally contains the
tombstone. Receipt failures are safely classified without retaining provider
errors, endpoints, authentication headers, or secrets. Exit status is nonzero
unless the run completes. Failed runs are retained and never overwritten.
If final disk accounting fails after a deadline, `diskBytes` is `null` and its
secondary safe classification is retained as `diskBytesFailure`; it does not
replace the primary `timeout/global-timeout` failure in the saved receipt,
returned result, or CLI summary.

## Recovering a failed import into a new run

`--resume-from '<finalized-failed-run>'` is opt-in and supports one selected case
with an unfinished import request, using protocol mode or the same live Copilot
model/provider configuration. The destination must be **new**, have an existing
parent, and be outside the original run (including filesystem aliases).

Before opening service state, the runner verifies the original finalized failed
receipt, selected fixture/scope/session/corpus, exact input and evaluator-only gold
snapshots/hashes, every deterministic submitted request hash, committed event
digests, and pending original episode evidence. Live recovery also checks retained
`gpt-6-luna` call identities and exact document/query embedding semantic identities
against the current production route, including dimensions and artifact hash.
This verifies recorded provider/model identities, not unrecorded provider weight
revisions. Completed, running, changed, multi-case, or mismatched runs are rejected.
One shutdown-specific exception permits a production checkpoint in `cancelled`
state when the finalized harness receipt records `timeout/global-timeout`, its
elapsed time reached the configured deadline, and its last committed receipt
agrees with the checkpoint's identity, cursor, source/memory counts, and loss
accounting. Request hashes, pending evidence and all other checks still apply.
Arbitrary cancellations and inconsistent deadline snapshots are rejected.

The original state is copied into independently writable regular files under the
new run's `state`; links and references to the original absolute run path are
rejected. Original receipt and full-run file hash/mtime inventories are retained
and verified unchanged after recovery. The original failed receipt is copied as
`resume-source-receipt.json`; no original artifact, prompt, or failure is replaced.

The production owner reuses the original corpus/session and deterministic chunk
requests. Previously submitted, fully committed requests are replayed without new
work. Their returned **current** receipt may have an advanced cursor and a failed
state from a later pending request; this is accepted only for validated historical
requests covered by the committed cursor. The unfinished request must then be
retried and settle successfully before any previously unsubmitted request.
For a validated deadline shutdown, the historical current receipt may similarly
be `cancelled`; this never skips the unfinished request.
Cached pending sources/extractions are reused by the production owner, not
reconstructed or marked complete by the harness. Final accounting, exact evidence,
replay/restart and source-forget checks remain unchanged.

`counters`, `elapsedMs`, call logs and `--max-model-calls` describe/bound **new**
attempts only. `cumulativeCounters` and `cumulativeElapsedMs` additionally include
the preserved source run (and its recorded prior recovery history, if any).
Peak RSS is observed for the new process only; original usage/latencies remain
available in the snapshotted source receipt rather than being invented.

For the archived S03 embedding-admission failure, run from `ts`, choosing a new
destination:

```powershell
if (Test-Path $PROFILE) { . $PROFILE }
node .\tools\agent-session-qualification\evaluate.mjs --fixture-root 'D:\repos\memoryDemo\fixtures\agent-sessions' --run-directory 'D:\repos\memoryDemo\validation\agent-sessions\2026-10-21-s-live-04-recovery' --case longmemeval-s-000 --mode live --provider copilot --embeddings copilot --max-model-calls 5000 --timeout-ms 7200000 --resume-from 'D:\repos\memoryDemo\validation\agent-sessions\2026-10-21-s-live-03'
```

## Separate LongMemEval correctness rescoring

`rescore.mjs` reads a **finalized** existing run's `receipt.json`,
`fixture-manifest.json`, per-case `results.json`, and exact snapshotted
`gold.evaluator-only.json`. It never imports trajectories, opens service state,
retrieves memories, regenerates answers, or modifies the original run. The output
directory must be new, have an existing parent, and be outside the source run.
Failed source runs may contribute completed answers, with their original state
retained; running source runs are rejected.

```powershell
if (Test-Path $PROFILE) { . $PROFILE }
# Offline: validate inputs and save the exact prompts/predictions without any model calls.
node .\tools\agent-session-qualification\rescore.mjs --source-run '<completed-run>' --run-directory '<new-preparation-directory>'
# Live: rescore retained predictions only, with the existing signed-in Copilot adapter.
node .\tools\agent-session-qualification\rescore.mjs --source-run '<completed-run>' --run-directory '<new-rescore-directory>' --mode live --case longmemeval-oracle-000 --max-model-calls 80 --timeout-ms 1200000
node --test .\tools\agent-session-qualification\rescore.test.mjs
```

Defaults are `--mode prepare`, all LongMemEval cases, all four retained answer
arms, `--max-questions 3` per case, `--max-model-calls 80`, and
`--timeout-ms 1200000` (explicit maximum 7200000). `--case` and `--arm` accept
repeatable/comma-separated selections. Only `longmemeval-*` cases are currently
supported. Capacity-blocked/missing answers are explicitly skipped, not invented.

The vendored `longmemeval-rubric.json` contains **verbatim prompt strings only**
from LongMemEval's
[`get_anscheck_prompt`](https://github.com/xiaowu0162/LongMemEval/blob/9e0b455f4ef0e2ab8f2e582289761153549043fc/src/evaluation/evaluate_qa.py),
pinned to commit `9e0b455f4ef0e2ab8f2e582289761153549043fc`, with the upstream MIT
notice. The fetched source file's SHA256 is
`ecce9c4c79dc89d99534ac17b383a5cbb5b9f0c69ee98adaf0684742e3d95251`.
Every template has a fixed SHA256 checked before use. No external code is executed
and no rubric is downloaded at scoring time.

The standard official rubric asks whether the response **contains the correct
answer**, permits equivalent answers/intermediate steps, and rejects a response
containing only a subset of the required information. It is not a requirement
that every additional noncontradictory detail appear in the short reference.
No answer-specific correction or forced-positive label is added. Task-specific
temporal, knowledge-update, preference, and `_abs` abstention templates are
preserved. `questionType`, `question_type`, or `answerType` supplies the task;
missing types use an explicitly recorded generic standard default, while unknown
types fail. Date-prefixed question text is forwarded unchanged.

**The judge remains Copilot `gpt-6-luna`: a NONofficial model and nonindependent,
same-model-role assessment, not the official GPT-4o benchmark judge.** The exact
official prompt is used without custom answer-key rules. Transport uses
temperature zero and plain yes/no output; verdict parsing is deliberately
stricter than the upstream substring parser. Existing tracked request admission,
advertised model limits, call budgets, and safe failures are reused. No embeddings
or tool-equipped agent sessions are used.

New outputs include `receipt.json`, `results.json`, `model-calls.json` (live),
`rubric.snapshot.json`, per-answer exact `prompts\*.txt` with hashes, and unchanged
`predictions.<caseId>.<arm>.jsonl` records. Original question IDs, exact gold hashes
(verified against every available retained hash), source receipt/result hashes,
old judgments/scores, and original artifact-support findings are retained.
Correctness and scoring-coverage metrics expose actual denominators; no scored
answers means a `null` rate.

**Correctness rescoring does not rejudge evidence support or erase unsupported
claims.** Original artifact-support errors (including negative assertions) remain
visible verbatim. A changed correctness label does not turn those findings into
supported claims, establish atomic-claim precision, or satisfy a 95% gate.

# Small LongMemEval indexing benchmark

This driver separates live answer quality, persistent-index recovery and
descriptive performance measurements. It uses the production LongMemEval runner
for answers and the real generic SQLite provider for transaction tests. It does
not download data, provide credentials, enforce a monetary cap or automatically
repeat paid attempts.

Run commands from this checkout's `ts` directory using a supported Node version
and its matching native `better-sqlite3` binary. Build first with
`pnpm run build`. The offline suite is part of `pnpm run test:memory-quality`:

```powershell
if (Test-Path $PROFILE) { . $PROFILE }
node --test tools\memory-maintenance-qualification\longmemeval-indexing.test.mjs
```

Tests use authored fixtures, real SQLite stores and owned child processes. They
make no provider calls and establish no LongMemEval accuracy or live speedup.
Private temporary test directories are removed after the test.

## Freeze data and execution identity

Obtain the pinned `longmemeval_s_cleaned.json` and official judge source through
your approved process. The existing runner rejects different bytes. Do not
substitute the oracle variant or shorten histories. Commit your candidate changes
before freezing: a dirty checkout or changed compiled/tool checkpoint is rejected.

Choose a **new private directory outside source control**. Do not use a production
store, an existing experiment or a shared output directory as the pilot itself.

```powershell
$product = (Get-Location).Path
$tool = Join-Path $product 'tools\memory-maintenance-qualification\longmemeval-indexing.mjs'
$pilot = Join-Path $env:LOCALAPPDATA 'TypeAgent\indexing-benchmarks\pilot-001'
$dataset = (Resolve-Path '<existing cleaned dataset JSON>').Path
$judge = (Resolve-Path '<existing official evaluate_qa.py>').Path
New-Item -ItemType Directory -Force (Split-Path $pilot) | Out-Null
node $tool prepare --product $product --directory $pilot --dataset $dataset --judge-source $judge
node $tool preflight --product $product --directory $pilot
```

Preflight prints an approval template, not an authorization. Save it as a private
JSON file, inspect the source inventory, estimate work using your actual provider
settings, arrange provider-side quotas where needed, and obtain approval before
changing any permission fields. Do not put credentials in the template.

The manifest selects one temporal-reasoning, knowledge-update and multi-session
case using category/ID/seed hashes. Full histories retain repeated session IDs by
original position, speakers, empty turns and original dates. Naive dates are
interpreted as UTC, not claimed to have explicit offsets. Construction, questions
and reference labels are separate files. Hash checks enforce integrity, not
filesystem access control: retain evaluator custody separately from tuning.

Approval binds the manifest, source/compiled/tool checkpoint, Node/platform,
chat configuration, embedding configuration, redacted runtime configuration and
dependency hashes. Permission
requires `publicDatasetApproved`, `configuredProvidersApproved` and
`acceptNoMonetaryCap` to be explicitly true. `workMinutes` is normally an integer from 1
through 15. For an explicitly authorized initial run without an overall work
budget, set it to `null` and set `unlimitedWorkApproved` to `true`. This removes
the work deadline in both production arms and the companion, not startup,
request, recovery-check or knowledge-readiness failure detection. The optional
`knowledgeMinutes` controls the existing readiness timeout from 1 through 60.
Time and question limits are **not financial limits**.

## Run the two live production arms

For a same-build comparison of the three parallelization changes, prepare a
**new** pilot with `--comparison indexing-parallel`. Both arms then enable
prepared indexing. A0 removes the bundled and all three individual indexing
parallel experiments; A1 enables the bundle. Other inherited performance
experiments remain identical.
An explicit `TYPEAGENT_MEMORY_TOPIC_CONCURRENCY` is rejected rather than
silently overriding the treatment. Each recorded arm includes `indexingParallel`.

Add `--first-case-only` to freeze one complete history for this comparison.
This schedules the first deterministically selected case in both arms, without
trimming any session or turn. The other two histories remain available for the
independent companion lanes but are not scheduled production cases. Reports
record the comparison and scheduled IDs. This is a bundled intervention, not
an attribution of savings to each change or an official accuracy run.

```powershell
node $tool prepare --product $product --directory $pilot --dataset $dataset --judge-source $judge --comparison indexing-parallel --first-case-only
node $tool preflight --product $product --directory $pilot
```

Authorize the new frozen checkpoint separately. Overall unlimited work does
not remove the existing finite production knowledge-readiness timeout; failures
and completed ingestion timings remain distinct from successful readiness.

### Prepare independent treatments without running inference

Use a new directory and `--comparison indexing-ablation --first-case-only` to
freeze four sequential conditions: `A0` (all parallel treatments off), `T1`
(topic-only), `S1` (synopsis-only), `E1` (embedding-only). Every condition enables
prepared indexing and uses the same complete first history with fresh stores.
The runner refuses another arm order or an inherited topic-concurrency override.
It removes inherited individual/bundled indexing treatments before selecting
exactly the requested one. Recorded `indexingTreatments` describe configuration;
provider/stage traces remain necessary to establish actual execution.

```powershell
node $tool prepare --product $product --directory $pilot --dataset $dataset --judge-source $judge --comparison indexing-ablation --first-case-only
node $tool preflight --product $product --directory $pilot
```

These commands do not run inference. A new approved checkpoint is required
before any `live` command. The tooling will not retry failed arms, add rounds or
combine treatments. Each later arm requires a terminated immediately preceding
arm. Reports compare each singleton to `A0` separately and leave incomplete
case/arm ratios null.

The production source loop now requires the local service's corpus-scoped topic
hold, records `topicMaintenanceCoalesced`, and releases it in `finally` before
readiness. Both arms/conditions use this orchestration. It preserves synopsis
and other-corpus eligibility rather than globally pausing maintenance. This is
a new engine revision and cannot be substituted into an older frozen pilot.
Structured readiness observations retain checkpoint state separately from safe
target diagnostics and unavailable visibility.

Use the approved JSON path below. The tool does not infer approval from this
guide, the implementation request or an existing model configuration.

```powershell
$approval = Join-Path $pilot 'approved.json'
node $tool live --product $product --directory $pilot --approval $approval --arm A0
node $tool live --product $product --directory $pilot --approval $approval --arm A1
```

For the default `prepared-indexing` comparison, A0 removes
`TYPEAGENT_MEMORY_PREPARED_INDEXING`; A1 sets it to `1`. Both enable
the same timing instrumentation. Each invocation has at most three questions
and the existing bounded startup policy. Finite work intervals have a five-minute
cleanup reserve; explicitly unlimited work has no overall deadline.
A1 requires a terminated A0 attempt. There is no automatic
retry, continuation or invocation allowance expansion.

The default same-revision comparison isolates preparation, not all indexing changes.
The frozen schedule runs A0 then A1, rather than interleaving cases. Report this
ordering confound. Actual case order, effective service capabilities, model
receipts, provider responses, source mappings, answer, reader evidence, citations
and pinned-prompt judge outcomes remain in private artifacts. Full completed
arms in the default comparison must show preparation stages present only in A1.
In the parallel comparison they must be present in both arms.
Each case uses a fresh store. Model/process/provider/OS caches are not certified
cold; the three cases within an arm still share a process.

Production raw spans remain in the owned stdout/stderr logs.
`indexing-traces.json` contains stage summaries, not every raw span:
counts, status counts, elapsed-time extrema/totals and numeric metadata extrema.
Memory and serialized output scale with the stage/metadata schema rather than
the number of events. Summed nested/overlapping spans are not wall time.
The companion retains its raw spans in `qualification-traces.jsonl` and returns
the same bounded `traceSummaries`. Logging overhead remains part of observed
elapsed time.

If an older driver failed while serializing an oversized trace array, preserve
its failed attempt and source checkpoint. Offline collection requires no
provider approval and makes no inference calls:

```powershell
node $tool collect-traces --directory $pilot --arm A0
node $tool collect-traces --directory $pilot --arm A1
```

This only writes a new trace-summary artifact after termination. It does not
repair a failed live case, change its outcome, overwrite its ledger or pretend
the original attempt used the newer driver. Record the postprocessing revision
separately. A later companion execution needs its own fresh manifest/checkpoint
when the driver changed; do not bypass the original checkpoint guard.

Each case also closes/reopens the original service and compares source-only
retrieval/revision eligibility. A closed-store clone receives destructive
forget/clear probes, including reopening after each operation. The original
corpus is not cleared. Empty retrieval is explicitly unexercised, not a passed
restart/forget check. These probes are not concurrent-forget tests.

## Generic SQLite and recovery companion

Approve `companionPreparationApproved` separately. This permits live extraction
and embeddings for the manifest's first selected history, independently of the
six production-service cases.

```powershell
node $tool companion --product $product --directory $pilot --approval $approval
```

The companion accepts one initial message, appends the remaining complete
history and captures its prepared tail before acceptance. Its versioned message
serializer verifies the source round trip. Provider replay matches the exact
method/input/embedding identity and preserves per-role batching capabilities.
A replay miss or inconsistent duplicate provider output fails, never falls back
to live inference.

These are capture/replay failures, not evidence that the configured provider is
unavailable or the index is incorrect. Guards also compare overlapping duplicate
calls after resolution and never overwrite an inconsistent accepted recording.
When capture fails, the accepted-prefix database and response-accounting ledger
remain; the in-memory provider-output tape is not a resumable capture journal.
Do not claim the fault matrix or live cancellation ran, or silently repeat paid
work. Revise the recording-identity strategy before another approved capture.

The offline portion compares workers/window 1/1 against 3/3, checks reference
metadata and full persisted state, then hard-terminates five owned Node workers:
before commit, after rows, after postings, after receipt and after SQL acceptance.
The first four recover only the accepted prefix and retry to the clean control;
the last restores the complete accepted generation. Posting/receipt checkpoints
surround one atomic artifact write, not separately durable publications.

Additional probes reject stale append/replacement during preparation and restore,
and verify cancellation drains an abort-ignoring **replay** call before cleanup.
Each recovery/replay attempt requires zero new provider invocations.

For the distinct **live** cancellation scenario, also approve
`liveCancellationApproved`. It makes additional real model calls against a
separate copy, cancels after a model promise starts without injecting provider
abort, waits for outstanding work to drain and requires unchanged accepted state.
For bounded runs, budget this extra work within the companion's approved interval. Without this
permission, live cancellation is explicitly unqualified.

The companion has its own existing watchdog and work signal, with a five-minute
cleanup reserve only for bounded runs. Failed attempts retain termination, observed responses and
partial stores instead of claiming success. Provider requests that fail before
a response can have unobserved usage/cost. The tool must not report that as zero.

## Frame correctness and optional historical comparison

The companion checks exact memory/SQLite parity on original session/turn IDs,
plus a separate 4,096-row synthetic fixture with 32 eligible rows. It checks
explicit-offset half-open instant bounds, calendar-domain rejection, missing
optional values, stale owners, query plans and versioned Unicode normalization.
A separate two-WAL-connection probe commits replacement between metadata
selection and hydration and requires a consistent old snapshot, followed by
the new snapshot on the next query.

JSON row parse counts measure actual full-row hydration; narrow-query timings
exclude construction but include the instrumentation/assertion overhead.
These are not live ingestion throughput measurements.

For a matched historical comparison, supply a separately built, clean
pre-extension merge checkout at `de15fe7a8`, using the same Node/native ABI:

```powershell
node $tool frames --product $product --directory $pilot --baseline '<baseline TypeAgent ts root>'
```

The tool verifies its full revision, records both compiled checkpoints, repeats
the same edge fixture and requires fewer hydrated SQLite rows for the eligible
selection. It neither creates a worktree nor installs baseline dependencies.
Without that build, the historical comparison remains unrun.

## Independent review and reporting

Once all six cases complete, create an evaluator-held review template:

```powershell
node $tool review-template --directory $pilot
```

Inspect each full case record, original references and supplied evidence. Save
your completed template separately, declare independent review, and fill every
boolean check. `citationSupported` means the answer makes no unsupported factual
claim, including when appropriately abstaining; `referenceConsistent` judges the
answer against the original reference/history; `judgeAgreement` records agreement
with the configured pinned-prompt judge, not an official-model certification.
Explain disagreements in `notes`. Review binds the exact case/evidence hash:

```powershell
node $tool review --directory $pilot --review-file '<completed review JSON>'
node $tool report --directory $pilot
```

The final command writes a fresh `report.json`. For an interim report, pass
`--output '<new private interim JSON>'` and reserve the in-pilot name for the final report. Existing
output files are not overwritten. The report keeps raw cases, independent human
checks, provider/replay distinctions, frame comparisons and missing outcomes
separate. It does not declare accuracy from a successful crash test.

Per-case process CPU, memory snapshots, process-lifetime maximum RSS, ingestion,
knowledge readiness, answer and restart timings have explicit boundaries.
GC/allocation counts remain null when unobserved. Service/SQLite spans expose
preparation, apply and commit work. Report raw paired samples from three
histories, not p95, statistical significance, a population speedup or an official
500-question score. Offline recovery timings are not live throughput.

Windows validation does not qualify WSL/Linux. Run and record the same checks
there before making a cross-platform claim.

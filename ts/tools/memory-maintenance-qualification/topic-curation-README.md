# Frozen topic-curation replay

This tool isolates topic curation from ingestion. It can capture a request,
compare indexed host work with reference scans, replay exact saved responses,
measure disposable persistence, or run explicitly authorized bounded inference.
It does not establish native readiness, answer accuracy or human-rated quality.

The LLM driver remains an LLM engine adapter. The separate
[`topic-decision-replay.mjs`](./topic-decision-replay.mjs) uses the existing
Decision generator and its native scheduling, not the LLM speculative scheduler.
Both use small shared loading, hashing, implementation-identity, atomic-progress
and disposable-storage utilities. No plugin/scheduler framework is introduced.

Run commands from `ts` after `pnpm run build`. Use private, **new** output
directories outside the original corpus store. Captured requests/responses
contain source evidence; do not upload them to public systems.

## Production defaults and experimental options

Evidence selection, ownership validation and lexical nomination use snapshot-local
indexes while retaining citation ordering and the existing top-24 nomination
policy. Similarity nominates comparisons; the model still judges equivalence.

Default curation retains legacy packing (up to 24 raw nodes, 32,000 payload
characters) and one worker. Hosts using `getConfiguredMemoryViewOptions` can opt
into the following settings; programmatic callers can use `topicCuration` on
`FileMemoryServiceOptions`.

| Environment variable                    | Values                               | Effect                                                                                                          |
| --------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `TYPEAGENT_MEMORY_TOPIC_INPUT_TOKENS`   | Positive integer                     | Packs against the complete serialized request, including instructions and schema, using native model inspection |
| `TYPEAGENT_MEMORY_TOPIC_PRIOR_FRACTION` | 0 through 0.5; requires input target | Reserves input and estimated output room for prior-concept comparisons                                          |
| `TYPEAGENT_MEMORY_TOPIC_CONCURRENCY`    | 1 or 2                               | Bounds speculative proposals; commits remain in canonical order                                                 |

Invalid settings fail explicitly. Experimental settings change policy/input
identity. Unset the variables to retain defaults.

`TYPEAGENT_MEMORY_TOPIC_CURATION_REUSE=true` (programmatic option
`topicCurationReuse: true`) separately opts into whole-input curation reuse for
both engines. Complete topic incidence, represented source revisions,
qualifications, suppression state, event influences and model/recipe must match.
Only physical index generation and sources with no topic occurrences may differ.
Older snapshots without a dependency witness retain exact-input-only resume.
Only the configured curated generator issues that witness; creating a raw
snapshot or returning arbitrary custom curation does not certify this closure.
Current-generation eligibility, authorization and publication checks remain in
force; obsolete jobs still abort. Relevant new evidence is not incrementally
curated by this first treatment.

`TYPEAGENT_MEMORY_TOPIC_WATERMARK=true` (programmatic `topicWatermark: true`)
adds private pinned-generation checkpoints and exact packet-prefix replay.
It requires curation reuse and single-worker generative curated topics; native
Decision and speculative two-worker execution reject this option. Defaults
remain unchanged.

Source additions may leave one old build running while the existing maintenance
scheduler coalesces one latest topic demand. Old curation checkpoints are durable
but private: they cannot satisfy public freshness or readiness. The final old
target is explicitly stale, not successful current publication. A catch-up build
reconstructs current packets in canonical order, reusing only the exact unchanged
prefix. Instructions, payload, schema and hidden original membership must match;
the first changed ordering, packet boundary, qualification or nomination ends
replay. Cached responses pass the production parser without provider repairs.
Receipts store packet-local candidate/evidence IDs rather than repeated expanded
concept membership. Existing first/every-eighth/final checkpoint frequency stays
unchanged.

Source removal/replacement, suppression, events and model identity changes fail
the continuation checks. Invalidated private state is discarded; source/event
forget also purges it from history. Current publication clears the private state.
Manifest state and dirty-family reconciliation reconstruct latest demand on reopen;
there is no additional persistent job queue. Arbitrary custom generators do not
certify packet receipts. Relevant evidence is reconsidered wherever the actual
packet changes; this is not general per-node reverse-dependency maintenance.

Tracing also records `topic.curation.packet.reuse`, `topic.watermark.stage`
(`published: false`) and superseded raw incidence withholding. Private commits
are not counted as current completion.

Validated cluster receipts and maintenance priorities are rebound to the new
physical fingerprint only after validating the old snapshot. Completed concepts,
audited lazy summaries and deferred decisions survive unchanged input; an
unfinished packet is still rerun. The flag is not a readiness or latency
qualification result.

With `TYPEAGENT_MEMORY_SEARCH_TRACE=1`, existing search timing records proposal,
provider start/completion/failure, abort, discard and successful commit separately.
Attempts identify individual executions within a trace. A signal-ignoring
provider's late completion remains recorded with `aborted: true`; a failed
checkpoint cannot produce a successful speculation commit.

### Offline work-avoidance and group-size measurements

The paired work benchmark exercises production capture and generative curation
with 55 authored nodes and synthetic deferred decisions. Each pair uses fresh
baseline/candidate snapshots; order alternates. It records compiled implementation,
dirty patch and fixture hashes, exact output parity, attempts, completions and
host-stage timings. It does not measure ingestion/publication readiness or model
latency and does not qualify semantic quality or foreground p95.

```powershell
node .\tools\memory-maintenance-qualification\topic-work-benchmark.mjs `
    --samples 20 --output (Join-Path $newPrivateDirectory 'topic-work.json')

node .\tools\memory-maintenance-qualification\topic-work-benchmark.mjs `
    --watermark --samples 20 `
    --output (Join-Path $newPrivateDirectory 'topic-packet-work.json')

node .\tools\memory-maintenance-qualification\storage-write-benchmark.mjs `
    --workload batch --samples 5 --group-size 2 --members 8 `
    --output (Join-Path $newPrivateDirectory 'group-two.json')
node .\tools\memory-maintenance-qualification\storage-write-benchmark.mjs `
    --workload batch --samples 5 --group-size 8 --members 8 `
    --output (Join-Path $newPrivateDirectory 'group-eight.json')

node --test .\tools\memory-maintenance-qualification\topic-work-benchmark.test.mjs `
    .\tools\memory-maintenance-qualification\storage-write-benchmark.test.mjs
```

The watermark benchmark separately compares against whole-input reuse on 55
existing nodes plus one appended topic. It reports actual provider calls and
replayed packets/nodes with exact latest-output parity. It measures host
capture/curation work only, not continuous-ingestion drain, model latency,
foreground p95 or semantic quality.

Run measurement commands sequentially without competing builds or tests. Outputs
are exclusive new files. Batch `--members` accepts 1-512 and splits imports into
requests of at most 50 members; `--group-size` uses the existing product commit
policy and accepts 1-100. The fake-index workload asserts actual provider batches,
copies, manifest publications and final source content, and observes first-member
readiness with 5 ms polling. Neither switch changes a product default.

First-member responsiveness must be evaluated separately from total batch time.
The initial eight-member screen reduced copies/publications from four to one,
but worsened first-member readiness, so it does not justify promoting group eight.

Token estimates do not replace the client's conservative byte-based provider
admission guard. Packing also checks an experimental output estimate of
`256 + 2048 * suppliedNodes` for lazy curation (`3072` per node otherwise).
This is not a proven worst-case schema bound or a new provider output cap.
A larger input target cannot cure output-bound prior starvation.

Speculative responses are reusable only if rebuilt instructions, payload,
schema, packet boundary and hidden original membership still match. Newly
created targets can invalidate later proposals even across disjoint sources.
Stale calls are aborted/drained and rerun. Failure and cancellation cannot
publish pending speculative work.

Context-budgeted packets explicitly bind permitted evidence to all original
member sources, not only a prior concept's retained citations. Strict validation
and bounded repairs remain in force. Detailed summaries stay lazy.

## Modes

| `--mode`            | Purpose                                                          | Provider calls    |
| ------------------- | ---------------------------------------------------------------- | ----------------- |
| `capture` (default) | Save one packet boundary and diagnostic request                  | None              |
| `cpu`               | Exact reference/index parity and operation timings               | None              |
| `recorded`          | Parse saved responses with identical instructions/payload/schema | None              |
| `storage`           | Clone, stringify and disposable cold ViewHistory commits         | None              |
| `index-storage`     | Real segmented reader/writer with retained vectors               | None              |
| `live`              | Bounded configured-model curation                                | Requires `--live` |

Choose `--history <view-history.git> --commit <hash>` (and `--job` if needed)
or `--input <captured-build-input.json>`. Capture uses one worker.

```powershell
if (Test-Path $PROFILE) { . $PROFILE }
$tool = '.\tools\memory-maintenance-qualification\topic-curation-replay.mjs'
$history = Join-Path $corpusStore 'views\view-history.git'

node $tool --history $history --commit $commit --output $newCaptureDirectory
node $tool --mode cpu --history $history --commit $commit `
    --samples 5 --warmups 1 --output $newCpuDirectory

node $tool --mode recorded --history $history --commit $commit `
    --nodes 96 --input-tokens 32000 --prior-fraction 0.25 --concurrency 1 `
    --max-calls 8 --responses $matchingResponses --output $newReplayDirectory

# Only after authorizing provider calls:
node $tool --mode live --live --history $history --commit $commit `
    --nodes 96 --input-tokens 32000 --prior-fraction 0.25 --concurrency 1 `
    --max-calls 8 --timeout-ms 240000 --output $newLiveDirectory
```

Recorded responses must match the current policy/settings exactly. Offline
wire previews use explicit nominal constraints, not actual deployment usage.
The tool records source/compiled identities and rejects implementation drift.
Run conditions sequentially without competing bulk inference/builds, including
across machines when provider capacity is shared.

## Progress, organization and persistence

- `--nodes` selects a canonical subset but retains full source evidence context.
- `--resume` uses historical validated progress and cannot combine with `--nodes`.
- `--progress <progress.json>` resumes atomic private checkpoints only under
  matching input, node selection, implementation, endpoint and settings; cannot
  combine with `--resume`. Progress includes a curation/state digest.
  Subset checkpoints use the same `--nodes` selection on restart. The complete
  frozen source incidence is validated before selection; checkpoint membership
  is validated against only the selected nodes without discarding source context.
- `--organize` runs the actual configured organization stage after complete-input
  curation and saves a validated snapshot. Only live/recorded modes support it;
  it cannot combine with `--nodes`. Calls/deadlines also bound organization.
- `--mode index-storage --index-file <corpus_data.json>` measures the production
  segmented backend without extraction or embeddings. Writes use disposable
  stores and check payload parity and unchanged artifact reuse.

Partial call-limited live/recorded runs retain validated progress and exit 2;
other failures exit 1; validated completion exits 0. Private `--progress` files
from older schemas or changed implementations fail closed. Explicit `--resume`
from a history state remains a recovery workload, not fresh qualification.

All scratch stores are created inside the new artifact directory and removed
after parity checks. Neither storage mode writes the source history/index.
Output within the source store, including through a parent-directory symlink,
is rejected. Existing output directories are never overwritten.

## Exact Decision recording, playback and resume

The Decision driver runs `createConfiguredTopicGenerator` with one options object
and `mode: { kind: "decision", createOptions }`. Positional engine arguments are
rejected; generative callers use `mode: { kind: "generative", settings }`.
Thus metadata, local adjudication, maintenance and
organization use the same generator as production, and every native or
generative completion consumes the same explicit call budget/deadline. Native
execution settings are passed unchanged; concurrency 24 is supported and never
replaced with the LLM one/two-worker scheduler.

Supply `--identity-file` with a frozen JSON manifest:

```json
{
  "policyIdentity": "<exact configuredTopicDecisionIdentity result>",
  "packetPolicy": "v2",
  "execution": {
    "concurrency": 24,
    "clusterValidation": true
  },
  "native": {
    "provider": "azure",
    "providerSource": "factory",
    "model": "<captured native model>",
    "configGeneration": 1
  },
  "generative": {
    "model": "<captured generative model>",
    "wireIdentity": "<frozen deployment/API/configuration identity, no secrets>",
    "inspection": true,
    "completionSettings": {
      "temperature": 0,
      "response_format": { "type": "json_object" }
    }
  }
}
```

Use the native model's exact exported identity fields and runtime generation,
not the example values. The frozen input's `model` must equal `policyIdentity`;
the tool refuses to silently relabel a captured workload. The configured policy identity includes applicable
native and generative deployment configuration. Live recording verifies it
before and after generation and checks native model identity on every dispatch.
`inspection: true` (the default) retains actual generative wire inspection,
including serialized requests, constraints and token estimates; playback returns
these exact saved inspections without constructing a provider. Set it to false
only for a legacy injected model with no inspector; recording refuses a
capability mismatch. Completion settings are also checked on every live call.
The CLI initializes runtime configuration, not a provider, in offline modes;
historical generation mismatches are refused, never remapped.

```powershell
if (Test-Path $PROFILE) { . $PROFILE }
fnm use 24.22.1
$decisionTool = '.\tools\memory-maintenance-qualification\topic-decision-replay.mjs'

# Provider-free capture of the next native or generative boundary:
node $decisionTool --mode capture --input $frozenInput `
    --identity-file $identityFile --output $newCaptureDirectory

# Only after explicit authorization; do not run as an offline test:
node $decisionTool --mode record --live --input $frozenInput `
    --identity-file $identityFile --max-calls 100 --timeout-ms 240000 `
    --output $newRecordingDirectory

# Provider-free exact contract reproduction:
node $decisionTool --mode playback --input $frozenInput `
    --identity-file $identityFile --responses $recordedTape `
    --output $newPlaybackDirectory

# Same frozen identity plus validated pending/maintenance state and call cursor:
node $decisionTool --mode playback --input $frozenInput `
    --identity-file $identityFile --responses $matchingContinuationTape `
    --progress $savedProgress --output $newResumeDirectory
```

The tape matches requests by exact ordered serialized identity plus a per-identity
occurrence number, not global call/completion ordinal. Full native
state/questions/criteria, option order, source/role/chronology, model generation
and policy are bound. Generative bindings retain the actual prompt and schema,
model/wire identity and completion settings. Native admission-check outcomes
are recorded separately so offline packing preserves rejection/repacking behavior.
Repeated equal requests are disambiguated in invocation order, including across
a saved progress cursor; response completion order is not simulated.

`tape.json`, `progress.json`, `snapshot.json`, `result.json` and failure artifacts
are private, atomic files. Capture deliberately stops without inventing a model
response. All provider/model factories are lazy and unreachable during capture
or playback. Partial progress binds the complete input (including
`maintainClusters`), policy/execution/model/implementation identity, validation
coverage, pending reasons/targets, old-member maintenance signals and occurrence
cursor. Resuming changed policy, wire/model configuration or input fails closed.
To continue a partially recorded run, supply its progress to a new authorized
recording, then pair that same progress with the resulting continuation tape
for playback; consumed occurrences are not replayed from the beginning.

`returned`, `assignmentsResolved`, `pending`, and `maintenanceComplete` are
separate observations. Pending is retryable, never converted to deferral or
certified completion. Remaining maintenance debt stays visible even when all
assignments are accounted for. A return does not certify view readiness or
answer quality. Bounded incomplete record/playback exits 2; failure/cancellation
exits 1 and cannot publish a late snapshot. Provider latency, live interleavings
and semantic performance are outside the offline replay claim.

`TYPEAGENT_MEMORY_SEARCH_TRACE=1` enables privacy-filtered stage receipts.
Measure trace off/on separately: emitting fine-grained diagnostics can materially
affect timings. Model spans, nested stage sums and wall time are not interchangeable.
Aborted calls without returned usage have unknown usage, not zero usage.

## Qualification boundary

The numerical findings below are retained historical LLM-arm results, not
inference or performance campaigns executed by this shared-code integration.

Frozen 2,909-node CPU tests showed exact parity and substantially less repeated
host work. A cross-version recovery accounted for all nodes and organized
192 concepts with 86 parent and 23 related links. These results do not prove
semantic quality or fresh end-to-end readiness.

Corrected-contract 96-node ABBA trials averaged 133.229 seconds with one worker
and 134.979 with two; stale proposals increased work. Two samples per condition
are not enough for a general performance conclusion. No experimental defaults
were promoted. Human admission/merge review, fresh full-input runs and native
readiness/answer qualification remain required.

Run offline regression coverage with `pnpm run test:memory-quality`. Relevant
service tests cover budget boundaries, indexed parity, hidden-member evidence,
ordered commits, stale proposals, cancellation and checkpoint failures.

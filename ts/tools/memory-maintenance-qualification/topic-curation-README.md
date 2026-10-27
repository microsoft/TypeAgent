# Frozen topic-curation replay

This tool isolates topic curation from ingestion. It can capture a request,
compare indexed host work with reference scans, replay exact saved responses,
measure disposable persistence, or run explicitly authorized bounded inference.
It does not establish native readiness, answer accuracy or human-rated quality.

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
  matching input, node selection and settings; cannot combine with `--resume`.
- `--organize` runs the actual configured organization stage after complete-input
  curation and saves a validated snapshot. Only live/recorded modes support it;
  it cannot combine with `--nodes`. Calls/deadlines also bound organization.
- `--mode index-storage --index-file <corpus_data.json>` measures the production
  segmented backend without extraction or embeddings. Writes use disposable
  stores and check payload parity and unchanged artifact reuse.

Partial call-limited live/recorded runs retain validated progress and exit 2;
other failures exit 1; validated completion exits 0. Cross-version checkpoint
recovery is intentionally possible, but must be labeled recovery, not a fresh
benchmark under the corrected policy.

`TYPEAGENT_MEMORY_SEARCH_TRACE=1` enables privacy-filtered stage receipts.
Measure trace off/on separately: emitting fine-grained diagnostics can materially
affect timings. Model spans, nested stage sums and wall time are not interchangeable.
Aborted calls without returned usage have unknown usage, not zero usage.

## Qualification boundary

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

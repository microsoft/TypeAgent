# Retrieval and native-answer benchmarks

This benchmark evaluates Qasper, LegalBench-RAG and QMSum against the current
TypeAgent memory service and conventional retrieval baselines. It uses an
**independent protocol, not a replication of the Deployed article**. Dataset
selection, renderer and scorer differences prohibit direct numerical deltas
against the article's tables.

**Current investigation scope:** evaluate unchanged native retrieval and the
actual native answer stack at our corpus sizes, then measure incremental BM25
benefit. Do not test smaller DocParts or introduce this command's 2,000-token
packing rule into native answering.

`run` remains a **retrieval-only diagnostic**. Its explicit-budget runs and
saved-candidate budget ablation are not native answer-quality results.
`answer` invokes actual native synthesis on an existing frozen QMSum corpus,
records reader evidence/citations/refinement and grades answers against
evaluator-only human references. No extra evidence cap is applied. Same-stack
BM25 ablations are available through the benchmark-only `paired` command
described below; no product caps or default routing have changed.

## Build and offline qualification

From the checkout's `ts` directory, with a Node version supported by the root
package manifest and standalone pnpm:

```powershell
if (Test-Path $PROFILE) { . $PROFILE }
pnpm run build
pnpm --filter @typeagent/benchmarks run jest-esm --runInBand `
    --testPathPattern='(incrementalBm25|nativeAnswers|chunkingBench|memoryBench)[.]spec[.]js'
pnpm --filter @typeagent/memory-service run jest-esm --runInBand `
    --testPathPattern='(benchmarkBridge|indexedFragmentPolicy|indexedFragmentPolicyIntegration|indexedFragments|answerKnowPro)[.]spec[.]js'
```

Tests use synthetic data and fake service/model boundaries. They do not prove
live corpus quality or article parity. Existing BEAM scoring and routing remain
unchanged; its BM25 statistics are also reusable by this benchmark.

## Prepare data

Download official data outside the checkout. Preserve its license notices and
review the applicable corpus terms before processing or sending content to
models. The confirmation below is intentional; this command does not download
data, fetch credentials, or sign into a provider.

- Qasper: the original `qasper-dev-v0.3.json` from the official v0.3 archive.
  Supply a JSON object keyed by paper ID, not a Hugging Face columnar export.
  The first answerable annotation whose evidence resolves entirely to unique
  full-text paragraphs is selected. Other questions get explicit exclusions.
- QMSum: original `data/ALL/jsonl/val.jsonl`, pinned to a Git commit. All
  validation meetings are retained. Only specific queries with supplied spans
  are scored; human topic annotations and reference answers are never indexed.
- LegalBench-RAG: the published download's directory containing `corpus` and
  `benchmarks`, not regenerated model outputs. Review underlying
  ContractNLI/CUAD/MAUD/PrivacyQA terms. All corpus files are retained, including
  distractors; Python character offsets are converted to Unicode-safe UTF-16.

```powershell
$repo = (git rev-parse --show-toplevel).Trim()
$runs = Join-Path (Split-Path $repo) 'memory-benchmark-runs\chunking'
$data = Join-Path $runs 'datasets'

pnpm --filter @typeagent/benchmarks chunking-bench prepare `
    --dataset qmsum --input (Join-Path $data 'qmsum-validation.jsonl') `
    --source 'https://github.com/Yale-LILY/QMSum/tree/83d7768c1f2b4dfeb091385d3dc7e239b8e5bb7e' `
    --split validation --terms-reviewed `
    --output (Join-Path $data 'qmsum.json')
```

Preparation records input SHA-256, canonical documents, approved source
metadata, evaluator-only questions/gold and exclusion reasons. No question,
answer or annotation is passed to the ingestion payload. File/directory
fingerprints and canonical dataset hashes belong in retained run artifacts.
Do not commit corpora, source captures, model credentials or owned stores.

## Execute

The default is a deterministic 10-question **offline BM25 smoke** over the
entire prepared document pool:

```powershell
pnpm --filter @typeagent/benchmarks chunking-bench run `
    --input (Join-Path $data 'qmsum.json') `
    --output (Join-Path $runs 'qmsum-bm25-smoke') `
    --arms bm25 --questions 10 --size 512 --budget 2000
```

For service retrieval, use an existing approved TypeAgent model configuration:

```powershell
pnpm --filter @typeagent/benchmarks chunking-bench run `
    --input (Join-Path $data 'qmsum.json') `
    --output (Join-Path $runs 'qmsum-native-smoke') `
    --arms 'ordinary,indexed' --questions 10
```

Quote comma-separated arm lists in PowerShell so they remain one argument.

### Native answer baseline

Reuse a completed native retrieval run with a ready corpus and its original
QMSum validation JSONL. The JSONL hash must match dataset provenance. This
currently supports QMSum, not Qasper/LegalBench answer references.

```powershell
pnpm --filter @typeagent/benchmarks chunking-bench answer `
    --retrieval-run (Join-Path $runs 'qmsum-native-smoke-20261102') `
    --references (Join-Path $data 'qmsum-validation.jsonl') `
    --output (Join-Path $runs 'qmsum-native-answer-baseline-20261102')
```

This uses exactly the frozen run's question IDs, documents and realized native
parts. Sources/revisions/configuration are checked before answering; all source
maps are rechecked after completion. Requests select native synthesis with
diagnostics, but do not override retrieval policy, limits, response characters
or reader budgets. Native product limits remain in effect.

Human reference answers are passed only to a separate grading call after
native answering. Native answer and judge model identities are recorded
separately. The judge scores semantic correctness, completeness and grounding
on 0/0.5/1; abstention has zero correctness/completeness and null grounding.
These are preliminary model judgments, not human-certified quality scores.
An incorrect answer can still be faithful to retrieved evidence.

Each receipt retains the raw native response, human reference, grade/reason,
final reader sources, all-pass reader sources and citations. Source-span
metrics cover exact original-source excerpts; they exclude derived-view text.
Their excerpt-concatenation `contextPrecision` is not precision over the full
serialized model request. Recorded native `serializedContextChars` and raw
excerpt token counts are separate diagnostics, not additional imposed limits.

Answers are saved before grading. Resume checks fingerprints, reuses saved
answers/grades, recomputes source mapping and does not regenerate scored
answers. A single-executor lock and pre-call attempt receipt also prevent
failed or interrupted native answer attempts from being regenerated.
Grading can resume when a saved answer exists. Typed grading/mapping failures are explicit failed rows, not empty
retrievals; provider/index failures stop the run with a failed status. Use a
fresh directory when code, data or configuration changes.
For Azure-backed runs, `az` must be discoverable by the benchmark process and
an existing approved Azure sign-in must be available. On Windows, an installed
CLI may be absent from `PATH`; add its installation directory to the current
process rather than changing machine settings:

```powershell
$az = Join-Path $env:ProgramFiles 'Microsoft SDKs\Azure\CLI2\wbin\az.cmd'
if (Test-Path $az) {
    $env:PATH = "$(Split-Path $az);$env:PATH"
}
```

Some installations use `${env:ProgramFiles(x86)}` instead. This does not perform
sign-in or retrieve credentials. If authentication still fails, the operator
must complete the normal interactive sign-in before retrying in a fresh run
directory. Never treat an authentication failure as a scored empty retrieval.

`ordinary` returns full ranked DocParts; `indexed` returns the bounded native
passage selector's fragments. Both use `sourcesOnly`. The benchmark creates a
fresh owned corpus, imports every document as literal text, records source-part
maps, closes/reopens the store, verifies readiness, and only then queries.
It uses the existing **benchmark runtime**, including its recorded maintenance
policy; it is not a claim that every customer host has the same feature flags.
Ordinary and indexed arms share the same frozen source index.

Questions are selected by hash-ordered ID, never by successful retrieval.
`--questions 0` selects every eligible question; it does not change the pool.
All output must be outside the source checkout. Every run pins the canonical
dataset, source commit, tracked diff, emitted adapter and bridge digest.
Changing options/data/code requires a fresh output directory. All existing
question receipts resume without rescoring, including explicit failed rows;
use a fresh directory to retry those failures. A failed infrastructure operation
retains a non-success status rather than becoming an empty retrieval.

### Options

| Option                    | Default | Meaning                                                       |
| ------------------------- | ------- | ------------------------------------------------------------- |
| `--arms`                  | `bm25`  | `bm25`, `ordinary`, `indexed`, `vector`, `hybrid`             |
| `--questions`             | 10      | Smoke count; 0 means all                                      |
| `--budget`                | 2000    | Final serialized `cl100k_base` context tokens                 |
| `--size`                  | 512     | Maximum comparator body tokens, not product extraction size   |
| `--overlap`               | 0       | Comparator overlap, strictly smaller than size                |
| `--strategy`              | `fixed` | `fixed`, `sentence`, `paragraph`, `structure`, `whole`        |
| `--headers`               | false   | Add approved title/section context to comparator chunks       |
| `--candidate-limit`       | 200     | Comparator candidate/fusion depth; native product caps remain |
| `--embedding-token-limit` | 0       | Explicit positive input guard required for vector arms        |

BM25 is the existing BM25Okapi formula (`k1=1.5`, `b=0.75`, negative-IDF
epsilon 0.25), lowercased whitespace tokens and no stopword filtering. It is
**not** an unqualified `bm25s` reproduction. Ties use stable candidate IDs.
Statistics are computed over the entire dataset's chunks.

Vector/hybrid arms use the normally configured, identified TypeAgent embedding
model, document/query roles and cosine similarity. Hybrid uses equal RRF with
constant 60 at the declared candidate depth. This is not a Qwen-labelled
reference unless that exact model/configuration has separately been qualified.
The guard counts `cl100k_base` tokens; it does not establish a different model
tokenizer's limit. Validate that limit before running. Oversized inputs and
unavailable/incompatible embeddings fail; they never silently switch models.
Whole-document controls can therefore be unsupported by a selected embedder.

Conventional comparator options do not change the durable service's 24k
extraction or 7.5k embedding windows. Smaller-DocPart and artificial-context-cap
experiments are not part of the clarified investigation. QMSum native answering
is implemented. Qasper/LegalBench answer adapters and
incremental BM25 production integration remain follow-ups; benchmark-only native
paired interventions are described below. Production integration
requires separate adoption and lifecycle qualification.

## Metrics and receipts

Source coordinates use half-open UTF-16 intervals aligned to Unicode code-point
boundaries; measured character lengths count Unicode code points. Overlapping
gold/retrieved intervals are unioned per document before scoring.

- Span recall = unique relevant characters / gold characters.
- Span precision = unique relevant characters / unique retrieved characters.
- Context precision includes all delivered headers, separators and duplicates
  in its rendered-character denominator; repeated evidence earns no new credit.
- F1, document recall, duplicate fraction, candidate counts and actual delivered
  tokens are additional diagnostics.

Packing follows rank and clips only the final contributing item at a Unicode
boundary. Its **entire serialized context** must fit the declared token budget.
Chunk bodies preserve canonical source text; synthetic headers do not add gold.
Successful empty retrieval is zero precision/recall. Mapping/provider response
failures retain null metrics and explicit status, count against coverage and the
failure-inclusive recall denominator, and make the CLI exit nonzero.
Other infrastructure errors stop the run and retain partial receipts.

`scorecard.json` reports per-arm macro metrics, micro recall/precision, success
coverage and failure-inclusive recall. It never substitutes source-ID recall or
answer quality for character coverage. `receipts` contain the exact context,
spans, ranking and native diagnostics; `native-state.json` pins corpus IDs,
source revisions and source maps. Maps reconstruct literal DocParts through the
same production parser, and returned anchors/snippets must round-trip exactly.
They are not direct introspection of persisted embedding vectors. An ambiguous
ordinary-message block is an explicit mapping failure, not a guessed offset.

Per-dataset scorecards are the first result. Equal-dataset summaries, paired
document-clustered confidence intervals and repeated independent ingestion are
required before a product adoption decision; a smoke score is not that evidence.

## Incremental native BM25 pilot

`paired` implements **native-stack** N0–N3, not the standalone 512-token BM25
comparator above. It never ingests or changes the historical store/receipt
namespace. A new experiment root owns independent snapshot clones. Links and
junctions, unsupported index schemas, changed raw-source/revision/block hashes,
incomplete corpus readiness and incompatible persisted embedding identities fail
closed before answer calls. All 35 QMSum meetings remain eligible; BEAM uses the
complete qualification conversation, not smoke questions or shortened histories.
BEAM maps use serialized **persisted original DocParts**, verified as a complete,
exact partition of each canonical raw source and its active revision. Historical
units may differ from today's bridge diagnostic reparse; that reparse verifies
raw content/revision only and never replaces archived unit boundaries. The
normalization and both block counts are recorded; each arm's persisted units are
reverified before and after answers.

| Arm | Benchmark-only policy                                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N0  | Observational identity: unchanged native block scores/order and native window order                                                                            |
| N1  | BM25 reranks only native candidate blocks, with statistics from all eligible original raw DocParts                                                             |
| N2  | Leaves blocks unchanged; BM25 orders the exact existing window objects, scored using fixed raw-DocPart corpus statistics (not window-level IDF/average length) |
| N3  | Equal-weight RRF, k=60, union of descending native-score ranks and all **matching** eligible raw blocks, canonical deduplication; no extra depth/cap           |
| N4  | Controller and preregistration support for one independent `empty` or `term-coverage` gate and an explicit N1/N2/N3 intervention                               |

No policy receives gold spans, human references, rubric labels or judge outputs.
Derived-view indexes, other corpora and superseded revisions stay untouched.
Native selector boundaries, reader/refinement behavior and product limits remain
unchanged. Native requests always include diagnostics, have no request budget or
limit overrides, and preserve BEAM's existing reference-date prefix behavior.

Protocol `raw-native-bm25-v2` derives native fusion ranks from scores, with stable
ties, rather than assuming message storage order is ranked. Earlier v1 N3
outputs do not measure this corrected policy and must not be relabeled as v2.

The pilot freezes original question order, rotating counterbalanced arm order,
seed, gate threshold, scorer/tokenizer, source/compiled-code hashes, current
models/configuration, official judge protocol and snapshot provenance before
any answer or judge request. Limits are 10 QMSum and 20 BEAM questions × N0–N3:
120 answer/grade pairs, once, with native internal refinement unchanged. N4 is
**prepare-only** under this authorization; live N4 requires a separately approved
budget. `term-coverage` activates strictly below 0.5 coverage of unique,
lowercased whitespace query tokens (no stopword removal) in the native raw
preselection block pool. This pilot rule is exploratory, not held-out calibration.
An empty pool is a successful retrieval outcome, never a provider-error fallback.

From `ts\packages\benchmarks`, after the normal build. The example archive names
refer to operator-owned preparation outputs, not bundled datasets or downloadable
run artifacts; replace them with compatible local runs:

```powershell
if (Test-Path $PROFILE) { . $PROFILE }
$repo = (git rev-parse --show-toplevel).Trim()
$runs = Join-Path (Split-Path $repo -Parent) 'memory-benchmark-runs'
$pilot = Join-Path $runs 'bm25-incremental\2026-11-03-pilot'
$qmsum = @(
  '--dataset', 'qmsum',
  '--snapshot', (Join-Path $runs 'chunking\qmsum-native-smoke-20261102'),
  '--references', (Join-Path $runs 'chunking\datasets\qmsum-validation.jsonl'),
  '--baseline-answers', (Join-Path $runs 'chunking\qmsum-native-answer-baseline-20261102'),
  '--output', (Join-Path $pilot 'qmsum-n0-n3'),
  '--new-query-lineage'
)
pnpm run chunking-bench paired @qmsum --prepare-only
# Authorized executor only: remove --prepare-only to execute/resume once.
pnpm run chunking-bench paired @qmsum
pnpm run chunking-bench paired-analyze --output (Join-Path $pilot 'qmsum-n0-n3')

$beam = @(
  '--dataset', 'beam',
  '--snapshot', (Join-Path $runs '2026-10-23-ts-token-safe\beam-100k-qualification-content-agent'),
  '--references', (Join-Path $runs 'typescript-migration\datasets\beam-100k.json'),
  '--protocol', (Join-Path $runs 'typescript-migration\protocol.json'),
  '--output', (Join-Path $pilot 'beam-n0-n3'),
  '--new-query-lineage'
)
pnpm run chunking-bench paired @beam --prepare-only
# Only proceed if the index/embedding readiness check succeeds.
```

Default lineage is strict historical query-model/configuration parity. The
examples explicitly create fresh query lineage for their older snapshots;
current fingerprints also include the resolved native reader connection, even
when a separate benchmark judge is configured.
`--baseline-answers` supplies QMSum's recorded reader-model pin when the
ingestion manifest predates it; it does not reuse historical answers as new N0.
`--new-query-lineage` explicitly permits new chat/judge settings, with a freshly
answered N0 and identical **new** settings across every arm. Historical ingestion
model/configuration remains provenance, never mixed-score evidence. This flag
does **not** waive persisted embedding role-identity or index-schema compatibility
and never authorizes rebuilding vectors or reingestion.

`pairs\<arm>\<question-id-hash>\answer.json` is written before evidence mapping or
grading and remains immutable. `grade.json` is separately immutable; successful
official BEAM nugget/equivalence responses are cached individually, so grade-only
retries do not regenerate native answers or completed judge steps. Provider errors,
invalid responses and mapping errors remain visible in append-only
`operations.jsonl`; interrupted/failed answer attempts are not automatically
reissued. A single-executor lock prevents duplicate spending. Changed fingerprint
requires a new root, not rewriting old responses. Do not start another root as
an unapproved repeat.

Traces retain actual eligible/before/after pools, scores, lexical-only
contributions, existing window offsets and normalization, observable gate/query
inputs, raw statistics digests and instrumentation time/memory. Native evidence,
reader/refinement diagnostics and canonical source-coordinate citations are
preserved alongside grades. N0 does not build a BM25 scorer, but its timing still
includes raw-identity/trace observational overhead; timings are **instrumented**,
not untouched production latency. OS cache state is uncontrolled and recorded.

`paired-analysis.json` reports jointly scored rescues/regressions and net lift,
unmatched failures, per-category transitions, coverage, scored-only accuracy,
correct-over-selected and p50/p95 instrumented timing. Bridge answer/generate
operations (including retries) are counted explicitly. Native internal
translation/reader/refinement call and token totals are not exposed by the
runtime: reported as null, never falsely counted as one. Small inspected pilots
are diagnostics, not adoption proof or held-out confidence intervals. Historical
standalone BM25 answers are not counted as hybrid rescues.

Interpret `lexicalMilliseconds` as total policy-hook time, including N0's
observational work, not isolated BM25 cost. For N0–N3, `gateActivations` counts
selection invocations (including refinement); only N4 uses a gate to control
intervention. Answer latency excludes prior controller/runtime setup and later
grading, so it is not end-to-end cold-start or answer-plus-judge latency.

BEAM's official pass threshold is a mean AMB nugget score of at least 0.5;
passing does not imply a fully correct answer. Inspect continuous scores in
the immutable grade receipts, category regressions and actual source evidence,
not just the number of passes. QMSum grades likewise remain provisional:
grounding in a different meeting or a supported but incomplete answer does not
establish correctness against the intended reference.

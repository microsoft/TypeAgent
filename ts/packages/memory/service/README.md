# @typeagent/memory-service

`@typeagent/memory-service` stores source revisions and conversation events,
indexes content with KnowPro, answers questions, and maintains editable documents
called Views. Native agents, browser clients and MCP use the same service.

Start with [Memory architecture](../../../docs/architecture/memory/memory.md) for
the concepts, [Current system](../../../docs/architecture/memory/current-system.md)
for host integration, or [Derived Views](../../../docs/architecture/memory/derived-views.md)
for document construction and editing. The sections below describe service
contracts and operational behavior.

## Opt-in memory understanding

Set `TYPEAGENT_MEMORY_UNDERSTANDING=true` in the host environment (or pass
`understanding: true` to `FileMemoryService`) to advertise
`features.memoryUnderstanding`. `understand` and `understandingModule` reuse
the existing indexed original/Views retrieval, support closure, refinement
and access validation. Existing search/answer contracts and defaults do not change.

The initial release supports one indexed document collection with optional
checkpoint/retrieval policy, and a one-parent-turn follow-on. All-memory,
conversation and filtered Hub searches remain in Results with an explicit
scope limitation. Attachments, durable chat history and model-authored HTML
are not enabled.

Rich output is strict, cited JSON rendered by trusted UI code, not executable
model HTML. Source cards are ready with the explanation. Timelines require
supported dates; concept cards use existing supported entities; relationship
edges require accessible original support at the captured graph generation.
Module-only requests do not invoke the prose reader.

Snapshots are service-local: 64 entries, 8 MiB total, 512 KiB per entry, with
absolute 15-minute expiry. Corpus clear, source forgetting and close purge
cached bodies. Parent/module reads revalidate all influencing evidence and
index versions. Handles do not replace authorization or provide per-chat-session
isolation; this is the existing local single-principal service boundary.
Enable `TYPEAGENT_MEMORY_SEARCH_TRACE=1` for redacted rich-stage timing,
reader-call counts and response-byte/module counts, not prompt/source text.

### Serving performance experiments

These are opt-in experiments, not recommended production defaults. Set
`TYPEAGENT_MEMORY_PERF_EXPERIMENTS` to a comma-separated switch list, or pass
`performanceExperiments` to `FileMemoryService`. Unknown names fail explicitly.
`p2` expands to the first five switches below; `p3` expands to the last four.

| Switch                | Behavior                                                                                                                                                                                                                                                                                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fast-models`         | Separate fast query translation and initial reading; refinement and ingestion extraction retain their existing models. Requires an explicitly configured `TYPEAGENT_MEMORY_FAST_MODEL` or `fastQueryModelEndpoint`. Injected reader models retain precedence. Custom index factories are rejected rather than silently ignoring translation experiments. |
| `brief-reader`        | A 700-token soft initial target with unchanged structured output and grounding requirements.                                                                                                                                                                                                                                                             |
| `source-preview`      | An optional model-free, provisional lexical source phase before semantic retrieval. At most six 600-character fragments; not a validated answer or a usable follow-on/module handle.                                                                                                                                                                     |
| `refinement-fallback` | Revalidate and retain an initial explanation only after an explicitly retryable model failure/deadline. Return `refinementFailed: true`, incomplete/partial status and warnings. Privacy, cancellation, scope and malformed-output errors still fail.                                                                                                    |
| `translation-cache`   | Completed successes only, keyed by corpus, fixed model, schema, exact question and full prompt context. Five-minute expiry; at most 128 entries / 1 MiB payload / 64 KiB per entry. Relative-date questions bypass caching; privacy changes and close purge it. Concurrent callers retain independent cancellation.                                      |
| `evidence-leases`     | Tolerate unrelated index-version changes for at most 120 seconds from original preparation, only after complete exact-evidence revalidation. Later phases cannot renew the lease. Forget, clear, suppression and changed references remain immediate. This is not whole-index MVCC.                                                                      |
| `graph-parallel`      | Existing graph projections plus ordered support queries at concurrency two. All siblings settle before a failed batch leaves scope.                                                                                                                                                                                                                      |
| `foreground-priority` | Defer new background maintenance for a shared maximum ten seconds, with a one-second cooldown under sustained requests. Does not cancel running work or defer explicit writes.                                                                                                                                                                           |
| `lazy-collections`    | Single-flight per-collection recovery on first access, with pending removal/clear recovery still eager. Unopened collections join completion-paced background warmup rather than all loading during discovery.                                                                                                                                           |

For browser SSE previews, use the same environment switches in the service and
browser gateway. The gateway omits the preview RPC when disabled. Direct clients
may explicitly request `phase: "preview"` only from an enabled host; provisional
results have `provisional: true`, no answer and no prepared evidence handle.

The [latency runner](../../../tools/memory-maintenance-qualification/search-latency-benchmark.mts)
accepts `--experiments`, `--fast-model`, `--paths`, `--understanding-rounds`
and optional `--retain-answers`. Private answers are saved outside measurement
intervals; repeated questions overestimate general translation-cache hit rates.
The [local experiment tool](../../../tools/memory-maintenance-qualification/serving-local-experiments.mts)
compares eager/lazy startup and fixture JSON parsing versus a local worker with
full-result cloning. It prohibits network calls and does not ship a storage worker.

## Scoped knowledge graphs and read inventories

`queryKnowledgeGraph` reads bounded entity, raw-topic or maintained-hierarchy
projections across eligible documents and conversation events. Evidence-kind and
event filters apply before aggregation. Responses report independent document,
event and topic coverage (`ready`, `building`, `stale`, `error` or `unsupported`),
exact support counts, omitted counts and response budgets. Index preparation is
scheduled separately from graph reads; an unavailable projection is not an empty,
ready graph.

Node, edge and support pages bind to a stable generation. `queryGraphSupport`
returns exact source revisions or event identities; evidence changes invalidate
continuations. Forgetting, suppression and authority constraints also apply to
projections and drilldown. Maintained hierarchy summaries reuse topic maintenance
and lazy concept summaries; these graph APIs do not require knowledge checkpoints
or integrated answering.

View, build and publication summary operations avoid loading full evidence bodies
for list navigation. A committed read projection preserves historical conflict
fallback and source eligibility checks. View/event index preparation can release
the writer lease, then revalidates captured evidence before installation.
View-summary requests support optional `excludeKinds` filtering before paging
and totals. Callers without this filter still receive every eligible kind;
explicit question/schema-view lookups and question inventories are unchanged.
Build-result summaries include optional `conflictState` metadata (`pending`,
`resolved`, or `missing`) so attention lists need not fetch full conflict
snapshots. Older clients may ignore this field; clients connected to older
services can still resolve conflict status through the detail operation.
Startup upgrades an unversioned read projection once, without regenerating
views, and subsequent clean restarts reuse that projection.

## Document import token budgets

Text, Markdown, HTML/web and VTT retain their format-specific parsers and then
use the shared [`chunkDocParts`](../conversation/src/docImport.ts) stage. Plain
text is literal: it is neither escaped nor interpreted as Markdown. HTML still
converts to Markdown; VTT still uses the transcript parser.

Durable imports split oversized blocks, including unbroken words, then pack
compatible adjacent blocks within **24,000 extraction tokens (`o200k_base`)**.
Message-text embeddings use separate lossless windows bounded to **7,500 tokens
under both `o200k_base` and `cl100k_base`**. Shared indexing and hosted embedding
requests retain the **8,000-token `cl100k_base`** final guard, below the hosted
models' 8,192-token limit. Structural character targets are not the final token
budget.

Splitting slices original Unicode code points without truncation or decoding
partial token bytes. Plain-text whitespace and literal markup survive exactly.
Source/revision metadata, tags, deletion information and existing knowledge are
retained; pre-collected knowledge is attached once, not duplicated on every
fragment. Packing does not cross different sources/revisions, timed transcript
turns or deletion boundaries. Split transcript fragments retain their original
turn's timestamp; no new cue timings are invented.

Public parser helpers default to 7,500 extraction tokens and 8,000 embedding
tokens per part; supplying `maxTokensPerPart` additionally enables packing.
Extraction targets above the embedding ceiling require separate embedding
windows, as configured by the durable service. The legacy `mergeDocParts`
helper is deprecated and now retains per-part metadata instead of flattening
all parts under one metadata object.

Shared KnowPro document/term indexing and the hosted embedding API also check
each complete input immediately before model/API work. Oversized inputs fail
explicitly with their batch index, token count and limit; they are never
silently shortened, skipped or embedded in partial form. The cl100k ceiling is
a shared safety policy, not a substitute for another provider's native
tokenizer or any smaller model-specific context limit.

Existing stored messages are not silently rechunked because that would change
indexed locators. Reimport/rebuild from retained sources when adopting the new
chunking policy; benchmark comparisons require fresh stores and fingerprints.

## Knowledge readiness during continuous ingestion

Source ingestion completion is not derived-knowledge readiness. Automatic
question discovery waits until standalone ingestion queues and durable import
batches are idle; the final ingestion schedules discovery again. Automatic
maintenance also waits for standalone ingestion to finish. Automatic topics
coalesce index changes for a two-second quiet period; explicit maintenance
drains bypass that delay. Capability settings are unchanged.

An index change promptly cancels an obsolete running topic generation without
waiting for model calls under the foreground write lock. The build still owns
and drains its workers. Topic generation periodically persists independently
audited summaries before organization, so interrupted work can reuse summaries
only when their original evidence, source-revision context and model recipe
still match. Unaudited prose is never exposed as a ready summary.

`createKnowledgeCheckpoint({ corpusId, producerComplete: true })` continues
bounded discovery windows and page-family passes within the checkpoint's
existing timeout. Ordinary checkpoints retain their bounded single-round
discovery and three page-pass behavior. Continuation does not bypass the
persisted hourly discovery allowance, retry failed discovery implicitly, or
turn partial/failed coverage into `ready`. No progress, exhausted allowances,
disabled families, deadlines and failed builds remain explicit.

Completed discovery receipts are not made partial by an obsolete deferral
reason. Successful low-utility wiki skips remain complete build outcomes;
their admission receipts prevent unchanged utility deferrals from cycling
through every checkpoint pass. New index generations, model/admission policy,
or page revisions invalidate those receipts; explicit rebuild also bypasses
them. Blocked editorial assessments remain failures. Configured wiki assessment
allows one logged evidence-contract repair against the unchanged supplied
fragments and pages, then validates again without a success-shaped fallback.
On structured-output-capable models, topic summary schemas restrict numeric
evidence references to the IDs actually supplied in that individual request.
Models that disable response formatting retain the existing JSON-prompt path;
host validation still rejects invalid responses on both paths.

Configured question discovery requires a contiguous subject phrase in one of
the proposal's cited passages. An unresolved subject permits one logged repair
against the same frozen evidence, followed by full validation. That extra call
reserves another persisted hourly allowance before dispatch; exhausted budgets,
repeated invalid output and unrelated errors remain failures. The existing
per-window timeout and hourly cap are not increased.

## Concept curation and lazy topic summaries

`FileMemoryService` enables curated topics by default. Complete raw incidence
is retained, but background generation curates evidence-grounded concepts
instead of producing a summary for every raw nomination. `curatedTopics: false`
retains the legacy raw-summary path for explicit diagnostic/custom-host use.
The recipe/fingerprint distinguishes these policies, so old raw snapshots
cannot silently qualify as current curated knowledge.

The LLM decides semantic equivalence, compatible scope and whether a concept
has a substantive, specific consumer purpose. Host rules validate supplied
identities, exact membership accounting, cited sources and bounded payloads;
they do not equate repeated names or source overlap. Corpus-wide lexical
candidate retrieval reintroduces relevant previously admitted concepts into
later bounded batches for LLM reconciliation. Exact labels are prioritized,
including short acronyms. This is candidate retrieval, not a hardcoded merge;
synonyms missed by retrieval or evidence-budget bounds may remain separate.
Salience is a model-assigned ordinal, not truth confidence or an automatic
host-side admission threshold.

### Common topic-generator and lexical-index contracts

`createConfiguredTopicGenerator` accepts one named options object:

```typescript
createConfiguredTopicGenerator({
  endpoint,
  model,
  mode: { kind: "generative", settings },
});
createConfiguredTopicGenerator({
  endpoint,
  model,
  mode: {
    kind: "decision",
    createOptions: (input) => decisionOptionsFor(input),
  },
});
```

`endpoint`, `model` and `mode` are optional. No mode preserves the factory's raw
behavior; the service host explicitly selects generative curation by default.
Decision curation remains opt-in. Old positional calls and mixed engine settings
are rejected before provider creation, including calls from JavaScript.

`TopicConceptIndex` is the shared lexical implementation; `TopicNominationIndex`
is an alias. `replace(removed, added)` updates only supplied entries, refreshes
stored concept objects even when lexical text is unchanged, and removes stale
postings on rename. `update(fullCatalog)` explicitly performs full reconciliation.
The lexical index does not own mutable packet positions: native planning derives
dense target keys from each frozen transaction's concept array. Native full
catalog synchronization is still full-catalog work, not an incremental operation.

### Experimental Decision curation

Set `FileMemoryServiceOptions.decisionTopics: true`, or
`TYPEAGENT_MEMORY_DECISION_TOPICS=true` in the native/MCP/CLI/benchmark host,
to select the experimental `curated-decision-v2` pipeline. The default remains
the generative `curated-lazy-v6` policy. Decision curation requires curated
topics and explicitly rejects a conflicting custom `generateTopics` adapter;
ordinary custom-adapter receiver/cancellation behavior is unchanged.

The pipeline reuses the native Azure/Copilot Decision client and its provider
constraints, typed failures and inference-attempt budget. Complete logical
requests are counted with the installed `o200k_base` tokenizer. Packets use an
application guard of 64 questions and at most 248 targets plus seven disposition
sentinels; 64 is not a claimed service maximum. Every target batch is evaluated.
One typed Azure HTTP 422 can repack unchanged nominations from 24,576 to 16,384
tokens within the existing signal/deadline and cumulative budget. Other failures
do not silently select a generative replacement.

Packet-local dictionaries intern exact evidence and chronology; short criteria
reference that shared grounding. Fixed-cluster metadata authoring reuses the
same exact dictionaries rather than repeating each member's support. No
citations are dropped to fit the authoring guard. Decision criteria
reference shared target grounding instead of embedding it repeatedly. Candidate
partitions are interleaved, with binary capacity search and native wire/output
preflight. Independent root checks share requests in dependency frontiers without
changing each candidate's original resolved-prefix target universe. Missing
direct/member citations are restored from maintained incidence before deciding;
retained concept citations are expanded on merge. No representative-evidence
cap or admission-first filter is introduced.

Candidates share their original evidence, locator/block identity and available
role/chronology metadata. Unknown roles/clocks stay unknown. Direct deferrals
and unchanged-scope concept merges use no generative calls. New fixed clusters
receive compact label/scope/purpose authoring, without summaries or model-owned
membership. Redirected earlier roots are compared against actual admitted
roots; deferred decisions are not inherited. Explicit uncertainty, conflicting
batch judgments or incomplete owned evidence reopen the affected staged
partition through the existing bounded generative curation validators.

Salience is the native finite `[0,7]` score mapped by `Math.round(score) + 1`;
it is neither confidence nor an admission threshold. Raw incidence is retained,
and only complete validated batches become durable continuation checkpoints.
The recipe and fingerprint include Decision/chat provider-model identity,
runtime configuration generation, deployment constraints, packing and policy
identity. Ordinary lazy detail summaries, organization and stale/forget guards
remain in place. This is an implementation for investigation, not a measured
quality, readiness or speedup result.

`FileMemoryServiceOptions.onTopicDecisionReceipt` optionally receives private
structured diagnostics for packing, Decision calls, authoring, resolution,
transaction and checkpoint timing. Receipts include transaction identity,
question/candidate/target counts, root reasons and evidence expansion. The native
benchmark host forwards this hook without replacing inference and writes
`topic-operations.jsonl` within its owned run directory. Sink errors propagate;
raw excerpts are not recorded.

For the saved-state investigation, `TopicDecisionOptions.packetPolicy` accepts
`"factored-best-fit"`; the default `"v2"` layout/packing remains unchanged.
The treatment interns exact long field values of canonical JSON chronology and
tries the last 24 open packets by smallest marginal serialized-token cost.
Opaque/noncanonical chronology stays literal; no source, time, role, citation or
target is removed. Every placement is checked against logical and native limits.
The policy changes the model identity. Receipts retain selected native choices
and scores for paired diagnostic analysis; these are not semantic gold.
Nomination, uncertainty fallback, authoring and the one bounded 422 repack are
unchanged. The explicit `maxNewNodes` argument to `curateTopicsWithDecision`
supports private diagnostic prefixes only; its partial result must not be
published as completed curation. Normal generation supplies no such bound.

Decision curation builds snapshot-scoped occurrence/source/node indexes, an
exact lexical concept posting index, and revision-keyed concept grounding.
Evidence ordering, qualifications, roles/times, exact-label preference and the
top-24 concept nomination policy are unchanged; the latter is not a focal batch
size. Indexes live only for the immutable build and are not model-response caches.

`FileMemoryServiceOptions.decisionTopicExecution` configures:

| Option              | Default | Bound / behavior                                                         |
| ------------------- | ------- | ------------------------------------------------------------------------ |
| `concurrency`       | `1`     | Shared native request limit, 1..24                                       |
| `batchSize`         | `24`    | Fixed 1..256 focal nodes, or `"context"`                                 |
| `lookahead`         | `1`     | 1..4 initial-classification batches; commits remain ordered              |
| `maxQuestions`      | `64`    | Application safety guard, 1..256; native constraints still apply         |
| `clusterValidation` | `false` | Local cluster validation; requires lookahead 1 and full transactions off |

Hosts can use `TYPEAGENT_MEMORY_DECISION_CONCURRENCY`,
`TYPEAGENT_MEMORY_DECISION_BATCH_SIZE`, `TYPEAGENT_MEMORY_DECISION_LOOKAHEAD`,
and `TYPEAGENT_MEMORY_DECISION_MAX_QUESTIONS`. Invalid values fail explicitly.
Settings are part of the view/model identity and benchmark processing policy.
Default execution remains serial with 24-focal transactions until qualified.

Context mode grows a deterministic prefix until the complete initial request
hits logical input, question/choice or native admission limits. It can include
more than 24 topics when capacity permits. One individually heavy candidate
can still require target partitions. Fixed larger transactions can span multiple
requests. A 256-node planning guard prevents unbounded work on tiny inputs; it
is not a claimed model limit. Changing transaction size changes peer/fallback
universes and must be evaluated as a separate algorithm variant.

Within a wave, packets run concurrently but results reduce in original packet
order. Failed/cancelled waves stop queued inference and drain in-flight work
before retry/publication. Lookahead reuses initial answers only when rebuilt
grounded inputs, nomination results (including newly relevant concepts), packet
policy/limits and runtime generation match. Stale work is reported and rerun;
speculative errors are not silently ignored. Roots, broad uncertainty fallback,
metadata authoring and atomic commits remain conservatively ordered.

Opt-in `decisionTopicExecution.fullTransactions: true` (host environment
`TYPEAGENT_MEMORY_DECISION_FULL_TRANSACTIONS=true`) instead stages complete
transactions concurrently, including roots, unchanged broad fallback and
metadata authoring. `lookahead` bounds this window. Workers never publish.
Full concept read versions, nomination-query inputs, universe predicates,
write versions and node ownership are validated in focal order. A compatible
prefix merges into one atomic checkpoint; the first conflict discards the
remaining prepared suffix and replans it on the latest state. This setting
enters model/view identity. Single-writer group installation prevents lost
updates; it is not competing replacements of the same snapshot file.

The 24-call Decision limit is shared across the build, not per transaction.
Endpoint-configured transport throttlers and bounded 429 Retry-After/backoff
remain in force. Informational endpoint `capacity` is not interpreted as an
RPS limit. An exhausted retry budget fails and drains the transaction window;
no application-level retry loop masks transport errors.

### Localized cluster validation (investigation)

Opt-in `decisionTopicExecution.clusterValidation: true`, or
`TYPEAGENT_MEMORY_DECISION_CLUSTER_VALIDATION=true`, replaces broad uncertainty
re-curation with fixed-context cluster checks. Initial classification, exact
evidence indexes and the shared native concurrency limiter are retained.
For the controlled 24/24/1 treatment:

```powershell
$env:TYPEAGENT_MEMORY_DECISION_TOPICS = 'true'
$env:TYPEAGENT_MEMORY_DECISION_CLUSTER_VALIDATION = 'true'
$env:TYPEAGENT_MEMORY_DECISION_CONCURRENCY = '24'
$env:TYPEAGENT_MEMORY_DECISION_BATCH_SIZE = '24'
$env:TYPEAGENT_MEMORY_DECISION_LOOKAHEAD = '1'
$env:TYPEAGENT_MEMORY_DECISION_FULL_TRANSACTIONS = 'false'
```

Each proposed cluster shares complete member grounding across a coherence
question and per-member disposition questions. Questions reference a fixed
supplied concept, not another answer. Existing members are read-only diagnostics
during admission: a suspect old member cannot veto a valid new attachment.
Fixed-membership checks exclude alternative-target context; only positively
rejected new members enter separate complete-nomination assignment searches.
Old-member questions that exceed the admission budget are explicitly left for
maintenance. If old-anchor evidence also exhausts context, an explicitly narrower
admission-only packet supplies the complete collection definition and complete
new-member evidence; it does not claim to check old-anchor health. No new-member
evidence or alternative-search choice is silently pruned.

Cluster packets and fixed-group metadata authoring share lossless grounding
compaction: repeated source/revision pairs use `sourceRef` records, and repeated
long fields in canonical chronology JSON use exact value references. Opaque
clocks and unique chronology values remain literal. The smaller logical-token
representation is selected; no member, alternative, citation, role or temporal
qualification is removed. Existing validation/authoring budgets still apply.
Packing diagnostics expose `uncompactedInputTokens` alongside planned
`inputTokens`; these are not provider-reported usage or quality measures.

The host supplies shared validation rules once. Every member choice explicitly
names its own candidate, and alternatives are distinguished from actual members.
Fit means original topical evidence explains the fixed reference concept under
compatible factual scope, not that raw labels must be synonyms. Raw candidate
scope can be a source boundary, including a source ID, rather than a semantic
scope. Joint compatibility is a separate question for newly authored groups,
not a duplicate all-members-fit veto or an old-anchor health gate. For singleton
publication, whole-cluster coherence and that member's fit are the same logical
claim: one native question supplies both scores without conflicting duplicate
judgments. These policy/layout changes enter the opt-in model identity.

Lossless data reconstruction does not guarantee identical native judgments.
This policy remains experimental; neither context reduction nor time to pending
establishes semantic quality or completed-curation speedup.

Uncertain member fits, final negative fits after a proposal, and unresolved new-group compatibility receive at most
one local generative adjudication per fixed version. This review uses exact
grounding and a strict member-bound schema; a positive joint conflict requires
supplied member witnesses and an explanation. It cannot rewrite definitions,
invent evidence or repartition unrelated collections. Unresolved judgments,
cyclic dependencies and capacity limits produce retryable `curation.pending`.
There is no broad-stack generative fallback. Provider failures and cancellation still fail
and drain in-flight work, rather than becoming pending. Transport 429 handling
is unchanged. Lookahead greater than one and full speculative transactions
are rejected in this mode.

Validated concepts retain the exact original member citation union. A
version-bound `validation` receipt binds complete membership, definition,
original evidence, role/chronology context, input fingerprint and model identity.
New `coverage: "member-admission-v2"` receipts explicitly list
`validatedMemberIds` and `method` (`decision` or `generative`). They certify only
the declared member fits, not the health of unreviewed old members. Legacy
whole-cluster receipts remain readable. Generative receipts never fabricate
native scores.
Native `score`/`memberScores` are uncalibrated choice probabilities, not
calibrated relationship confidence. Lazy summaries store their selected
support separately in `summaryCitations`; they cannot shrink certified
canonical provenance. Legacy concepts retain their existing summary behavior.

Old-member uncertainty persists in a version-bound `maintenance` signal
(`priority`, `reasons`, `suspectMemberIds`). Priority is an uncalibrated scheduling
heuristic, not semantic confidence. Successful admission and lazy summaries do
not clear it. Explicit topic-family rebuilds in cluster mode process signaled
collections by descending priority, then concept ID, including when there are
no new topics. Ordinary ingestion only records the queue. Each maintenance
review is local, complete and bounded; only positive outliers leave the fixed
collection, returning to retryable pending assignment. Uncertain members remain
in place with maintenance priority. Completed units checkpoint durably;
oversized reviews retain a capacity signal, and failures/cancellation do not
publish a partial unit. This is prioritized collection maintenance, not a
whole-corpus generative rebuild.

Curated queries expose bounded `pendingAssignments`, `pendingCount`,
`omittedPendingAssignments` and explicit limits. Raw evidence remains
queryable; pending members are not validated concepts or low-value deferrals.
An explicit subsequent curation pass retries them. A completed build with
pending assignments is not fully validated semantic completion. Switching
pending continuation state to the legacy Decision or generative path fails
explicitly. The cluster recipe and option enter model/view identity; legacy
defaults remain unchanged.

This is a retained-concept implementation, not a wholesale relationship graph
or a general confidence-bearing assertion store. It does not add broader/related
semantics, transitive equivalence closure, or graph expansion to QA.

Configured curation sends a strict, per-batch response schema with bounded
text fields and enumerated occurrence/evidence IDs. JSON-only adapters retain
the same prompt bounds and host validation. Contract failures in text bounds,
membership accounting or evidence assignment permit one explicit repair against
the unchanged evidence batch, with a fresh membership accounting pass. If an
otherwise validated response omits nodes, the host retains valid decisions and
requests one targeted completion for the missing nodes plus relevant admitted
concepts, using the unchanged evidence. This can also follow a general contract
repair; a second omission is terminal, not another retry. Validated unrelated
decisions are not regenerated. Length
diagnostics identify the field, observed length and limit. Repairs must account
for every supplied occurrence exactly once and cite only evidence belonging to
their members. Repeated violations and provider failures remain errors; text
is never silently truncated and invalid provenance is never admitted.
When a previously admitted concept is reconsidered, evidence ownership is checked
against all expanded original raw members and their occurrences, not just the
concept's earlier selected citation subset. Truly unrelated sources remain invalid.
Lazy curation packs raw candidates from the same source revision together
before applying the existing node and evidence-byte bounds. This reduces
repeated source context without dropping evidence. Source proximity is a
batching decision, not proof of semantic equivalence; the LLM still decides
admission and cross-batch reconciliation.
The curated-lazy-v6 recipe invalidates earlier curation-policy snapshots.

Validated curation decisions are durably checkpointed after the first batch,
every eight batches and the final batch, using the existing incidence write path.
Partial decisions remain separate from completed curation and are not exposed
as a finished curated hierarchy. A retry can reuse them only when corpus,
recipe, source/index fingerprint and exact occurrence evidence are unchanged;
human-authored node metadata prevents reuse. Source eligibility is rechecked
before every write. Checkpoint persistence errors stop generation. Completed
curation is also saved before organization, so an organization failure does not
require repeating valid curation.

Organization uses a strict response schema enumerating the supplied batch IDs.
Invalid identities, malformed edges, self-links or parent cycles permit one
replacement response against the unchanged label/scope batch, followed by fresh
identity and whole-graph DAG validation. Repeated contract errors, cancellation
and provider failures fail the build explicitly; they no longer return a
success-shaped snapshot with silently absent graph edges. Valid empty edge sets
remain allowed when the model finds no useful organizational relationships.

Ordinary browsing, filtering, graph reads and knowledge readiness never require
topic prose. Maintained hierarchy nodes represent admitted concepts and point
to original occurrences; raw co-occurrence graphs remain indexed evidence.
Parent/related organization uses concept labels and scopes, not summaries, and
still runs during background maintenance. An in-progress concept build reports
building coverage rather than exposing provisional raw nodes as a finished
curated hierarchy.
Wiki construction retrieves its own indexed evidence and does not consume
topic summaries.

An explicit detail request,
`queryTopics({ corpusId, curated: true, topicId, summarize: true })`, generates
only that concept's summary and independently audits it against original
evidence. It cannot be combined with search or continuation. Concurrent requests
for the same generation/concept share work; successful prose is durably cached.
Changed source eligibility or a rebuilt generation rejects stale writes.
Source removal and shutdown abort and drain owned summary work. Failures
propagate to the caller; a later explicit request can retry. Summary absence
does not count as missing evidence or prevent curated-topic readiness.

The topic browser opens curated concepts by default, exposes original evidence
before prose exists, and offers an explicit **Open concept summary** action.
**All topics** and member drilldown preserve access to raw occurrences without
triggering model work. Opening an admitted concept's hierarchy detail also
requests and caches its summary; loading the graph itself does not.

### Question chronology and bounded evidence repair

Question candidates retain absolute `effectiveAt` only when the evidence states
a timezone. Timezone-free observations can instead carry
`localChronology: { timestamp, scope }`, preserving minute/second precision.
The scope must identify a source-established common clock or ordered
conversation/journal timeline. `mostRecent` compares local times only within
the same scope; mixed absolute/local clocks and unrelated local scopes remain
incomparable. No timezone is inferred from ingestion time. Each support keeps
its own chronology when equal candidate values coalesce; a candidate-level
timestamp is not invented across incompatible clocks.

Historical value changes are separate dated observations, not automatically
opposing evidence. Confirmation, authority, independent-support and freshness
requirements remain in force. A complete but unsupported schema-answer audit
can trigger one repair against unchanged retained passages, followed by host
validation and a fresh support audit. Incomplete audit coverage, provider
failures and a second unsupported result do not become accepted drafts.
Generation and repair require every clause of every source candidate, including
unselected candidates, to be supported by that candidate's own cited passages.
Silence in an excerpt does not establish that an entire source has no decision.
Repair adds the actual supporting passages or narrows unsupported clauses while
preserving supported competing history; an unresolved aggregate answer does not
exempt its candidates from these checks.
Rendered source-derived answers explicitly describe historical observations and
show their source times or unknown chronology. Maintenance freshness is not
present-day verification of the observed fact.

Wiki assessment repair reports omitted fragment ordinals and invalid witness
ordinals. A coverage witness must quote a contiguous, verbatim substring of
the selected canonical page prose; a source excerpt or paraphrase is not a
canonical coverage witness. The same evidence is reused for the single bounded
repair, and host coverage/provenance validation still rejects invalid results.

Canonical contribution coverage is separate from standalone admission and
redundancy screening. It checks the actual merged article against mandatory
incoming distinctions and supported prior qualifications, using original source
evidence, not the prior article as evidence. Unrelated retrieval context is not a
mandatory new subject. A complete non-covering assessment can drive one article
reconstruction, then another merge, host validation and independent coverage
assessment. Both initial contributions and later refreshes share this path.
Human edit conflicts bypass reconstruction and remain conflicts; transport
errors, incomplete assessments and a second omission remain explicit failures.

## Offline test fixtures

Memory maintenance regressions use the bundled synthetic
[`test/fixtures/memoryDemo`](test/fixtures/memoryDemo) snapshot rather than a
separate local checkout. It contains the 33 canonical Markdown operations for
25 logical sources, plus the profile and evaluator-only expectations/actions.
The imported bytes are unchanged from the original synthetic fixture set.
Evaluator metadata stays separate from content-only sources and must not be
supplied to synthesis or extraction. Qualification-tool tests use the same
snapshot; actual qualification runs still require an explicit fixture root.
No generated memory stores, recordings, provider responses or run receipts are
included in these fixtures.

### Memory quality evaluation

The [offline quality tools](../../../tools/memory-maintenance-qualification/quality-README.md)
prepare frozen artifact bundles, a category-stratified LongMemEval diagnostic,
and BenchmarkQED/AP-news inputs with separate construction and evaluator packets.
Run their deterministic checks from the TypeScript workspace with
`pnpm run test:memory-quality`; they are also included in `test:local`.
These checks do not run production inference or certify factual quality.
The authored artifact pilot requires independent human review before scoring.

The ingestion profiler's source-level regression tests run through
`pnpm run test:memory-quality`, or directly with
`node --test tools/memory-maintenance-qualification/ingestion-profile.test.mjs`.
The embedding timing harness loads the production input-token checks and batching
helpers alongside the instrumented function. It verifies retries, vector validation
failures and rejection of oversized inputs before model calls, without a provider.

Project status rendering keeps capacity review pending distinct from a supported
blocked condition. A `pendingOwnerReview` enum alone does not establish blockage;
any actual blocker and its scope must remain in evidence-backed section prose.

## Maintained knowledge quality

Wiki and Project Views generate substantive source-grounded summaries and
separate article completeness (`partial` or `sufficient`) from evidence freshness,
human review, incident closure and project approval. Project briefs retain typed
assignments, milestones, decisions, risks and open questions without inventing
missing owners, dates or outcomes. Wiki admission binds the exact queried subject
and may defer a thin or redundant candidate. Canonical contributions and
consolidations independently check actual prose, with bounded evidence-grounded
repairs that preserve stable anchors, citations, protected structures and human
edits.

Topic maintenance retains complete raw incidence while admitting scoped,
purposeful concepts through semantic assessment. Candidate reconciliation and
source-local packing preserve membership and provenance; partial curation and
completed concept organization are durable checkpoints. Plain topic browsing
exposes concepts, members and original evidence without another graph API.
Concept summaries remain pending until an explicit curated-topic detail request
uses `summarize: true`; generation and independent support auditing share
concurrent requests and cache successful results in the current generation.
Evidence/fingerprint changes invalidate that cache. Shutdown, corpus clearing
and source removal cancel outstanding summary work. Maintenance drain does not
eagerly summarize every concept.

`curatedTopics` defaults to `true`; setting it to `false` retains the raw-topic
summary pipeline. No model-backed quality or latency qualification is implied:
native curation latency and source-synopsis model failures remain follow-up work.
The quality pipeline is separate from the discovery and answering lifecycle
below. This change does not add a new graph explorer.

## Automatic knowledge preparation and integrated answering

New corpora default to `sourceObserved` question discovery; existing corpora with
no persisted discovery policy remain off. Hosts and clients can explicitly choose
`off`, `suggest`, or `sourceObserved`. Discovery uses bounded original-source
windows, existing contracts, evidence-grounded utility assessment and durable
fingerprints, receipts and hourly call budgets. Repairs reserve call allowance.
Policy-admitted informational contracts are not human-confirmed answers and do
not authorize external tools. Failed discovery requires an explicit bounded
retry; source changes invalidate affected work.

Knowledge checkpoints capture exact source revisions, index identity, enabled
families and exclusions. A producer-complete checkpoint continues bounded
maintenance until its captured work finishes or it reaches an explicit nonready
outcome. Ingestion completion alone is not readiness. Inspect `state`, `coverage`
and `reasons`, including partial, blocked, failed, superseded and cancelled work.
Complete curated-topic coverage does not require eagerly generated concept prose.
Ingestion deferral, family coordination, source eligibility changes, privacy
removal and shutdown apply to this work.

Answers default to integrated original-source and eligible published-View
retrieval. `sourcesOnly` bypasses Views; `sourcesAndViews` requests the integrated
path explicitly. Optional `knowledgeCheckpointId` binds readiness to a captured
scope. View evidence is revalidated for source scope, review, freshness,
conflicts, authority, publication and access eligibility. Supporting citations
expand exact retained source passages rather than trusting cached View excerpts.
Derived references and user assertions remain distinct from original-source
citations. Reconstruction and follow-up retrieval have finite evidence/request
bounds and expose opt-in reader diagnostics. No live model or benchmark
qualification is implied by deterministic tests.

## Test suites

Build from the TypeScript workspace root before running compiled tests:

```powershell
pnpm run build @typeagent/memory-service
pnpm --filter @typeagent/memory-service run test:local
pnpm --filter @typeagent/memory-service run test:regression
```

`test:local` runs the offline `.spec.ts` correctness suite used by PR CI.
View-history ordering, exact records, authorship and selective parsing are checked
with ten commits; privacy-purge, recovery and concurrent-read cases remain in
that suite. The same assertions run against 100 and 1,000 commits in
`test:regression`, which selects only `.regression.ts` files and runs serially.
These scaling cases are excluded from normal Jest discovery and `test:local`;
no tests are skipped.

Retained-index privacy checks drain deferred maintenance before enumerating the
segment directory, so background reclamation cannot remove an obsolete segment
between directory listing and inspection.
In CI, Jest runs this package in one worker and recycles it between suites when
its idle heap exceeds 1 GB. This bounds accumulated ESM module state on Node 22
without increasing test timeouts or skipping coverage.

The [memory-regression workflow](../../../../../.github/workflows/memory-regression.yml)
runs both suites every Monday at 08:23 UTC and on manual dispatch, on Ubuntu,
Windows and macOS with Node 24.22.1. Each OS uploads Jest JSON results, including
individual test durations. No model credentials or external fixture checkout
are required. Model-backed `.test.ts` rehearsals remain separately opt-in.

## Automatic maintenance foundation

When a Wiki candidate overlaps an existing page, the service checks the page's
actual prose to decide whether the candidate adds useful evidence. Coverage and
contribution checks require current revisions, exact indexed citations and all
supplied critical requirements. Rejection receipts contain bounded reason codes
and counts, not raw model responses. Technical failures, ambiguous matches and
human edit conflicts have separate reasons.

Informational jobs isolate target timeouts and request budgets. Completed targets
remain committed while unchanged semantic rejections/conflicts are parked in
existing results. Provider/materialization failures receive one automatic retry
before being parked; changed evidence or recipe, or an explicit rebuild, makes
the target eligible again.
Target timeout is a technical failure, not cancellation of its peers or a user
decision. Job cancellation remains explicit. Job completion and family checkpoint
share the serialized write boundary so readers cannot observe a false-idle gap.
Startup and a 30-second reconciliation sweep repair missed source/index dirty hints.
During a durable bulk import, automatic source-synopsis, topic and Wiki/project maintenance remains
pending rather than repeatedly constructing snapshots of an unfinished batch.
Settlement of the last active batch for that corpus resumes maintenance using
current eligible sources. Overlapping batches, retries, cancellation and startup
recovery share this admission guard. Explicit manual builds remain available;
privacy invalidation and late-write eligibility checks are not deferred.
Committed informational revisions repair exact publication/index effects without
repeating synthesis or creating a new revision. A clean restart does not create
an unnecessary history commit.

### Foreground scopes and bounded autonomous work

Maintenance execution is independent of `informationalViews`, `viewDrafts` and
native answer selection. `maintenanceMode: "automatic"` is the normal service
policy. `maintenanceMode: "manual"` retains dirty work without starting automatic
model/view builds; explicit `maintainViews` remains available.

```typescript
const service = new FileMemoryService(store, {
  maintenanceMode: "automatic",
  ingestionCommitPolicy: {
    maxDocuments: 10,
    maxBytes: 8 * 1024 * 1024,
    admissionWaitMs: 250,
  },
});
const release = service.deferMaintenance();
try {
  // Import and query any loaded corpora without starting new autonomous work.
} finally {
  release();
}
const status = await service.drainMaintenance(30_000, signal);
if (!status.settled) {
  // Report pending, deferred and failed work rather than claiming completion.
}
```

Foreground holds nest and release idempotently. They apply across loaded corpora,
including earlier imports. Already-running work may finish; acquiring a hold is
not an interruption of a committed build. One family can have one running request
and one coalesced latest-generation request. Pending work is reconstructed from
durable source/family state after restart, not from an in-memory timer journal.
Reconciliation does not enqueue duplicate passes behind an occupied corpus.
Privacy removal and eligibility checks are never postponed by this policy.

Non-privacy segment collection uses the same coalesced queue and admission
guards. Manual mode, foreground holds and shutdown may leave that cleanup
pending; startup reconstructs it while retaining index generations and integrity
checks. Drain maintenance when cleanup completion matters. Authorized forgetting
and corpus-clear collection remain immediate rather than waiting for this queue.

`getMaintenanceStatus()` reports queue keys, active work, coalesced request count,
budget deferrals and failures. A drain temporarily executes manual-mode work;
it does not override foreground holds or active imports. `reason: "deadline"`,
`"paused"` or `"budget"` and `settled: false` describe incomplete work explicitly.
Deadline/abort signals reach automatic view builds and synopsis generation.
Partial view builds retain their durable per-target errors without blocking
independent targets or the family's continuation. Unchanged failed informational
inputs retain the existing two-attempt automatic retry limit. Unresolved target
failures appear in `failures` under a corpus/family/target key and keep
`settled: false`, even after the queue is empty; a drain then returns promptly
rather than spinning until its deadline. A successful retry clears only that
target's diagnostic. Infrastructure and persistence failures still block the
affected family until its existing retry conditions are met.
Question reconciliation also reports blocked or exhausted automatic outcomes
in `failures` under a corpus/schema key and in the question inventory's
`maintenanceError`. These outcomes keep `settled: false` without failing service
shutdown. Full-input limits and stopped retries remain enforced; changed
evidence or a successful explicit retry clears the diagnostic. Unexpected
schema-maintenance errors, including exhausted head/version conflicts, still
fail shutdown.
Shutdown cancels their linked work before releasing storage. A provider that
ignores cancellation must still be drained before storage ownership is released.

Optional `maintenanceLimits` bound `maxTargetsPerPass` (at most 12),
`maxCandidatesPerPass`, `maxPassesPerGeneration`, and a shared `requestBudget`
using the existing client attempt/token/elapsed admission checks. No new optimal
budget is assumed: limits other than the existing 12-target cap are opt-in.
Configured ranking prioritizes existing pages and source-supported subjects,
without requiring multiple sources or blacklisting filenames, routes or dates.
Unchanged rejected candidates are checkpointed before another expensive capture;
source generation, page versions or admission/model policy changes invalidate
that decision. Explicit manual maintenance bypasses automatic pass/read limits.
Pass counters and deferred descriptors survive restart. A pass budget defers
derived output, not the underlying source facts.

Publication limits are independent of model concurrency. The product retains
two-document commits by default; hosts can opt into larger document/byte-bounded
groups. The admission timer prevents a missing/slow peer from blocking progress,
so a delayed admission can form a smaller safe checkpoint. A source larger than
the group byte budget is processed alone, never truncated. Grouped append/rebuild
continues to use the index's existing bounded extraction/embedding settings.
Unsupported grouped updates fall back to serialized single-source ingestion.
Manifest publication remains atomic and source eligibility is rechecked.
Recovery/retry reconciles committed revision identities even when job/member
acknowledgments failed; missing or corrupt storage is not fabricated as success.

KnowPro partitions hosted index embedding inputs into sequential subbatches totaling at
most 8,000 `cl100k_base` tokens, in addition to the per-input 8,000-token guard.
This aggregate work budget prevents a larger publication group from becoming one
quota-sized embedding request; inputs remain intact and ordered. The runtime's
default embedding attempt budget is 180 seconds, matching the hosted HTTP budget
and allowing a provider's 60-second rate-limit wait to finish before an outer
retry starts. Explicit caller deadlines remain supported. Character-bounded
runtime embedding batches retain serial default concurrency.

`ViewBuildSnapshot.influenceSources` records source/revision identities of nominated
page context read during admission, including inputs not cited by the output.
These dependencies participate in late-write/publication eligibility and privacy
purge; ordinary retained inputs are also privacy dependencies even without citations.
Human-authored drafts retain human authorship; generated builds record maintenance
authorship. This maintenance path does not save agent-authored drafts or
consolidate articles; consolidation is described separately below.

Authorized source forgetting first durably enrolls removal in the source manifest.
Until source/index/view/history/assets/batch/context cleanup completes, corpus content reads
and affected-source writes are withheld, including reads queued before authorization.
Unrelated accepted ingestion can finish while reads remain denied. Job
diagnostics are redacted while removal is pending and durably scrubbed on completion.
Restart and reconciliation resume enrollment without an expiring preview token.
Privacy removal outranks human edit protection and cancels late model results.
The preview token alone does not deny access or constitute durable removal.

## Canonical revision text storage

Corpus manifests use `storageVersion: 1`. Revision metadata contains a `text`
reference with the SHA-256 digest and byte length of an immutable corpus-local
`revision-text/<digest>.json` blob, not an inline `content` field. Each blob is a
UTF-8 JSON string; escaping preserves exact UTF-16 content, including lone
surrogates. Source hashes, citation coordinates and revision identities are
unchanged. Text remains available in the owner's in-memory source snapshots.

New blobs are staged, read back and digest/size verified before manifest
publication. Existing immutable revision references are reused under the store's
single-owner lock. Manifests publish using staged atomic replacement with bounded
Windows retry, without moving the previous canonical file away first. This is a
process-restart recovery protocol, not a multi-file transaction or proof of
power-loss durability. Metadata serialization, source-count-dependent work and
index-generation copies/rebuilds remain.

Only committed manifest references retain blobs; there is no separately committed
reference-count database. Replacement collects unreferenced text after commit,
and startup collects abandoned blobs/staging files. Missing, corrupt or unsafe
referenced blobs fail explicitly; derived indexes never reconstruct canonical
text. Content is shared only within a corpus and only while another retained
source/revision legitimately references it.

Source forget physically purges last-reference text before clearing its existing
durable removal intent. Corpus clear similarly records `pendingCorpusClear`,
withholds corpus content reads/writes on cleanup failure, and resumes its
event/index/asset/text cleanup at restart before reopening reads. Text-reference
caches contain metadata only and evict removed references before deleting files.

Older/unrecognized canonical manifest formats are rejected with explicit
reset/reimport guidance, never silently migrated or deleted. Preserve the store
and use its matching build to export needed data before explicitly resetting and
reimporting. Existing derived-index rebuild rules are unchanged.

## Incremental indexes and event segments

KnowPro-backed derived generations now publish a small `corpus_data.json`
descriptor over immutable content-addressed JSON nodes in the index root's
`.segments` directory. Generation copies copy pointers and generation metadata,
not retained node payloads. Related-term and message vectors have separate JSON
lanes and reconstruct the same Float32Array values. Other KnowPro clients keep
the existing serialization unless they explicitly opt in.

An existing compatible source using `retainRevisionHistory`, without acquired
assets, can replace its active revision by indexing only changed content.
`eligibility.json` selects one retained revision per source. Message ordinals
remain stable; knowledge, fragments, subjects and vector candidates exclude
inactive revisions before ranking limits. Reactivating indexed historical
content requires no provider extraction. Replacement without history and
unsupported/custom indexes still rebuild, preserving physical removal behavior.
Explicit reindexing compacts inactive indexed revisions from current canonical
sources. Metadata serialization, full index hydration, in-memory JSON traversal,
linear vector search and retained-history growth are not eliminated.

Canonical `events.jsonl` is now a version-1 publication descriptor, not a
concatenated log. Immutable JSONL event files live in `event-segments`; a
filename-derived lookup selects individual event bodies without decoding all
retained events. The pointer records monotonic sequence and independent
eligibility revision; suppression/tombstone metadata lives in a referenced blob.
Append publishes one event and a bounded pointer. Listing and search still load
the required event set, and cold lookup scans filenames. Same-eligibility event
index reconciliation extracts only the appended suffix. Deletion invalidates
derived generations even when later append restores the prior event count.

Forgetting retains a durable pending-purge descriptor until event payloads,
obsolete suppression blobs and dependent indexes are physically removed.
Recovery finishes that purge before reads resume. Generation descriptors retain
shared JSON nodes; ordinary obsolete-node collection and explicit reindexing
remove unreferenced data, while privacy cleanup drains writers and removes
affected bytes before reopening reads. Canonical old/future event formats fail
with explicit reset/reimport guidance; no store is automatically migrated or
reset. These are process-restart recovery guarantees, not a power-loss
transaction across files.

Single-document cancellation, like shared-batch cancellation, remains
`cancelling` until actual provider writes drain. An abort-ignoring provider can
delay terminal cancellation, close or privacy cleanup; no terminal success is
reported while it could restore removed bytes.

## Automatic editorial maintenance

Wiki and Projects revise complete small targets through existing family jobs.
`ViewBuildSnapshot.editorial` supplies the current generated base as an editing
reference, never as new evidence; generation still reads original indexed sources.
Agent revisions use `memory-view-generator` authorship, not authenticated human saves.
Deliberate human title/text/annotation edits are protected at existing reliable
edit units. Genuine overlapping changes create the existing recoverable conflict;
unrelated targets continue and routine supported corrections remain automatic.

`saveViewDraft` accepts optional `unlockProtection: string[]` with unchanged
content, definition and relationships plus the current head/version guards.
The service authenticates the author and rejects client-supplied actors.
Unlock records intent in existing edit records without immediately rewriting
human text, then schedules the existing family to revise unprotected units.
Browser **More actions** offers per-unit unlock; CLI `save`, RPC, in-process and
MCP use the same request. Ordinary human saves alone do not cause extra synthesis.
Current reads expose authoritative `protectedTargets`, including units inferred
from older authenticated edit records; the browser does not guess unlock units.

Consequential updates check actual merged prose for quantities/cohorts,
command-versus-lease, project scope/state and correction/withdrawal. Invalid
assessments and unsupported critical distinctions are bounded technical
rejections, not requests for blanket human approval. Custom adapters must provide
`checkEditorial` for consequential updates; missing capability fails explicitly.
Configured topic summaries check against all supplied original evidence, including
uncited qualifications; rejected prose is removed while independent nodes continue.
Topic summary and editorial work uses three concurrent workers, with stable node
ordering and timing ordinals. Failure or cancellation stops new work and drains
already active calls before returning. Concise final-response guidance matches the
1,600-character summary contract without limiting reasoning tokens. Summary reuse
requires the same corpus/model, owned evidence and complete same-source/revision
context; changed or suppressed context regenerates the summary.
Current eligible `relatedArticles` are a bounded original-source/revision-overlap
navigation projection, not equivalence, redirects or corroborating evidence.
Source eligibility, influence tracking and authorized removal override protection.
Live model quality is evaluated separately from these lifecycle checks.

## Revision-bound source synopses

`SourceRevision.synopsis` and source search evidence expose optional lightweight
preview/status fields. `getSourceSynopsis({ corpusId, sourceId, revisionId? })`
reads the inline exact-revision overview, generated version/recipe/freshness,
original retained UTF-16 evidence and explicit scan/fidelity limitations. Lists
never include overview/evidence payloads. Synopses are navigation aids, not
independent citations; original UTF-16 ranges are never indexed locators.

The current configured synthesis role and request constraints select direct input
or bounded source-order sections, turns and loss-preserving table continuations.
Temporary summaries carry distant qualifications/contrasts into bounded
composition and are never persisted as a summary tree. Missing capacity metadata
is unavailable, not unlimited capacity. Full scan is not exhaustive semantic
coverage or original acquisition completeness.

Synopsis prompts aim for approximately 2,000 tokens of final JSON, excluding
reasoning. This is guidance, not an API completion cap or response truncation.
Requests omit completion-limit parameters so reasoning can use the model's
available output capacity. Input admission still reserves the configured full
provider output capacity against the context window; explicit opt-in request
budgets remain enforced locally. Required evidence, character bounds and
governing qualifications are still validated, and overlong or invalid fields
are rejected rather than silently shortened.

Recipe `source-synopsis-v3` resolves exact evidence quotes to retained UTF-16
coordinates in the host. Models may omit offsets instead of computing character
counts. Existing exact supplied ranges remain valid and can disambiguate repeated
quotes; otherwise a quote must have exactly one eligible occurrence. Section
evidence is restricted to that supplied section, and composition can select only
evidence supplied by its input summaries. Missing, invented, or ambiguous quotes
fail explicitly. Quotes and source line endings are never normalized or matched
approximately. Persisted evidence keeps the same coordinate shape; the recipe
change invalidates older semantic fingerprints.

Indexed source answers balance relevant query coverage across sources. Ordered
conversation questions can retrieve neighboring nonempty blocks from the same
eligible source revision; the reader uses source-owned turn metadata and block
ordinals, never retrieval rank, to establish order. Recommendation answers may
transfer remembered preferences into conditional criteria, but cannot invent
named inventory or availability.

When missing historical evidence causes `noAnswer`, the reader may propose up
to two focused searches. The service performs only one refinement round, using
the original source scope, temporal context, search bounds and request budget.
New and original evidence are interleaved with overlapping ranges removed,
retaining the default final limit of twelve fragments and 24,000 snippet
characters. A final `noAnswer` is not retried. Refinement can add two searches
and one reader call, so aggregate retrieval and provider cost can increase;
per-search indexed reads remain bounded at 32,000 characters. Diagnostics retain
both reader contexts and the refinement queries and selection receipts. The
product and qualification harness use this same answer path.

The bounded refinement also applies to integrated source-plus-view answers,
including `sourcesOnly`. Follow-up searches retain the original access scope
and temporal constraints; views are still evaluated against the original
question. Delivery validation rechecks evidence from both reader calls, even
when the final bounded pool omits an initial passage. A delivery-race
reconstruction remains limited to one retry and may repeat that bounded
refinement. Integrated diagnostics expose the initial typed evidence and the
follow-up selection receipts under `integratedAnswer.refinement`.

All memory synthesis, topic, indexed-answer and hub-answer calls now omit
optional OpenAI completion limits. Their prompts express approximate final-JSON
length targets separately from reasoning; citation and coverage validators are
unchanged. Reviewed wiki admission derives its context/output envelope from
verified capacities of the selected models, including the Luna extraction role,
and fails explicitly for missing capacity or incompatible strict overrides.
The shared envelope covers the largest selected capacities, while transport
admission still checks each actual model's own context/output limits; mixed
roles do not combine one model's output with another model's smaller context.
For the standard Luna capacity, each chat reserves up to 128,000 output tokens.
The reviewed defaults still allow at most 24 chat attempts, 128 embedding
attempts, 16,000 estimated input tokens per chat, 300,000 per embedding request,
and 600,000 ms. Aggregate reservation is 160,000 input tokens plus 24 times the
model output capacity (3,232,000 for Luna); the separate 160,000 cumulative-input
guard applies to chat and embedding attempts. Reservations are worst-case
admission estimates, not actual model usage or generation caps. Product
maintenance remains unbudgeted unless explicitly configured.

Source-owned startup/periodic reconciliation and inline attempt receipts recover
interruption with one automatic retry, parking unchanged repeated failures.
Semantic input freshness ignores unrelated reindexing. Exact revision/eligibility
and read-but-not-cited influence checks reject late replaced/forgotten inputs.
Synopsis failure never blocks source indexing or search. Hosts can set
`sourceSynopses: false`; default enablement follows informational maintenance.
The existing private-store CLI adds `synopsis <corpusId> <sourceId> [revisionId]`.

## Complete maintained topic snapshots

`queryTopics({ corpusId, topicId?, search?, depth?, pageSize?, continuationToken? })`
browses one rebuildable `topics-v1` snapshot in the existing corpus view store.
`rebuildTopics(corpusId)` returns an existing view build job. The `topics` family
supports update/rebuild/pause/resume through `maintainViews`; startup, index hints
and periodic reconciliation share existing jobs and serialized writes.
Complete eligible occurrence/source-revision/original-indexed-citation incidence
is persisted before narrative model work. Pending/failed summaries and generation
limits remain explicit. Names, aliases and overlap never establish equivalence.
Organizational parents form a multi-parent DAG; related links are separate.

Response depth/count limits never truncate maintained membership. Continuations
pin generation and query shape; responses expose omission counts and serialized
state/snapshot byte measurements for full-state reads, not sharded IO. Scoped
opaque IDs conservatively use original source/block scope and extracted label;
block-boundary or label changes can change identity. Summaries use bounded original
evidence and configured view models, never synopsis prose as new evidence.
Source replacement withholds obsolete snapshots; source forgetting purges
read-but-not-cited influence and late writes use source/P2 guards. Sources with
suppressed knowledge are conservatively withheld where original indexed blocks
cannot safely isolate forgotten influence, and queries disclose this limitation.
Unsupported custom indexes report capability errors and are not auto-enrolled.

RPC/in-process/MCP, browser RPC/gateway/extension and corpus Overview browsing
share these operations. The private-store CLI adds `topics <request.json>` and
`rebuild-topics <corpusId>` (waits for the existing job). Topic generations are
not article revision IDs and topic jobs do not publish articles.

## Offline regression tests

Batch cancellation tests synchronize at admission and index-entry barriers.
Source-forget confirmation tests wait for completed commits before refreshing
stale preview tokens; an index held open until cancellation must not also block
the write reservation needed to obtain that preview.

The configured-model CLI regression uses a loopback HTTP server, two compiled
CLI subprocesses for build/status persistence, and the exported CLI for remaining
commands. Every command opens and closes its own service. This retains real
structured-output requests and edit/conflict coverage without repeatedly paying
for cold process startup. Test environment and model runtime configuration are
restored afterward.

## Indexed reads and search diagnostics

Document indexes are reused in memory while their published
generation and persisted-file fingerprint remain unchanged. Fingerprints check
schema, semantic-data, embedding-file and projection/readiness-marker metadata;
schema validation and recovery still run when these change. A restart loads
the published generation again. This does not persistently cache queries or model responses.

Prepared document searches, source knowledge, corpus knowledge and
document answering can share a per-corpus read reservation. Published-index
preparation and mutations remain exclusive: commits, reindexing and forgetting
wait for existing readers, and later readers wait behind a queued writer.
Ingestion prepares a detached candidate index outside the corpus write reservation;
provider calls never mutate the live index. Its serialized commit rechecks the
captured generation and source revisions and merges current metadata. Stale,
cancelled or forgotten candidates cannot replace the published generation.
Forgetting also cancels and purges affected prepared candidates.
Unpublished reindex cleanup uses the same corpus write reservation as source
removal, preventing concurrent recursive deletion of a candidate generation.
Each async read retains its snapshot until completion. Cold runtime
loading is single-flight, and shutdown drains the complete preparation/read
lifetime before releasing storage.

Agent-session receipt stamps and file reads serialize with checkpoint publication
for that session. Source eligibility is checked after releasing that queue, so
source removal cannot deadlock behind a receipt read. Invalid or unsafe checkpoint
files still fail explicitly; receipt polling does not relax file validation.

Set `TYPEAGENT_MEMORY_SEARCH_TRACE=1` on the host process to enable correlated
Memory Hub search diagnostics on stderr. Lines prefixed `[memory-search-timing]` contain
JSON with a trace ID, scope, stage, elapsed milliseconds, status and non-content
metadata. The Hub propagates one ID through retrieval, insights and answer
generation, including service/RPC calls. Spans distinguish corpus fan-out,
queue waits, index checks/cache hits, validation/loading/rebuilding, KnowPro
translation/execution/fallback and synthesis. Overlapping spans are not
additive. The ISO UTC `timestamp` marks completion; subtract `elapsedMs` to
reconstruct span starts and identify overlaps and the critical path. Disabled
tracing does not emit logs or collect timing spans.

Queries, source excerpts, prompts, tokens and raw error messages are excluded.
Tracing does not change retrieval limits, model selection or when the Hub
returns its evidence and answer.

Natural-language searches reuse identical query embeddings within that request
and its compatible fallback passes. Cache identity includes the model object,
declared embedding identity (including normalization), and exact input text.
Document embeddings, other requests and different models are not shared.
Concurrent duplicates share one attempt; failed attempts are removed so a later
fallback can retry. The per-model request cache is bounded to 256 terms; overflow
uses the normal provider path without dropping terms. `LanguageSearchOptions`
accepts `reuseQueryEmbeddings: false` for controlled comparisons. Translation,
similarity thresholds, candidate limits and evidence selection are unchanged.

Build and ingestion diagnostics reuse this opt-in timing sink. With
`TYPEAGENT_MEMORY_SEARCH_TRACE=1`, `memory.build`, `memory.build.<pipeline>`,
`memory.ingestion` and `memory.synopsis` scopes also report build queue waits,
target totals, topic incidence/materialization, per-topic summary/editorial
model calls, organization, view admission/synthesis/editorial/materialization,
index append/rebuild, ingestion prepare/write-wait/commit and synopsis generation.
KnowPro index preparation/persistence spans distinguish provider preparation from
disk persistence. Build traces use the durable job
ID; per-topic calls carry numeric node ordinals and counts, not labels or text.
Model spans include client retry waits. Target totals and nested stages overlap;
do not add them as independent wall time. A returned target rejection remains
in its durable receipt even when the enclosing job runner finishes normally.

Batch traces add `batchId`, commit-group source counts/bytes and the enclosing
batch total. Maintenance traces add generation identity, queue wait, pending and
coalesced counts, and work duration. Query-embedding reuse records hit/miss counts
without recording terms. These augment the existing copy/load, serialization,
publication, invalidation, text-purge and segment-collection spans; parent/child
spans remain overlapping, not additive.

## Qualified generated Wiki consolidation

Existing Wiki family jobs can consolidate current generated articles when original
indexed evidence establishes one scoped purpose and an actual-output consequential
check passes. Shared citations only nominate a bounded comparison. Resource versus
failure explanations, incompatible initiative scopes, exclusions, protected units
and any historical human edits do not authorize automatic retirement.

The host retains unique sections, excerpts and citations in an exact registered
consolidation index; ordinary generation remains single-page. Existing target
results record prepared, accepted, redirected and ready effects. Canonical
acceptance precedes redirect activation; exact derivative readiness is separate.
Restart hydrates the original index and resumes committed effects without synthesis
or duplicate revisions. Changed targets park instead of entering semantic retry loops.

Current old-ID reads carry `redirect` with canonical identity and anchor mappings.
Memory Hub follows current canonical navigation; historical requests remain explicit.
Acceptance and activation reject cyclic or over-deep alias ancestry before a new
retirement could outrun bounded old-link reading; existing links remain navigable.
Authorized source forget purges redirects, histories, jobs and uncited influences,
overriding editorial protection. Existing authenticated conflict resolution handles
human decisions; this path adds neither an approval framework nor a second ledger.

## Revision assets and acquired batches

`IngestionSource.assets?: RevisionAssetInput[]` accepts already-acquired bytes
(`Uint8Array`), bounded display `name`, sniffed `mimeType`, optional
`description`, `instructionBearing`, and `warnings`. There is no filesystem-path
or URL-fetch API. PNG/JPEG/GIF/WebP/PDF signatures must match the MIME. Each
document allows 32 assets and **6 MiB total**; base64 plus JSON fits the existing
10 MB view transport. Text-only revision IDs remain unchanged; asset-bearing
revision digests include text digest, asset name/type, and byte digests. Assets
are immutable and revision-owned, not procedure-owned.
Descriptions are bounded to 2,000 characters and supplied warnings to 20 entries
of at most 1,000 characters, so metadata cannot bypass the byte bound.

`getRevisionAssets({ corpusId, sourceId, revisionId })` resolves only an exact
retained revision. `readRevisionAsset({ ...identity, assetId, hash, variant })`
returns `{ descriptor, bytes: Uint8Array }`, verifying SHA-256 again. Descriptors
contain `{ sourceId, revisionId, assetId, mimeType, name, size, hash,
description?, instructionBearing?, warnings? }`. Neither descriptor nor API
returns a host path. Storage checks traversal, directory/file symlinks and bounds.
Source directory names are SHA-256 identities, keeping case-sensitive source
ownership distinct on Windows and supporting legacy colon-containing IDs.
**Only `variant: "original"` is currently available.** These are unreviewed
pixels, never a safe UI preview. `"preview"` explicitly fails until separately
redacted and reviewed preview bytes are supported; a parent HTTP route must not
serve originals as safe previews. Replace without history removes superseded
owned bytes; source forget and corpus clear remove owned revision bytes/jobs.
Unrelated corpus files are untouched.

`startBatchImport({ corpusId, idempotencyKey, documents })` groups ordinary
ingestion requests, with each document omitting `corpusId`. Acquisition remains
host-owned. Limits are **50 documents / 8 MiB encoded request**, two active
members per batch, at most four active batches; corpus commits retain their
existing serialization.

Eligible new-source members share a detached index generation in groups of at
most **two**, with a **25 ms admission window** starting when the first job is
durably accepted. This is not a provider-duration or queue-wait bound. An empty
corpus rebuilds the pair together; a nonempty corpus copies its compatible
generation once and appends both documents. Each member still has its own durable
job, progress, cancellation and retry identity. Ordinary standalone ingestion is
unchanged. Replacements, duplicate source IDs, revision guards, assets,
unsupported append generations and budgeted rehearsals keep the singleton path.

Shared provider/publication failures fail the affected jobs explicitly. Before
publication, cancellation or a generation conflict discards the candidate and
retries unaffected members through singleton ingestion; corpus clear cancels
captured pre-clear admissions instead. Cleanup drains the actual provider
promise, including providers that ignore abort, before removing private files.
Committed sources retain the existing post-commit warning semantics.
Physical batch reads, staged publications and purge deletion share a per-batch
owner-local gate so rapid durable polling cannot hold a Windows file handle
across replacement. Reads still come from disk, and publication errors remain
errors rather than returning uncommitted in-memory state.

`measureBatchImportBytes(request)` returns the exact UTF-8 byte length of the
durable JSON encoding, including `Uint8Array` assets encoded as
`{ batchAssetBytes: "<base64>" }`. `assertBatchImportRequest(request)` applies
the same member/key/rejection checks and `batchImportRequestByteLimit` (8 MiB)
used by core admission, without acquiring content or creating jobs. These
side-effect-free helpers are backend exports, not browser-safe module imports.
`getBatchImport(batchId)`, `listBatchImports(corpusId)` (latest 100),
`retryBatchImport(batchId)` and `cancelBatchImport(batchId)` expose durable
member identity/state/reason/warnings and actual source/revision/job IDs.
Acquired member display names are bounded, redacted basenames of source titles;
neither POSIX nor Windows path prefixes are exposed as activity labels.
Members also retain a bounded/redacted `title` from the acquired source (including
duplicates); it is optional for legacy records. Source forget replaces both
title and display label with "Forgotten source". Rejected members use their
supplied display name or opaque key as a title, without inventing a source.
Same-content members are duplicates; stable content-based default source IDs
also deduplicate across batches. Reusing a key with different requests fails.
Success is not undone by failed members. Restart reconciles committed jobs and
marks other in-flight members interrupted; retry affects only failed,
interrupted or cancelled members. Cancellation actually aborts underlying
ingest jobs and waits for terminal results; committed members remain complete.
Successful/duplicate acquired content is released from batch storage; failed
content is retained for retry and purged on source forget/corpus clear.
Source forgetting cancels only matching batch members; unrelated captures are
allowed to finish. Those commits can invalidate the pending forget confirmation,
so refresh the preview before confirming again after an explicit stale-token error.
Batch reads/listings explicitly fail above 8 MiB instead of silently exceeding
the view transport. Batch diagnostics are bounded summaries with truncation
notices; the canonical ingestion job retains its own diagnostics.

Optional `documentKeys: string[]` supplies unique opaque client member IDs
parallel to acquired documents. `rejectedMembers:
{ memberKey, displayName?, reason }[]` records terminal acquisition failures
without pretending an ingest job or source exists. Display names are bounded
basenames, never paths; member keys are opaque identifiers. Results include
`clientKey`, optional `displayName`, and `stage: "acquisition" | "ingestion"`.
The combined acquired/rejected set is limited to 50 members and 8 MiB.
Empty `documents` is accepted only for nonempty rejected members.
`findBatchImport({ corpusId, idempotencyKey })` returns a prior durable batch or
`undefined`: the host should call it **before acquiring/refetching** content to
recover a lost response. Existing keys still reject changed request content.
Optional `acquisitionFingerprint` is a lowercase SHA-256 digest of the host's
typed acquisition request. It persists in batch detail/list/lookup results.
Before fetching, hosts must compare it with the submitted request's digest and
reject mismatches (or unverifiable legacy batches), rather than returning a
different request's batch. Core admission is serialized to prevent concurrent
key conflicts and active-batch-limit oversubscription.
Optional `acquisitionIssues: { member, state: "rejected" | "warning", reason }[]`
persists redacted acquisition notices in those same public results. `member`
must be an opaque `documentKeys`/rejected-member key (or numeric document index
when keys are omitted), never a path or URL. At most 50 issues with reasons of
2,000 characters are accepted. Rejected issues also create real failed
acquisition members, including issue-only batches; matching `rejectedMembers`
are deduplicated and conflicting reasons reject explicitly. Warnings must
reference known members. Source forget removes that source's issue metadata.
Optional root `warnings: string[]` retains batch-scoped notices such as ignored
orphan images (20 entries, each at most 1,000 characters), redacted and bounded.
These survive restart and source forget because no source owns them; corpus
clear removes the batch. Member-specific notices remain `acquisitionIssues`,
so ingestion warning updates cannot overwrite acquisition diagnostics.
`documentWarnings?: string[][]` also accepts parallel acquired-document notices
(20 messages of at most 1,000 characters per document). These are validated,
hashed, redacted, and merged into member warnings, including duplicates, without
discarding ordinary ingestion warnings. Legacy public batch reads backfill
missing names and parallel notices from retained private request metadata
without returning document content. Source forget scrubs associated notices.
Ordinary ingestion job writes are serialized per job too, so simultaneous
batch/source/direct cancellation cannot race backup replacement or regress a
terminal status to "cancelling".
Core retry never fetches or reopens rejected acquisition inputs; if only
acquisition failures remain, it explicitly requires new host-acquired content.
Reacquisition submits a new batch key; stable source content identities avoid
duplicate successful captures.
Hosts that intend replacement should supply a stable `source.sourceId` derived
from the acquired document's identity; `documentKeys` alone are member metadata,
not replacement source IDs.

Importing instructions retains source evidence, not saved procedures. Committed
index changes can schedule automatic Wiki/Projects and Topics work; explicit
builds and maintenance remain separate service operations.

## Derived memory Views

`new FileMemoryService(privateStore)` enables Views **by default**, without
user action. Hosts can explicitly disable them with `{ viewDrafts: false }`. `getCapabilities()` normally
advertises `derivedViews: { kinds: ["troubleshootingGuide", "projectBrief", "timeline", "wiki"], drafts: true,
history: true, builds: true, editMerging: true, publication: true, search: true }`.
Automatic informational-family scheduling follows committed index changes,
with batch deferral, durable pause and reconciliation. See
[the maintenance contract](../../../docs/architecture/memory/view-maintenance.md)
for the current automatic/explicit boundary.

`getSourceViewUsage({ corpusId, sourceId, pageSize?, continuationToken? })`
returns `{ items, total, nextContinuationToken? }` for current derived View
revisions that depend on a document source. Items contain only `viewId`,
`revisionId`, `version`, `kind`, `title`, `state` and `provenance`; archived
Views retain their explicit state. Document selectors, retained evidence and
relationship references count, but canonical event identities do not. Results
are ordered by View ID, with pages of 1–200 items (default 50).

`listViews(corpusId)` returns `{ head, views }`, including pending drafts and
explicit lifecycle state. `getView({ corpusId, viewId, revisionId? })` reads an
exact per-view revision. `saveViewDraft` creates at `expectedVersion: 0` or edits
an existing draft with both `expectedVersion` and the exact corpus `expectedHead`.
`archiveView` uses the same concurrency boundary. `getViewHistory` returns
`{ commitId, version }` entries; per-view `revisionId` is distinct from the
corpus commit ID. `publishView` requires an exact validated revision and optimistic guards. Only exact eligible published revisions enter derived View search.

Explicit definitions select source IDs and exact active revision IDs; automatic
Wiki/Projects families discover bounded eligible indexed evidence. Content
has stable typed section IDs and roles, not a generic procedure-step array.
Directed relationships have stable IDs, versioned schema/families, predicates,
typed endpoints and exact revision-aware supporting citations. Human
`supportedBy` and `dependsOn` assertions are directed from sections to source
revisions and remain explicitly unreviewed. System-owned `generatedFrom` lineage
connects the exact view revision to its immutable definition revision; selector
membership creates source-version `dependsOn` edges, not fabricated evidence
assertions. Definition revisions remain stable for content-only edits.
Saves validate endpoint existence, source
membership/current revisions and UTF-16 excerpts under the corpus write queue.
Actor attribution comes from the local service owner's OS identity, never a
request-supplied actor. Each edit records its exact base revision. Explicit builds retain the generated content and fingerprint separately from human edits for later merging.
Manual drafts have no invented generated base.

<a id="cross-source-build-views"></a>

### Full-evidence construction: troubleshooting guides and timelines

This section describes the retained full-evidence path, **not** indexed
Wiki/Projects construction. For the shared lifecycle and construction-family
distinction, see [Derived Views](../../../docs/architecture/memory/derived-views.md).

The configured constructor and independent evidence audit use strict structured
model-output schemas. Providers without schema support fail explicitly; there is
no JSON-only fallback, fabricated result or citation repair. Schema compliance
does not replace exact-character, relationship coverage or semantic/context checks.
The `evidence-first-v5` adapter extracts a typed source-only fact/context inventory
**before any view prose is generated or shown**. A second model call checks every
item and source disposition against all complete frozen inputs. Measurements retain
quantity/unit/comparison context; hypotheses and decisions retain observed/proposed/
attempted/rejected/deferred/confirmed/unknown/blocked state. Authority, prerequisites,
recovery limits, unresolved owner review, reuse warnings and occurrence/learned time
remain explicit. Every retained paragraph has an inspectable source disposition;
metadata, duplication and background/outside-scope decisions require specific
witnesses and independent checking, not blanket irrelevance.

Construction selects stable inventory identities and writes connective prose.
The host renders explicitly selected inventory statements and their typed fields
as actual section passages. This is the new construction contract, not heuristic
concatenation of raw sources or repair of an invalid legacy relationship payload.
The host derives `supportedBy` edges grouped by section and exact source revision,
with immutable source/revision/UTF-16 locator/excerpt provenance.
Assertion IDs hash the view, stable section and exact source/revision tuple.
Edit/tombstone matching remains semantic, so a revision-specific new assertion ID
cannot undo an explicit human removal.
All required inventory passages must occur in the **final merged artifact**.
Exact duplicate exclusions require a covered equal witness; outside-scope exclusions
are limited to independently checked background and are audited again.
Coverage metadata alone cannot pass the gate. Narrative edits remain editable;
removing/changing protected fact passages blocks saving rather than silently
overwriting human work. Rebuild with changed evidence to revise facts.
Source-decision witnesses cite every selected exact passage. Metadata exclusions
are limited to exact source identity/title passages, not substantive paragraphs.
Verified recovery requires both checked confirmed recovery and observed-outcome
items; incident closure alone cannot authorize recovery or project completion.

Receipts and generated/history/conflict versions retain `inventory`, `inventoryAudit`
and `coverage`, including precise final artifact locators and diagnostic-only versus
fresh-evidence-required reuse eligibility. CLI status/inspection, MCP and the Hub's
inventory inspection disclose these artifacts. Forget removes the entire dependent
job/view/conflict/history payload, including inventory and coverage.
The evidence-first target timeout is temporarily 3,000 seconds, including the
complete topic-snapshot build, for live end-to-end measurement. Informational
Wiki/project targets also default to 3,000 seconds, including admission,
generation, validation and corpus-write waits. Explicit informational elapsed
envelopes still override this default, including the reviewed rehearsal budget
of 600 seconds. Other request/input budgets and cancellation remain unchanged.
Source-to-inventory checking is model-based and can still omit/misinterpret evidence:
deterministic provenance/coverage is not deterministic semantic completeness.
A saved draft or positive audit is not a live-quality qualification.
An unresolved checkpoint may produce `diagnosticOnly` with explicit missing
evidence and cited recovery/escalation limits; it never invents a confirmed fix.

`buildViews({ corpusId, expectedHead, targets, bounds?, publication?: boolean })`
admits a durable manual job. Each target supplies `expectedVersion` and a
`definition` with a stable view ID and an explicit revision-aware source selector.
All four kinds share this request, but not the evidence construction contract.
For troubleshooting guides/timelines, admission freezes complete retained input text,
source membership, current exact revisions, content hashes, target and definition
revisions, authenticated OS actor, temporal bounds and configured pipeline/model
identity. Their fingerprint is persisted with every per-target receipt.
There is no browser-owned job store or duplicate canonical view store.

### Bounded knowledge wikis

Wiki uses `informational-wiki-v1`: bounded indexed evidence constructs readable
source-linked articles. It does not require the full-source inventory/proof
envelope described above. The old `wiki-v1` construction and explicit-subject
registry are rejected rather than migrated.

Automatic discovery admits distinct new subjects, recognizes already-covered
evidence, contributes to existing eligible articles or records ambiguity without
inventing an identity. Generated-article consolidation is separately guarded;
historically human-edited/protected pages cannot be retired automatically.
Stable IDs, citations, generated bases, explicit edits, conflicts and redirects
are retained by the owning store, not an independent Wiki service.

An explicit build uses `kind: "wiki"` with a current revision-aware selector.
Inspect actual receipts and original evidence. Publication, exact derivative
readiness and human review remain separate. Default enablement and offline
lifecycle fixtures do not establish real-model completeness or useful prose.

See [Derived Views](../../../docs/architecture/memory/derived-views.md) and
[automatic/editorial maintenance](../../../docs/architecture/memory/view-maintenance.md)
for the canonical contract. The service sections above retain operational
diagnostics, pause/unlock and recovery details.

### Evidence-linked timelines

Choose **Evidence-linked timeline** in Memory Hub, select canonical events and/or
exact document revisions, set a stable view ID, and optionally enter explicit-timezone
knowledge and occurrence bounds. The fixed reader shows record identity, type,
state/outcome, occurrence, knowledge, capture, and separate generation time.
Narrative is editable; source-owned identity/time/classification fields are read-only.
Changes to those fields need new retained evidence and a rebuild, not a human-review
override. Correction removals are explicit typed edge tombstones. Build progress,
history, conflicts, publication settings, exact publication, index retry and
published-only search use the existing view controls.

```json
{
  "corpusId": "incident-history",
  "expectedHead": null,
  "publication": false,
  "bounds": { "learnedBefore": "2026-10-05T12:00:00Z" },
  "targets": [
    {
      "expectedVersion": 0,
      "definition": {
        "viewId": "incident-timeline",
        "kind": "timeline",
        "selector": {
          "kind": "timelineEvidence",
          "sources": [
            {
              "sourceId": "investigation-log",
              "revisionId": "exact-current-revision"
            }
          ],
          "events": [{ "eventId": "canonical-event-id" }]
        }
      }
    }
  ]
}
```

Use the actual corpus/head/revision/event IDs, not the illustrative values above.
From the service package:

```powershell
node dist\memoryViewsCli.js --store C:\Temp\memory-views events <corpusId>
node dist\memoryViewsCli.js --store C:\Temp\memory-views events <corpusId> <nextContinuationToken>
node dist\memoryViewsCli.js --store C:\Temp\memory-views event <corpusId> <eventId>
node dist\memoryViewsCli.js --store C:\Temp\memory-views build timeline-request.json
node dist\memoryViewsCli.js --store C:\Temp\memory-views read <corpusId> incident-timeline
```

The `events` command returns up to 200 records per page. Pass its
`nextContinuationToken` as the optional last argument to discover subsequent
records; repeat until the response has no continuation token.
Forgetting multiple events aborts affected builds per event but performs one
managed view-history purge and affected View-index cleanup for the batch. The
persisted batch selection is also used for interrupted-purge recovery.

The same `buildViews` request is supported by in-process/RPC clients,
`memory_views_build` over MCP, host IPC and authenticated browser transports.
Existing document-only `sources` selectors and citations remain unchanged.
Canonical citations carry `evidence: { kind: "event", eventId }`, with a frozen
record hash as revision and exact UTF-16 offsets into `JSON.stringify(event)`.
Evidence controls open that exact event, not a synthetic missing document.
For document citations, offsets always refer to the original unchanged revision.

`TimelineContent` has `kind: "timeline"`, `generatedAt`, and stable structured
event sections (`role: "event"`). Each section's `details` contains
`identity` (`canonicalEvent/eventId` or `documentRecord/sourceId/sourceRecordId`),
`eventType`, source-grounded `state`, `outcome`, nullable `occurredAt`,
`learnedAt`, `capturedAt`, and checked `inventoryIds`. Canonical record IDs and
`eventTime`, `observedAt`, `createdAt` are copied from the canonical event and
normalized to UTC; the existing append-event defaults are unchanged.
Document-record section IDs are explicitly host-derived from source ID and
record ID, never presented as canonical events.

Supported document/log input uses explicit Markdown record boundaries:

```markdown
## Record configuration-change

Classification: observation
State: confirmed
Occurred at: 2026-10-05T08:45:00Z
Recorded / known at: 2026-10-06T08:05:00Z
Outcome: configuration observed

Retained evidence narrative and measurements.
```

Missing occurrence or knowledge fields stay `null`; capture/modified times never
replace them. Unsupported/no-timezone/invalid dates and duplicate IDs fail
explicitly. A bounded checkpoint excludes unknown required record times.
Unstructured sources without grounded record boundaries fail with an unsupported
projection explanation rather than unsafe full-file inclusion.
`learnedBefore`, `occurredFrom`, and `occurredTo` are inclusive host-enforced record
bounds. Only eligible passages reach inventory, independent source checking,
construction and final audit; excluded future facts are not treated as background.
The snapshot fingerprints exact source revisions, canonical records, membership
and bounds, and rechecks them before materialization/publication. Empty eligible
checkpoints report `skipped` and create no artifact or new publication.

`corrects` and `supersedes` edges connect distinct existing event sections.
Document evidence must explicitly declare `Corrects: <record-id>` or
`Supersedes: <record-id>`; canonical evidence uses `metadata.corrects` or
`metadata.supersedes` with its canonical target ID. Targets must belong to the
same evidence identity kind, remain eligible, and have non-reversed knowledge
ordering. Bare document record references resolve only within their own source;
fenced examples are neither record boundaries nor metadata fields.
The original hypothesis/action remains a separate record; correction
never silently rewrites its history. Independent support audits and actual
artifact coverage still apply, including human-edited final records. Positive
audits cannot bypass incompatible provenance, structured timestamps or state.

Canonical event forget purges dependent views, jobs, conflict bases, receipts,
managed Git history and indexes even with `forgetLinkedSources: false`.
Document replacement/forget, archive, clear and restart retain their existing
guards; unrelated views/events/sources are preserved. Cleanup remains quarantined
until managed derived-data removal completes. External backups and secure media
erasure remain outside the service's guarantees.

This is a default-enabled, offline-tested capability, not release qualification.
No event execution, skill activation or dynamic future-event scope is added.
Automatic informational scheduling is separate from this selected timeline path.
Historical evidence-first provider trials remain live-unqualified; source inventories
and independent semantic audits are model-based and may still omit or misinterpret
evidence. Passing structured offline stubs does not establish live quality.

### Project briefs

Projects use `informational-project-summary-v1` with bounded indexed evidence.
`ProjectBriefContent` remains `kind: "projectBrief"` with the fixed seven-section
reader, exact citations and editable narrative. It is not the former
full-source-inventory project recipe and does not imply that incident closure
proves project completion, capacity validation or an owner commitment.

Automatic Projects maintenance discovers and attributes project evidence within
the corpus. Explicit builds use the shared `buildViews` request with
`kind: "projectBrief"` and exact active source revisions. Use current IDs/head
from `sources` and `list`; do not copy fictional IDs into a live store.
Inspect scope, unknowns and citations, then use the same edit/history/publication/
index controls as other Views. There is no execution or skill activation.

The CLI, facade, RPC, MCP and browser transports share typed service requests.
`searchViews` accepts `kinds: ["projectBrief"]`; only exact eligible published
and indexed revisions are searchable. The service is default-on unless
explicitly disabled; disabling preserves stored content/history.

See [Derived Views](../../../docs/architecture/memory/derived-views.md) for the
construction contract and [the status ledger](../../../docs/plans/memory-system/STATUS.md)
for dated evidence and outstanding qualification. Older evidence-first provider
trials do not qualify or disqualify every current indexed builder.

### Source-level build bounds

These complete-input checks belong to the retained troubleshooting/timeline
path; they are not a Wiki/Projects inventory requirement.

Bounds are `learnedBefore`, `occurredFrom` and `occurredTo`, all ISO timestamps.
Learned time uses source `capturedAt`; occurrence bounds use `sourceModifiedAt`.
A source outside a bound, or lacking its required timestamp, is rejected, not
silently truncated. Record-level occurrence/knowledge distinctions remain in
the complete labeled source text. A later replacement cannot masquerade as an
earlier available revision. Select only the early documents for an early
checkpoint; do not import review gold or authoring expectations as memory.

The configured synthesis adapter follows the established runbook model path.
It receives complete inputs and exact paragraph locators, constructs a
conditional guide with goal/applicability, prerequisites, diagnostic trajectory,
guards, verification, recovery/escalation and reuse context, and distinguishes
diagnostic-only from verified recovery. Structural and exact UTF-16 citation
validation is followed by a separate model-based semantic/context audit covering
every section and relationship. Matching offsets alone cannot pass that audit.
Merged or explicitly resolved prose is audited again. This audit is not a
formal proof or live-quality qualification; controlled offline responses test
the protocol and lifecycle separately from configured-model quality.

Model generation runs outside corpus writes. Before materialization, the service
rechecks source/access/target/definition fingerprints under its write queue.
Concurrent saves, replaced/forgotten evidence, cancellation and archived targets
cannot overwrite the current draft. Receipts expose `draft`, `merged`,
`conflicted`, `blocked`, `stale`, `failed`, `cancelled` and `interrupted` per target;
partial batches are not all-success. The saved draft and result revision enter
the same history commit. A restart reconciles pending/running targets as
interrupted, without undoing already materialized targets or pretending success.

`getViewBuild({ corpusId, jobId })`, `listViewBuilds(corpusId)`,
`cancelViewBuild` and `retryViewBuild` inspect/control jobs. Exact repeated
admissions return the original durable receipt; an explicit retry uses current
head/target guards and retries only unsuccessful targets. Changed source
selectors require a new build. Cancellation stops future materialization even
if a provider is still unwinding its request; already saved drafts remain.
Limits are 32 targets, 32 exact sources per target, 120000 complete input
characters and a 3,000-second per-target inventory/construction/validation deadline; there is
no silent truncation or heuristic generation fallback.

### Explicit edits and conflicts

Saving a draft captures stable edit IDs, stable section/semantic-edge targets,
OS actor/time, exact generated base identity/fingerprint, old values/hashes,
new values or deletion, and persistent status. Review alone is not an edit.
Unknown/baseless human content is never classified as unedited. Generated,
unedited content can be replaced without fabricated human-review stamps.

Pinned `node-diff3` merges exact old generated base/current human/new candidate
line arrays, retaining CRLF, whitespace and fenced code. Independent changes
and paragraph append merge; identical changes converge; overlap,
deletion/modification and ambiguous insertion positions conflict. The bound is
120000 characters and 4000 lines per prose field. No LLM chooses a merge winner.
Relationships merge separately by predicate and semantic endpoint identity,
not rendered JSON: human additions retain human provenance and removals persist
as tombstones even if the generator re-identifies edge IDs. Retained edits are
rebased to the new generated base without losing their original attribution.

A `viewMergeConflict` event records metadata-only evidence/edit references and
a deduplicated identity. Its authorized comparison retains exact base/human/new
content in the same private history. Current content stays untouched.
`getViewConflict({ corpusId, conflictId })` inspects it.
`resolveViewConflict` requires the expected current revision/version, history
head, input fingerprint and explicit `human`, `generated` or `combined` choice.
Combined supplies a complete `ViewSynthesisOutput`; every choice is evidence-
and context-validated before saving. Resolution and overlays are durable and
later builds preserve retained edits. Unchanged resolved edits keep their IDs,
actors and original timestamps; newly selected or changed values receive explicit
resolver-attributed operations, while superseded operations remain cleared.
Untracked section or relationship changes cannot hide behind another tracked edit.
Forgotten sources purge dependent builds,
conflicts, edit payloads, generations and history objects, not just visible refs.
Build receipts retain their original outcomes after resolution. The Hub identifies
the separate saved draft revision and keeps resolved or superseded-target conflict
comparisons read-only rather than offering an invalid repeat resolution.

### Publication policy and revision-matched search

Pending merge conflicts block publication, index retry, default derived search
and the exact derived-evidence reader without erasing the previous durable
publication/index pointers. Resolve and validate the conflict first.
Archive receipts identify the archive history entry; read `listViews` for the
current concurrency head after durable index cleanup.

Views and corpus auto-publish default **on** unless explicitly disabled.
Default enablement is not live-quality qualification.
`getViewPublicationPolicy(corpusId)` returns
`{ revision, autoPublish, views: { [viewId]: { revision, autoPublish } } }`.
`updateViewPublicationPolicy` accepts corpus ID, expected history head,
expected policy revision, optional view ID and `autoPublish`. A view's `null`
means Inherit; corpus settings cannot inherit. The service assigns the actor.
Resolution is build boolean override > saved view boolean override > corpus
boolean. False is never inheritance. Overrides appear with their origin and
configuration revisions in frozen build snapshots and receipts. Changing policy
during synthesis rejects the old snapshot. A one-build override does not mutate
saved policy. Turning off does not unpublish an existing version.

For troubleshooting/timeline artifacts, publication requires the exact final
artifact's source-first inventory, independent source check, coverage and
semantic support audit. Informational Wiki/Projects use their indexed-evidence
validation path rather than that full-source proof envelope.
These checks are not human-review stamps. A
manual unsourced draft cannot acquire publication authority by saving or
reviewing. Build from the selected retained revisions first, then use **Save
explicit edits** to independently validate supported narrative changes and
**Publish exact revision** when auto-publish is off. Missing facts, unsupported
claims, unknown generated bases, conflicts and stale/forgotten sources block
publication with actionable reasons. No source, skill or resource is changed.

`getViewPublication({ corpusId, viewId })` returns distinct latest built,
published and indexed revision IDs, durable publication intent, index state and
reason. The single history-ref commit publishes the intent and revision before
any index side effect. Index failure returns Published with failed indexing;
pending/failed is never searchable. `retryViewIndex` requires exact published
revision, current target version and history head, and indexes that revision
without another synthesis or publication. Restart preserves pending work for
explicit retry, including an interruption after the index files were written.

`searchViews({ corpusId, query, freshness: "current", limit? })` uses the existing
corpus-index abstraction and KnowPro's structured/embedding-backed path. Only an
eligible published revision with the same indexed revision and exact readiness
marker is returned. Current-source freshness is mandatory; retained stale views
are inspectable in history, not substituted into default retrieval. Results expose
kind, version, generated/human-merged provenance, unreviewed state, freshness and
original citations. Named corpus and All memory searches include derived results
and preserve per-corpus failures. Derived results are not independent corroboration:
answer synthesis uses original/source evidence rather than counting a guide again.
The evidence reader opens the exact published version and original retained
source revisions, never a newer label over old indexed text.

Archived indexes have durable cleanup work retried on reopen. Source forget
rotates history and removes affected view index directories before the privacy
quarantine clears; unrelated views/indexes and ordinary runbook semantics remain
intact. Corpus clear removes the service-owned view history and indexes. Local
deletion is not secure erasure of SSD blocks, external backups or exported copies;
those require the deployment owner's separate retention/erasure policy.

CLI commands include `policy`, `set-policy request.json`,
`publication <corpusId> <viewId>`, `publish request.json`,
`retry-index request.json` and `search <corpusId> <query>`. The Hub exposes corpus
settings, view Inherit/On/Off and one-build Inherit/On/Off controls, effective
policy, per-target progress, Publish and Retry index.

Historical evidence-first provider trials failed inventory witness coverage
before prose or saving. Publication does not weaken the retained builder's
gates or turn human review into a validation override. Those trials do not
evaluate the newer indexed Wiki/Projects path. Offline configured-adapter/
embedding tests demonstrate runtime contracts, not live distillation quality.

### Real consuming surfaces

The agent server and standalone memory MCP owner enable Views when
`TYPEAGENT_MEMORY_VIEW_DRAFTS` is unset or `true`; only explicit `false` disables
them, and invalid values fail. Model/provider failures remain explicit build
errors; default enablement never bypasses evidence, publication or review gates.
Use a fresh task-owned profile/store and alternate port.
Building this worktree does not alter an already running server.
The Memory Hub Views page exposes derived Views when
capabilities advertise builds. Choose a named corpus, select exact current
evidence, choose a stable view ID, then **Build views**. Inspect durable
progress/receipts, edit stable structured sections and typed relationships,
inspect history, or open the three-input conflict comparison and resolve
explicitly. Polling does not replace an active editor.

Browser host validation, agent-side handlers, extension forwarding, RPC facade,
in-process client and real MCP tools route to the owning memory service.
The MCP surface includes `memory_views_build`, `memory_view_build_get`,
`memory_view_builds_list`, cancellation/retry, draft CRUD/history and conflict
inspection/resolution, publication policy, exact publication, index retry and derived search.

The compiled CLI loads existing configured models (never fetches keys) and uses
the same service methods:

```powershell
node dist\memoryViewsCli.js --store C:\Temp\memory-views build build-request.json
node dist\memoryViewsCli.js --store C:\Temp\memory-views builds <corpusId>
node dist\memoryViewsCli.js --store C:\Temp\memory-views status <corpusId> <jobId>
node dist\memoryViewsCli.js --store C:\Temp\memory-views inspect <corpusId> <conflictId>
node dist\memoryViewsCli.js --store C:\Temp\memory-views resolve resolution-request.json
```

`build` and `retry` wait for the terminal receipt before releasing their private
store. `cancel` and `retry` also take `<corpusId> <jobId>`. Do not point this
exclusive CLI owner at a running server's store. Use MCP/Hub to control live
jobs in the actual owning service.

<a id="manual-view-maintenance"></a>

### Automatic and explicit view maintenance

Automatic Wiki/Projects and Topics families react to committed index changes.
Active durable import batches defer synthesis; settlement and reconciliation
resume eligible work. Family pause is durable; unchanged, blocked, failed and
parked outcomes are distinct from successful refresh.

Explicit definitions can pin inputs, advance a fixed set of source IDs or
enumerate bounded source-type/tag/project scope. `planViewMaintenance` previews
affected, unchanged, pinned and blocked targets; `maintainViews` uses the owning
family's construction path. Accepted manifests share the artifact history
boundary. The former explicit-subject Wiki registry is not a current contract.

`updateViewMaintenance` applies explicit head/version-guarded intent.
`getViewMaintenance` reads durable receipts and current build outcomes. The CLI
adds `set-maintenance`, `plan-maintenance`, `maintain` and `maintenance-status`;
MCP exposes `memory_view_maintenance_update`, `memory_views_maintenance_plan`,
`memory_views_maintain` and `memory_view_maintenance_get`. The Hub exposes
configuration, preview, manual run and dependency inspection when the service
advertises maintenance support.

No-op detection uses logical evidence/rule/model fingerprints, not index time.
Acceptance rechecks dynamic membership as well as exact revisions and human edits.
Empty scope, pending ingestion, incompatible edits and unsupported bounds block
visibly. Generated-article contribution/consolidation uses current guarded
admission and recovery; it does not merge protected or historically human-edited
articles. Forgetting purges dependent manifests, receipts, conflict/pending
snapshots and local indexes before reads reopen. Physical indexes are not Git
history content.

See [the maintenance contract and qualification recipe](../../../docs/architecture/memory/view-maintenance.md)
for schemas, automatic-family behavior, compatibility and qualification limits.
Configured-model quality remains separately gated.

`TypedViewStore` persists artifact state under each corpus's `views` directory.
The authoritative snapshot is `state.json` in the private bare
`views/view-history.git` tree referenced by `refs/heads/typeagent-history`.
Per-view tree entries use `view-<encoded-id>.json`; builds, generated bases,
conflicts, publication/maintenance state, family state and Topics share the
snapshot. Per-revision indexes remain outside Git under
`views/view-search-index/<view-id-hash>/<revision-id-hash>`.

Source replacement marks dependent drafts stale without modifying historical revisions. Forget/clear quarantines history, creates a sanitized baseline, replaces the entire old Git object database (including unreachable blobs), and removes affected View search indexes before reopening reads. Interrupted privacy cleanup rejects reads until restart recovery finishes. No procedure state, settings or index is persisted or migrated by this service.

Git commits also retain full-fidelity per-View version records. History queries
decode only the selected View's distinct records, preserving history order,
revision filtering, editorial metadata and head guards. Legacy derived records
rebuild under the history lock; Git commit traversal remains linear. Privacy
replacement of the history repository removes these records and unreachable
blobs together, rather than leaving a second history outside the purge boundary.

### Explicit schema-defined question Views

`schemaView` is a persisted, versioned View kind with restricted data-only answer
schemas and explicit question slots. Slots support singleton, record and keyed
collection answers; candidate values retain exact source citations and separate
review, freshness, coverage and answer states. Versioned rubrics select by most
recent evidence, independent support or manual review. An authenticated user can
confirm/reject candidates, assert a typed answer, edit a contract or approve/reject
a proposed question without rewriting retained evidence.

`proposeSchemaView` creates unapproved contracts from an explicitly supplied
specification and maintenance scope. `discoverSchemaQuestions` is an explicit,
per-View call with opt-in cumulative bounds; enabling discovery does not run it.
Ordinary ingestion maintains approved question answers within their configured
source scope, but does not discover questions across the corpus. Evidence audits
cover every source-origin candidate, including unselected candidates. One bounded
repair can correct evidence and chronology bindings before independent revalidation.
Timezone-free reports are comparable only within the same evidence-supported local
chronology; ingestion time never establishes fact time.

`listQuestions` returns full details; `listQuestionSummaries` provides bounded,
filtered summary pages and `getQuestion` loads one complete question.
`getViewPage` resolves deterministic Markdown and exact revision/slot/item
`memory-view:` links without inference. These methods are available through typed
in-process, browser RPC and MCP clients. Source removal and corpus clearing purge
question evidence and history through the existing privacy lifecycle.

### Deferred evidence acquisition

Hosts can authorize deduplicated, consumer-tracked evidence requests for approved
question slots. Tools remain disabled by default. Authorization binds the
principal, policy, tool, resource and exact outbound arguments; question text or a
model proposal cannot grant authority. Requests inspect current answers before
fetching and deliver fetched material through ordinary source ingestion, retaining
ingestion receipts and reconciling overlapping question consumers. Cancellation,
stale consumers, conflicts, indexing failures and privacy suppression remain
explicit states, not successful empty answers.

The Questions page exposes sanitized progress and explicit run-once/cancel controls
for existing requests. Browser and MCP progress omit outbound arguments, staged
content and raw errors. They cannot admit requests, enable periodic acquisition
or authorize tools; those operations belong to an explicitly configured host.

### Runnable local CLI

Build from `ts` with `pnpm exec fluid-build packages\memory\service -t build`
(the root `build` script also passes `.`, which can build unrelated packages).
From `ts\packages\memory\service`:

```powershell
node dist\memoryViewsCli.js --store C:\Temp\memory-views create-corpus "Draft views"
node dist\memoryViewsCli.js --store C:\Temp\memory-views corpora
node dist\memoryViewsCli.js --store C:\Temp\memory-views list <corpusId>
node dist\memoryViewsCli.js --store C:\Temp\memory-views save draft-request.json
node dist\memoryViewsCli.js --store C:\Temp\memory-views history <corpusId> pressure-guide
```

Use the returned corpus ID and `list.head` in the following request (a new
empty corpus has `head: null`). An imported source can be selected via the
`sources` and `source` commands; citations must refer to the exact returned
revision and source character ranges. A manual unsourced draft is also valid:

```json
{
  "corpusId": "<returned corpusId>",
  "viewId": "pressure-guide",
  "expectedVersion": 0,
  "expectedHead": "<head returned by list>",
  "definition": {
    "viewId": "pressure-guide",
    "kind": "troubleshootingGuide",
    "selector": { "kind": "sources", "sources": [] }
  },
  "content": {
    "kind": "troubleshootingGuide",
    "title": "Pressure diagnosis",
    "sections": [
      {
        "id": "inspect",
        "role": "diagnostic",
        "heading": "Inspect pressure",
        "body": "Correlate pressure with affected requests before choosing a mitigation."
      }
    ],
    "citations": []
  },
  "relationships": []
}
```

Change `body`/typed relationships, use `expectedVersion: 1` and the returned
`commitId` as `expectedHead`, then `save` again. Each CLI invocation closes its
service: the next `read` or `history` invocation demonstrates restart consistency.
Archive with `archive request.json` containing corpus/view IDs, expected version
and expected head. `publish request.json` requires corpus/view/revision IDs,
expected version and expected head; unsourced manual drafts are not publishable.
The store must not be owned by a running server; the service storage lock enforces
this. The CLI never resets data. CLI, service/RPC, MCP and browser consumers use
the same default-enabled derived-view capability.
The existing browser Runbook deep links remain intact: Guide is the primary
human-readable document, its editor explicitly leaves original sources unchanged,
and Agent edition is an optional executable adaptation, not a peer source.

## Shared instruction-document helpers

Canonical instruction-document Markdown, AgentEdition validation/redaction, source citations, and exact reviewed artifact helpers remain available for independent artifact consumers. These helpers do not provide saved-procedure storage, CRUD, detection, synthesis jobs, publication, or execution. Derived Views remain unreviewed and cannot acquire execution permission through build or publication.

There is no View-to-skill or View-to-macro promotion contract. The retired host
export path required a saved procedure and its exact reviewed AgentEdition;
derived Views do not satisfy that authority boundary. Independent skill catalog
and binding capabilities remain available, but exporting a View would require a
separate explicit review and artifact-authority design.

Revision assets and batch acquisition remain host/in-process capabilities; unsupported operations fail explicitly. Binary upload and bounded transport remain host responsibilities.

## Changes receipts

Optional `MemoryService.listChanges(MemoryChangeListRequest)` returns
`MemoryPage<MemoryChangeReceipt>`. File storage supports this method; facades,
in-process clients, and MCP clients report an explicit unsupported error when
their underlying service does not.

Receipts are committed in the same atomic manifest write as replacement,
source forgetting, and knowledge suppression/restoration. They contain only
`changeId`, `corpusId`, `operation` (`replace`, `forget`, `suppress`, `restore`),
`createdAt`, `outcome: "committed"`, optional opaque `sourceId`,
`previousRevisionId` and `revisionId`, and safe numeric
`counts: { sources, revisions, knowledge }`. Reference IDs are corpus-scoped
SHA-256 digests with a receipt-specific domain, not caller-supplied source
names or raw revision IDs. Receipts never include content, titles, URLs,
knowledge names, arbitrary metadata, confirmation tokens, or errors.
`revisions` counts newly committed replacement revisions or forgotten
revisions; `knowledge` counts changed suppression entries, not derived facts.
Forget receipts omit revision references and purge earlier receipts for the
forgotten source before publication. Clearing a corpus removes all receipts.

Receipts are retained for **90 days**, pruned on startup, serialized mutations,
and listing. Old manifests without receipts remain readable. Mutations that
fail, are cancelled, or become stale before canonical commit emit no receipt.
Once committed, a receipt remains even if subsequent derived cleanup or job
completion fails. Unchanged-content replacements,
duplicate suppressions, and restoring an unsuppressed entry are successful
no-ops that emit no receipt.

Listing accepts `corpusId`, optional `pageSize` (integer 1-200, default 50),
and `continuationToken`. Pages preserve manifest commit order and the initial
snapshot even when later changes append. Tokens bind the corpus, page size,
and snapshot; omitting page size on continuation preserves it. Pruning,
forgetting, or clearing that changes the snapshot expires its tokens explicitly,
requiring a fresh listing. Tokens are pagination cursors, not authorization.

## Markdown Sources

PDF producers submit ordinary `markdown` sources with source identity, title,
canonical URI, tags, and producer metadata. The service uses its normal Markdown
importer and retains the exact submitted content and content-addressed revision
ID. Search excerpts and answer citations identify the source and revision; they
do not project PDF pages, blocks, bounding boxes, or canonical character ranges.
Producer provenance belongs in source metadata rather than embedded Markdown
that needs special stripping. PDF extraction and viewer navigation remain
producer responsibilities.

Retired `locationMap` fields in saved revisions are tolerated as opaque legacy
data and retained when manifests are saved or indexes are rebuilt. They are not
validated, used for chunking, or returned in source responses. Client schemas
ignore retired optional request/response fields. New imports do not store maps.

The former mapped-chunk index used the same `index-schema.json` version as
ordinary document indexes, so its `document-projection.json` marker triggers a
document-only derived-index reset on the next search or ingestion. Marker
presence is sufficient, including a malformed obsolete marker. The replacement
generation is rebuilt from retained content with normal ingestion and has no
projection marker. Raw revisions, histories, metadata and event ledgers
are not rewritten by this reset. The existing checks for
malformed, incompatible, or future `index-schema.json` descriptors still fail
explicitly before reset. Event and View indexes ignore the retired document
marker.

Phase 0 management APIs provide corpus status and revision/job counts,
deterministically paged source and job listings, bounded revision content reads,
source-scoped derived knowledge, optimistic source replacement, and atomic
source/corpus reindexing. Source deletion is a two-step operation: callers first
request a preview and short-lived confirmation token, then confirm deletion.
Confirmation survives a service restart, and activation rebuilds the complete
corpus index before removing superseded index generations.

Ingestion accepts only `content` mode and uses the structured KnowPro index
for all document search and knowledge extraction. Revisions retain their
pipeline settings and raw content; historical revisions with an older mode
are replayed as content when their derived index is rebuilt. Source listings
and lookups report their pipeline mode as `content` without rewriting retained
legacy revision metadata, so those records remain valid against the current
service protocol. Nonterminal jobs found after a service restart are marked
failed with an explicit interruption reason so they are never left permanently
active. The separate website-memory HTML/content-capture extraction modes are
not part of this service ingestion pipeline.

Each derived document, conversation-event, and View index generation
records `index-schema.json` with schema version 1, engine `knowpro`, and its
index kind. The descriptor is written after the semantic index persists and
before publication. Missing or older descriptors, and current generations
whose required semantic data is missing, trigger a scoped reset and rebuild
from retained source revisions, events, or exact published View revisions. Malformed or
unreadable descriptors and future versions fail explicitly rather than
deleting an index the service cannot interpret. Canonical raw content,
histories, event ledgers, and forget tombstones are not migrated or removed
by a derived-index reset. Extraction failures remain errors and can be
retried against those canonical records. Persisted generation pointers must
name a generated index directory; malformed or out-of-root pointers fail
before any automatic reset.

`getCapabilities()` reports `management: true` and `groundedAnswer: true`.
`MemorySearchRequest.dateFrom` and `dateTo` are optional ISO timestamps
with a timezone. Search validates calendar dates and ordered ranges, and
filters active revision `capturedAt` inclusively before applying the result
limit and response-character budget. Sources have no canonical creation
timestamp, so missing or unparseable capture dates are excluded when either
date predicate is present; `indexedAt` is never used as a fallback.
Date predicates operate on the existing bounded ranked index candidates
(at most four times the requested limit, itself capped at 100), not a fully
date-scoped index search. Date-filtered responses always warn that additional
matching evidence may be omitted and do not report complete totals. The MCP
search schema and typed clients preserve both predicates.

`answer` generates its answer with KnowPro's answer generator over the
retrieved evidence and returns bounded, source-linked citations with
`mode: "synthesized"`. `answerMode: "extractive"` returns the ranked evidence
snippets verbatim (`mode: "extractive"`). When `answerMode` is omitted,
synthesis is used if the corpus index supports it. Answer generation uses the
chat model from the index settings and fails with an error rather than falling
back silently. `sourceIds` scopes a synthesized answer to messages from those
sources.

The service also provides a shared episode/event substrate for conversation,
web-activity, and procedural producers. Events are appended to an authoritative
per-corpus log without requiring models and are deduplicated by producer and
idempotency key, including after restart. Typed provenance includes source
kind, producer, event type, conversation/run/turn, sender, action, observed
time, and event time. Events can link to durable document sources without
copying source content. `searchEvents` lazily reconciles a separate per-corpus
KnowPro content index of event projections with the log, including after
restart. It uses structured knowledge and message search rather than lexical
event scoring; a missing index is rebuilt and a compatible index appends only
new events. Model/indexing failures are reported instead of silently falling
back. An append failure preserves the previous publication for a later retry,
but does not serve it as a successful up-to-date result. Eligibility changes
physically purge old generations before subsequent search. Ledger-backed event
ID tags restrict all requested provenance and date filters before KnowPro
ranks and limits results. `authorities` filters by the producer-supplied
`metadata.authority` label before ranking, and that label is also indexed as
an immutable `event-authority:` tag. Events without a label do not match an
explicit authority filter. Supported labels are `user-assertion`,
`evidence-only`, `verified-observation`, `explicit`, and `producer-reported`;
unsupported labels are rejected. A failed action result retains its
`verified-observation` provenance alongside `metadata.outcome: "failed"`:
authority does not assert success. `eventIndexFactory` can
inject a deterministic
`CorpusIndexFactory` for offline tests; by default it uses the corpus
KnowPro factory. Events can be
listed or forgotten independently of documents. Forgetting purges event index
generations before a later search can access them; linked sources are deleted
only when explicitly requested and when no retained event still links to them.
Forgetting also commits suppression tombstones to the event ledger: each
deleted producer/idempotency key and turn is suppressed, while a
`conversationIds` forget without `eventIds` or `turnIds` suppresses the whole
conversation (optionally scoped by `sourceKinds`). Supplying `eventIds` with
`conversationIds` instead narrows deletion to those events and does not mark
the whole conversation forgotten. `turnIds` can
explicitly suppress a turn (optionally scoped by `conversationIds` and
`sourceKinds` and `authorities`) even when no event is present yet. A suppressed append throws
`ForgottenEventError`
(`code: "EVENT_FORGOTTEN"`) instead of returning a replay or a fabricated
event. Tombstones survive restart and are excluded from listing and indexing.
Clearing a corpus retains tombstones and suppresses its previously indexed
conversations so retained upstream transcripts cannot backfill them.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.

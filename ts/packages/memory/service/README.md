# @typeagent/memory-service

Transport-independent durable memory corpus service.

## Indexed reads and search diagnostics

Document and procedure indexes are reused in memory while their published
generation and persisted-file fingerprint remain unchanged. Fingerprints check
schema, semantic-data, embedding-file and projection/readiness-marker metadata;
schema validation and recovery still run when these change. A restart loads
the published generation again. This does not cache queries or model responses.

Prepared document/procedure searches, source knowledge, corpus knowledge and
document answering can share a per-corpus read reservation. Preparation and
mutations remain exclusive: ingestion, reindexing, forgetting and procedure
updates wait for existing readers, and later readers wait behind a queued
writer. Each async read retains its snapshot until completion. Cold runtime
loading is single-flight, and shutdown drains the complete preparation/read
lifetime before releasing storage.

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

## Revision assets, acquired batches, and post-commit runbook jobs

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
Already-committed post-commit synthesis jobs are separate Activity work; batch
cancellation does not pretend to stop them.
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

Runbook synthesis is opt-in: how-to `enabled` and `detectCandidates`, plus
`preferences.runbook.buildAgentEdition === true`. The other exact runbook keys
are `describeImages`, `mcpTools`, `approvedAutomations`; optional
`preferences.extractionGuidance` is supplied to synthesis. Deterministic candidate
detection remains a separate seed, not a substitute for configured full-document
synthesis. It now selects task/Guide boundaries, ignores fenced headings and
ordinary command/continuation prose, and retains multiline actions, prerequisites,
guards, verification and recovery. Citations use exact end-exclusive UTF-16
`chars:START-END` offsets and the original source excerpt, including CRLF.
HTML is eligible for synthesis, not the Markdown detector. The five copied
synthetic memoryDemo import guides under `test/data/guides` are offline detector
fixtures only; reviewer/gold answers are not synthesis input.
`listRunbookJobs(corpusId)` (latest 100) and `getRunbookJob(jobId)` expose
separate durable post-commit classification/result jobs for Activity/Inbox:
state, reason/confidence/classification, candidate IDs, warnings and timestamps.
Model failure never rolls back captured knowledge and does not silently
fall back to a claimed synthesized edition.
Job reasons expose queued, synthesizing, and publishing stages. Job reads,
writes, and removal are serialized per job to avoid Windows reader/rename
contention; transient Windows rename retries are bounded to two seconds.
If a background result cannot be persisted, job reads explicitly reject instead
of returning a permanently running success-shaped snapshot.
`requestRunbookSynthesis({ corpusId, sourceId, revisionId })` explicitly requests
the same pipeline for an already-captured ready active revision, using retained
original content/assets and current corpus preferences/guidance. Missing,
historical, or nonready revisions and disabled preferences reject explicitly.
The result is a durable `RunbookJobResult`; poll its existing job ID for model
failure/completion. Pending/completed work is reused with its actual candidate
IDs, not claimed as a new overwritten draft. Failed/interrupted work can retry.
Existing candidate IDs, human edits, and saved procedures are never overwritten.
After source comparison, select the active revision to propose its own draft.

`FileMemoryServiceOptions.runbookSynthesizer` is a typed injectable
`RunbookSynthesizer` for offline fixtures. Otherwise a configured aiclient model
is constructed lazily using optional `runbookModelEndpoint`; no model is touched
unless synthesis is enabled. Set `runbookMultimodal: true` only when the
configured endpoint supports image input and that capability is approved.
Without it, unsupported instruction-bearing images make steps explicitly
manual. No remote images are fetched. Full documents are limited to
**120,000 UTF-16 characters**, not silently truncated; one model request runs
globally with **32 queued jobs / 120-second request deadline**.
Synthesis outputs are bounded to 1 MiB, with at most 20 warnings of 1,000
characters and a 2,000-character classification reason. Failure diagnostics are
bounded with an explicit truncation notice; source evidence is never truncated.

Synthesis supports multiple section-lineaged candidates, prose/tables,
preconditions, branches, alternatives and retained links. Source/revision/section
fingerprints make drafts idempotent. UTF-16 `chars:START-END` citations must
exactly match retained excerpts; invalid locators are never guessed from snippets.
Unknown asset references are discarded and unsupported steps become manual.
Semantic derivation is flagged for source-support review; substring validation
is not a claim of semantic entailment. Link resolution considers at most 100
retained source identities, requiring the linked URI in the original document.
Secret command/example redaction uses canonical pure validators. All imported
editions are draft, binding proposals are never accepted, and nothing executes.
Pass `runbookBindingValidator` for explicit later catalog-backed human review.
`FileMemoryService.saveProcedure` additionally resolves review evidence while
holding the corpus write queue: cited revisions must be retained and current,
excerpt offsets must match retained/redacted text, human text must be faithful,
and referenced asset bytes must pass their stored digest. Historical or missing
evidence and guessed locations cannot be reviewed as current runbooks.
Replacement rejects obsolete-source candidates with agent editions, including
linked-source and asset dependencies. Forget removes affected candidates and
all affected view/procedure versions from the shared store and physically
replaces its Git object database; see the draft pilot privacy boundary below.
Golden-set quality, live vision parity, safe redacted pixel previews and full
Phase 4 qualification remain separate work.

## Canonical agent editions and version review

`ProcedureDocument.agentEdition?: AgentEdition` is optional, schema version 1.
Old human how-tos and unknown `additionalSections` remain unchanged. The
canonical Markdown appends an `Agent Edition` JSON fence with a
`typeagent-agent-edition:1` HTML-comment marker (legacy sections with the same
heading remain human sections unless marked); use
`procedureToMarkdown` / `procedureFromMarkdown` for lossless edition round trips.
The human `steps` and edition `humanText` remain separate from derived
`agentInstruction`. Saving never re-synthesizes or overwrites human edits.
Procedure versions now use the same typed view/history persistence as draft
Guides. Procedure JSON/Markdown and hashes are deterministic compatibility
projections, not independent canonical versions. Index preparation precedes the
atomic history-ref commit; failed preparations do not save a procedure version.

## Developer draft Views pilot (W1-W4)

`new FileMemoryService(privateStore, { viewDrafts: true })` enables the local
developer/demo capability. It is **off by default**. `getCapabilities()` then
advertises `derivedViews: { kinds: ["troubleshootingGuide"], drafts: true,
history: true, builds: true, editMerging: true, publication: false }`. Only
`troubleshootingGuide` drafts are supported. Wiki, projectBrief, timeline,
automatic scheduling, publication and derived search remain unsupported; they
are never silently substituted with procedures.

`listViews(corpusId)` returns `{ head, views }`, including pending drafts and
explicit lifecycle state. `getView({ corpusId, viewId, revisionId? })` reads an
exact per-view revision. `saveViewDraft` creates at `expectedVersion: 0` or edits
an existing draft with both `expectedVersion` and the exact corpus `expectedHead`.
`archiveView` uses the same concurrency boundary. `getViewHistory` returns
`{ commitId, version }` entries; per-view `revisionId` is distinct from the
corpus commit ID. `publishView` explicitly rejects the request. Drafts never
enter procedure search. Existing saved runbooks retain their procedure/edition/
skill APIs and distinct `procedure` content/definition kind; they cannot be
overwritten via the generic draft editor.

Definitions select explicit source IDs and exact active revision IDs. Content
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
request-supplied actor. Each edit records its exact base revision. Saving a
generated runbook candidate also retains the exact original candidate content
and fingerprint separately from the human saved content for later merging.
Manual drafts have no invented generated base.

### Cross-source Build views (W3)

The configured constructor and independent evidence audit use strict structured
model-output schemas. Providers without schema support fail explicitly; there is
no JSON-only fallback, fabricated result or citation repair. Schema compliance
does not replace exact-character, relationship coverage or semantic/context checks.
The `evidence-first-v5` adapter extracts a typed source-only fact/context inventory
**before any guide prose is generated or shown**. A second model call checks every
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
The bounded evidence-first target timeout is 300 seconds for the additional stages.
Source-to-inventory checking is model-based and can still omit/misinterpret evidence:
deterministic provenance/coverage is not deterministic semantic completeness.
A saved draft or positive audit is not a live-quality qualification.
An unresolved checkpoint may produce `diagnosticOnly` with explicit missing
evidence and cited recovery/escalation limits; it never invents a confirmed fix.

`buildViews({ corpusId, expectedHead, targets, bounds?, publication?: false })`
admits a durable manual job. Each target supplies `expectedVersion` and a
`definition` with a stable view ID, `kind: "troubleshootingGuide"` and an explicit
revision-aware source selector. Admission freezes complete retained input text,
source membership, current exact revisions, content hashes, target and definition
revisions, authenticated OS actor, temporal bounds and configured pipeline/model
identity. Their fingerprint is persisted with every per-target receipt.
There is no browser-owned job store or duplicate canonical view store.

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
characters and a 300-second per-target inventory/construction/validation deadline; there is
no silent truncation or heuristic generation fallback.

### Explicit edits and conflicts (W4)

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

### Real consuming surfaces

The agent server and standalone memory MCP owner pass the developer flag
explicitly via `TYPEAGENT_MEMORY_VIEW_DRAFTS=true`; unset/false remains off,
and invalid values fail. Use a fresh task-owned profile/store and alternate port.
Building this worktree does not alter an already running server.
The Memory Hub Runbooks page exposes a developer draft Views panel only when
capabilities advertise builds. Choose a named corpus, select exact current
evidence, choose a stable view ID, then **Build (draft only)**. Inspect durable
progress/receipts, edit stable structured sections and typed relationships,
inspect history, or open the three-input conflict comparison and resolve
explicitly. Polling does not replace an active editor.

Browser host validation, agent-side handlers, extension forwarding, RPC facade,
in-process client and real MCP tools route to the owning memory service.
The MCP surface includes `memory_views_build`, `memory_view_build_get`,
`memory_view_builds_list`, cancellation/retry, draft CRUD/history and conflict
inspection/resolution. `memory_view_publish` rejects publication explicitly.

The compiled CLI loads existing configured models (never fetches keys) and uses
the same service methods:

```powershell
node dist\memoryViewsCli.js --store C:\Temp\memory-views-pilot --enable-view-drafts build build-request.json
node dist\memoryViewsCli.js --store C:\Temp\memory-views-pilot --enable-view-drafts builds <corpusId>
node dist\memoryViewsCli.js --store C:\Temp\memory-views-pilot --enable-view-drafts status <corpusId> <jobId>
node dist\memoryViewsCli.js --store C:\Temp\memory-views-pilot --enable-view-drafts inspect <corpusId> <conflictId>
node dist\memoryViewsCli.js --store C:\Temp\memory-views-pilot --enable-view-drafts resolve resolution-request.json
```

`build` and `retry` wait for the terminal receipt before releasing their private
store. `cancel` and `retry` also take `<corpusId> <jobId>`. Do not point this
exclusive CLI owner at a running server's store. Use MCP/Hub to control live
jobs in the actual owning service.

`TypedViewStore` generalizes the existing procedure persistence;
`PersonalHowToStore` remains its compatibility export. Both workflows use one
private **bare** `personal-how-to/view-history.git` repository per corpus. The
authoritative state is the tree referenced by `refs/heads/typeagent-history`, so
there is no competing current-file pointer/cache to recover. The pinned
isomorphic-git library writes blobs, trees, commits and the single internal ref;
runtime needs no Git executable, working tree, index, staging area or remote.
The ref uses the existing atomic JSON/file replacement helper. Object/tree/
commit preparation failures leave current state and readable history unchanged.
Expected-head checks and a repository lock prevent lost updates; unchanged
per-view tree entries retain their blob OIDs. Unreachable failed-preparation
objects are never served through the view APIs.
History retains complete typed snapshots; this pilot does not automatically pack
objects or prune revisions. Storage growth and long-history read latency must be
qualified before enabling recurring generation. Privacy purge is independent of
ordinary retention and also removes unreachable failed-preparation objects.

Replacement marks affected drafts stale, without changing exact historical
versions. Source forget (including event forget with linked-source deletion)
first quarantines the history, removes every affected candidate/view revision,
creates a sanitized baseline repository, and removes the **entire old object
database**, including unreachable objects. This resets corpus commit history,
invalidating prior expected heads; unrelated view revision content is retained.
The quarantine remains until the old procedure search index is removed as well.
Restart recovery repeats this cleanup before reopening history; a crash before
index rebuilding therefore cannot retain forgotten search text, even if no
procedure summaries survive.
An interrupted purge leaves all view/history reads explicitly unavailable until
restart recovery completes. Deleting a ref or running ordinary Git GC would
not erase retained private blobs and is not the purge mechanism. This is not
a claim of secure erasure from filesystem snapshots, backups or external copies.

This is pre-release storage, with no mandatory migration or import tool.
An old procedure index without the new history explicitly errors: choose a
fresh private store/corpus, or reset only a specifically chosen disposable
corpus with the existing explicit management confirmation. No automatic reset
or deletion of a running server/user corpus is performed.

### Runnable local CLI

Build from `ts` with `pnpm exec fluid-build packages\memory\service -t build`
(the root `build` script also passes `.`, which can build unrelated packages).
From `ts\packages\memory\service`:

```powershell
node dist\memoryViewsCli.js --store C:\Temp\memory-views-pilot --enable-view-drafts create-corpus "Draft pilot"
node dist\memoryViewsCli.js --store C:\Temp\memory-views-pilot --enable-view-drafts corpora
node dist\memoryViewsCli.js --store C:\Temp\memory-views-pilot --enable-view-drafts list <corpusId>
node dist\memoryViewsCli.js --store C:\Temp\memory-views-pilot --enable-view-drafts save draft-request.json
node dist\memoryViewsCli.js --store C:\Temp\memory-views-pilot --enable-view-drafts history <corpusId> pressure-guide
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
  "expectedHead": null,
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
and expected head. `publish` fails explicitly with the draft-only limitation.
The store must not be owned by a running server; the service storage lock enforces
this. The CLI never resets data. Its service/RPC façade is the pilot consumer;
remote MCP/browser generic Views authoring is not advertised by this layer.
The existing browser Runbook deep links remain intact: Guide is the primary
human-readable document, its editor explicitly leaves original sources unchanged,
and Agent edition is an optional executable adaptation, not a peer source.

## Canonical agent edition details

An edition contains `goal`, `applicability`, `inputs`, `preconditions`, stable-ID
`steps`, `verification`, `rollback`, `synthesis`, and `review`. Inputs have
`id`, `description`, `type` (`string | number | boolean | enum`), `required`,
`secret`, and optional nonsecret `enumValues`, `defaultValue`, `examples`.
Secret inputs cannot persist literal examples/defaults/enum values. Steps have
`id`, `title`, `humanText`, `agentInstruction`, `safety`
(`readOnly | changesData | unknown`), `citations`, optional `binding`,
`condition`, `alternatives: { condition, stepId }[]`, `verification`, `rollback`,
`needsAttention`, `attentionReasons`, `manualReason`, and `assets`.
Assets are only `{ sourceId, revisionId, assetId, description? }`, never bytes,
URLs, or paths. Synthesis records `sourceReferences`, optional `linkedDocuments`,
`model`, `promptVersion`, and `synthesizedAt`.

Review is **per procedure version**, not per step. `ProcedureSaveRequest` accepts
`reviewAgentEdition?: boolean` and `safetyConfirmed?: boolean` as explicit review
intent. Client/model `review.state` never confers review. The store stamps
`{ state: "reviewed", procedureVersion, contentHash, reviewedAt,
safetyConfirmed: true, bindingValidation: "accepted",
argumentsValidation: "accepted" }` only after validating
explicit safety confirmation, cited steps, known safety, and accepted bindings.
`agentEditionContentHash(document)` hashes the entire document with its review
stamp excluded. Changing even human text or owner notes invalidates review.
An unchanged trusted saved version may retain review when saved again, with the
new exact version stamp. Source-stale and archive transitions reset review to
`{ state: "draft", reason? }`; step attention flags remain. Linked documents,
step citations, and assets are source dependencies too.

`RunbookBinding` is a discriminated union:

- `mcp`: `{ kind, accepted, serverId, targetId, version: string, fingerprint, arguments? }`
- `macro`: `{ kind, accepted, targetId, version: number, fingerprint, arguments? }`
- `flow`: `{ kind, accepted, targetId, version: string, fingerprint, arguments? }`
- `command`: `{ kind, accepted, text }` (redacted guidance only)
- `manual`: `{ kind, accepted, reason }`

Canonical catalog target IDs and MCP server IDs use the stable identifier
contract (1-200 characters). For MCP, persist `serverId` as the actual server
configuration ID and `targetId` as the actual SDK tool name, never a display
label or fabricated alias. The host adapter reconstructs the real native
`JSON.stringify([serverId,targetId])` catalog identity and verifies exact server,
name, version and fingerprint. A selected compound catalog ID must be decoded
and server-checked before storing its canonical components. Unsupported native
names remain explicitly unavailable; local step/input identifiers stay unchanged.

Catalog `arguments?: RunbookBindingArguments` is a parameter-name map of JSON
literals, arrays/objects and exact `{"$input":"declared-input-id"}` references.
Use an exact `{"$literal": JSON}` escape when literal data resembles a reference;
its entire value is literal, including nested marker objects. No interpolation,
script evaluation or input resolution occurs. Input references can represent
secret inputs without storing their values. Secret literals are redacted and
make the binding unaccepted, attention-required and draft; redacted placeholders
cannot be reviewed as resolved arguments.

The root is always a parameter-name map, not a reference or literal wrapper.
Interpret markers only within each parameter value. For example,
`{ "payload": { "$literal": { "$input": "literal-data" } } }` supplies literal
marker-shaped data to `payload`; a root `$literal` key is just a parameter
named `$literal`, not an escape for the whole argument map. Nested wrappers
must have exactly one marker field; malformed markers fail unless they are
literal data inside an explicit escape. Classification guards must be used
after bounded JSON validation, not as replacements for validation.

`validateRunbookBindingArguments(value, inputs?)` enforces plain finite JSON,
declared references when inputs are supplied, depth 16, 10,000 nodes, 65,536
UTF-16 units per string, and 131,072 encoded UTF-8 bytes per mapping. Object
keys are at most 200 characters; prototype-related keys, accessors, hidden
fields, sparse/extended arrays and cycles are rejected, not silently dropped.
`getRunbookArgumentReferences`, `isRunbookInputReference`,
`isRunbookLiteralArgument`, `normalizeRunbookBindingArguments` and
`validateRunbookArgumentReadiness` are browser-safe public helpers.

The host must provide real catalog resolution. The third optional
`PersonalHowToStore(rootDirectory, publishIndex, runbookBindingValidator?)`
constructor argument has this contract:

```ts
type RunbookBindingValidator = (
  bindings: readonly CatalogRunbookBinding[],
  context: RunbookBindingValidationContext, // { inputs: readonly AgentEditionInput[] }
) => Promise<readonly RunbookBindingValidation[]>;
// Each result: { binding, status: "accepted" | "unavailable" | "rejected" |
// "drifted", reason?, argumentsValidated? }.
// Echo the exact binding INCLUDING arguments; acceptance requires argumentsValidated: true.
```

The context contains current input definitions with default/example literals
removed; they must never be used as substitute schema-validation values.
Resolve the real target input schema, validate literal arguments and symbolic
declared-type/enum fit, and explicitly report unsupported schema fit as
unavailable. Omitted arguments mean `{}` and still require required-parameter
validation. Actual runtime input values must later validate against the target
schema; template acceptance does not resolve them or grant execution permission.
Older identity-only catalog review stamps remain readable but cannot publish or
retain reviewed eligibility until explicitly re-reviewed with argument-schema
validation. Old human guides without an edition remain eligible.

**Integration hook:** the `FileMemoryService` options/constructor and owning host
must forward `runbookBindingValidator` to the store. Resolve actual MCP schema
identity, approved macro versions, and approved flow versions; do not accept
guessed names, missing targets, or stale fingerprints. With no callback,
catalog-bound editions fail review explicitly as unavailable. Command/manual
bindings require author acceptance but no external catalog. No code here
executes commands, tools, macros, or flows; review grants no runtime permission.

Public pure validators/renderers, types, canonicalization, draft normalization,
and bounded redaction are available through the browser-safe
`@typeagent/memory-service/agent-edition-validation` subpath (no Node imports).
Server-side SHA-256/review helpers are also exported from the package root.
Browser editors can import `procedureToMarkdown`, `procedureFromMarkdown`, and
`validateProcedureDocument` from
`@typeagent/memory-service/procedure-markdown` without filesystem/crypto imports.
The compatibility subpath `@typeagent/memory-service/procedureMarkdown` exports
the same pure module.
`procedureFromMarkdown(markdown, previousDocument?)` preserves opaque canonical
JSON extension fields from the optional prior document while replacing all
recognized Markdown fields, including honoring removed summary/edition/
additional sections. Server Markdown saves also use the previous saved document
for this preservation. Structured editors should clone the full document,
regenerate canonical Markdown, and send only `document`; Markdown editors can
parse against the current document and send the resulting `document`, never
both `document` and `markdown`. Mark local edits draft with `draftAgentEdition`;
the backend independently verifies and invalidates whole-version review.
Multiline human steps use three-space-indented continuations; embedded original
headings, numbered text, and tables remain part of the same step. Single-line
legacy Markdown output is unchanged.
Consumers should use `validateAgentEdition`, `validateRunbookBinding`,
`validateProcedureSaveRequest`, `validateAgentEditionReadiness`, and
`validateRunbookCatalogBindings` rather than accepting unchecked JSON.
`getProcedureEvidenceReferences(document)` returns deduplicated root/step/
synthesis/linked-document citations and reference-only assets. The host must
resolve these against retained source revisions/assets before accepting review
or publication, and flag missing/unsupported evidence. Pure shape/provenance
validation cannot establish that a passage exists, an excerpt is faithful,
or a cited revision is still current.

The optional `MemoryService` host capabilities `getRevisionAssets`,
`readRevisionAsset`, `startBatchImport`, `getBatchImport`, `listBatchImports`,
`retryBatchImport`, `cancelBatchImport`, `listRunbookJobs`, and `getRunbookJob`
use the asset/batch/runbook modules' public request/result types. The facade
forwards them without adding storage semantics and rejects unsupported
implementations explicitly. Raw asset reads are trusted-host operations;
controlled byte/base64/HTTP transport is the host's responsibility.

Optional `findBatchImport({corpusId,idempotencyKey})` returns an admitted batch
or `undefined`; an unsupported lookup rejects explicitly. The facade and
in-process client forward this lookup. Acquisition adapters should look up an
existing key before refetching URLs and compare its `acquisitionFingerprint`.
`documentKeys` link acquired documents to opaque response `clientKey` values;
`rejectedMembers`/`acquisitionIssues` persist acquisition failures. Empty
`documents` are valid when there is at least one rejected member; completely
empty batches are not. Selection fingerprints alone do not freeze content
before admission: durable pre-admission acquisition snapshots remain the
acquisition adapter's responsibility.

Optional `requestRunbookSynthesis({corpusId,sourceId,revisionId})` explicitly
requests the existing durable postcommit draft pipeline for an exact retained
revision. It returns `RunbookJobResult`, including real `candidateIds`, and may
reuse an existing pending/completed job rather than claiming a new draft.
Current settings/guidance/model capabilities apply. It does not overwrite edited
candidates or saved procedures, approve content, or execute bindings. The facade
and in-process client forward the request and reject unsupported implementations.
Use separate `getRunbookJob`/`listRunbookJobs` for durable outcomes; model failures
remain explicit failed jobs without rolling back committed source ingestion.

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
projection marker. Raw revisions, histories, metadata, event ledgers, and
procedure versions are not rewritten by this reset. The existing checks for
malformed, incompatible, or future `index-schema.json` descriptors still fail
explicitly before reset. Event and procedure indexes ignore the retired document
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

Each derived document, conversation-event, and procedure index generation
records `index-schema.json` with schema version 1, engine `knowpro`, and its
index kind. The descriptor is written after the semantic index persists and
before publication. Missing or older descriptors, and current generations
whose required semantic data is missing, trigger a scoped reset and rebuild
from retained revisions, events, or procedure versions. Malformed or
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
event scoring; a missing or outdated index is rebuilt, and model/indexing
failures are reported instead of silently falling back. An outdated generation
is physically removed before a rebuild, including when extraction subsequently
fails, so searches cannot recover or use that generation. Ledger-backed event
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
`CorpusIndexFactory` for offline tests; by default it uses the procedure
index factory (which defaults to the corpus KnowPro factory). Events can be
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

Personal how-to storage is corpus-owned but persisted independently from the
source manifest, so importing, replacing, reindexing, or forgetting sources
cannot reset its settings. `getPersonalHowToSettings` and
`updatePersonalHowToSettings` use an optimistic settings revision. Procedure
candidates can be detected, drafted, rejected, or saved. Saved procedures are
immutable versions with canonical JSON, a deterministic Markdown projection,
content hashes, source-revision citations, and version lineage. Markdown saves
are parsed and validated while retaining additional free-form sections.

`listProcedures`, `getProcedure`, `searchProcedures`, `saveProcedure`, and
`archiveProcedure` provide the procedure lifecycle. Replacing or forgetting a
cited source creates a new `stale` procedure version while leaving every older
version unchanged. The transport-independent personal how-to API is also
available through the RPC facade.

`searchProcedures` searches the latest version of each procedure independently
of the source-revision index, using a separate KnowPro index within the same
corpus. Procedure Markdown is indexed in content mode, so natural-language
queries use the same structured-knowledge search and message reranking as
indexed documents. Saved, stale, and archived states are indexed as message
tags; requested states constrain KnowPro search before ranking and limiting.
Each commit publishes a new index generation containing only the latest
version of every procedure. Older versions remain available through
`getProcedure`, and a missing index generation is rebuilt from the committed
versions on search. Searches remain corpus-scoped and honor the requested
states and result limit; omitted states include all three states as before.
Procedure indexing requires the configured KnowPro extraction and search
models; it no longer has a separate embedding or lexical fallback.

When both personal how-to settings are enabled, successful Markdown and text
ingestion detects procedural sections containing ordered or checklist steps.
Detected candidates use deterministic source-revision identities and citations,
so unchanged imports and restarts do not create duplicates. Detection runs only
after the source commit; failures are reported in ingestion job warnings without
rolling back the committed source or changing authored procedures.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.

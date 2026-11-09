# @typeagent/memory-client

Scoped graphs are available through `queryKnowledgeGraph` and
`queryGraphSupport` on supporting hosts. The same bounded request/response
schemas validate in-process, RPC and MCP graph operations. Graph responses expose
coverage and generation-bound continuation tokens; clients must not treat
`building`, `stale`, `error` or `unsupported` coverage as complete evidence.
`features.scopedKnowledgeGraphs` reports support for these operations, not that
every requested projection is already prepared.
View/build summary pages and batched publication status support lazy navigation
without loading full view bodies.

## Knowledge readiness and answering

Both clients expose `getKnowledgeStatus`, `updateKnowledgeDiscovery`,
`createKnowledgeCheckpoint`, `getKnowledgeCheckpoint` and
`waitForKnowledgeCheckpoint`. The exported `knowledgeProtocol` schemas are
strict; waits have finite timeouts (0–300,000 ms). Source indexing is distinct
from checkpoint readiness: inspect state, coverage, exclusions and reasons,
including partial/failed/superseded results. `producerComplete` must only be
claimed by a producer that has sealed its batch.

Discovery policy is service-owned: existing corpora stay off; new corpora default
to `sourceObserved`. Explicit policy updates select `off`, `suggest` or
`sourceObserved`; optional `retryFailed: true` requests a bounded retry. Policy
admission records preserve their source-backed reason and never imply human
answer confirmation or authority to run external tools.

`answer` accepts orthogonal `retrievalPolicy` (`sourcesOnly` diagnostic mode or
strict `sourcesAndViews`) and optional `knowledgeCheckpointId`. Omission uses
the host's integrated default. Exact `derivedReferences`, `assertionReferences`,
warnings and integrated reader diagnostics survive MCP serialization. Hosts
advertise `derivedViews.integratedAnswering` and `derivedViews.knowledge`.

Search matches and answer citations preserve optional source-scoped
`temporalContext`, including inherited/discovered date evidence, unresolved event
mentions and rejected anchors. The MCP JSON Schema validates this structured
provenance instead of stripping it. Context does not turn a rejected anchor into
an event date or supply a date for an unresolved mention.

## Schema-defined questions

Generic View protocols include `schemaView` definitions, candidates, support
lineage and `schema-defined-v1` build receipts. Both typed clients expose
`listQuestions`, `editQuestion`, `getViewPage`, `proposeSchemaView` and
`discoverSchemaQuestions`. Page results preserve deterministic `memory-view:`
URIs and exact revisions. Proposals are drafts, not facts; slot approval and
bounded discovery remain explicit guarded edits.

`listAcquisitionProgress`, `runAcquisitionProgress` and
`cancelAcquisitionProgress` return sanitized progress only, including the
`ingested` (indexed but not yet resolved) state. They do not return staged
content, host authority, outbound arguments or raw request errors. Acquisition
admission and periodic scheduling remain host-only. Unsupported capabilities
fail explicitly.

## Explicit agent-session imports

Both clients and the RPC facade expose optional `importAgentSession`,
`getAgentSessionImport`, `cancelAgentSessionImport`, and `searchAgentMemories`
capabilities. Unsupported services reject explicitly. Import requests contain
JSONL content, never local paths, and must select `agent-session-jsonl` or
`copilot-session-jsonl`. `agentSessionProtocol` exports strict schemas and tool
names; chunks are limited to 512 KiB UTF-8 and 1,000 lines.

Submit chunks sequentially with the last receipt's `cursor` as `expectedCursor`
and a content-bound `idempotencyKey` per chunk. Poll `getAgentSessionImport`
until the receipt is no longer `running` before submitting another chunk.
Retry the exact request and key after a lost response. An older completed key
returns the current receipt, not a historical receipt: retain that chunk's
original `expectedCursor` during full-file replay, and validate every earlier
key rather than skipping content because a final receipt exists.
`final: true` seals the
session. Unknown import reads return `undefined` (`null` on the MCP wire).
Search preserves scope, evidence, influence sources, supersession, conflicts,
and warnings; diagnostic memories do not grant execution authority.
Capabilities may advertise `features.agentSessionImportTypes`.
Ordinary document ingestion is unchanged.

`listChanges({ corpusId, pageSize?, continuationToken? })` reads the canonical
metadata-only, 90-day changes receipts as `MemoryPage<MemoryChangeReceipt>`.
Both in-process and MCP clients expose this operation; unsupported services
fail explicitly. MCP uses `memory_changes_list` and validates its strict
receipt schema. Receipts contain opaque references and counts, never source
content, titles, URLs, knowledge names, tokens, or errors.

Search forwards optional ISO `dateFrom` and `dateTo` predicates unchanged.
These filter active revision capture dates, excluding unknown dates. Returned
warnings explain that filtering bounded ranked index candidates can omit
additional matching evidence; results are not complete totals.

Typed in-process and MCP clients plus Zod protocol schemas for the TypeAgent
memory service. The management surface includes corpus status, paged source and
job listing, bounded content reads, source-scoped knowledge, revision-guarded
replacement, preview/confirm source deletion, and source/corpus reindexing.
It exposes explicit derived View builds, revision/history reads, guarded edits, conflicts, publication and search. No settings, candidate detection, saved-procedure CRUD, or synthesis-job API is provided.

Source revision responses retain asset metadata; edition assets are opaque
references only. Raw `Uint8Array` asset ingestion is a trusted in-process/host
capability. MCP ingestion rejects raw assets explicitly until a bounded wire
encoding/upload contract is provided, rather than silently discarding them.

`InProcessMemoryServiceClient` and the RPC facade also forward optional
host capabilities without duplicating their domain logic: `getRevisionAssets`,
`readRevisionAsset`, `startBatchImport`, `getBatchImport`, `listBatchImports`,
`retryBatchImport`, and `cancelBatchImport`.
Asset reads return `{ descriptor, bytes: Uint8Array }`. Batch input is
`{ corpusId, idempotencyKey, documents }`, each document being an ingestion
request without `corpusId`. Unsupported implementations
reject explicitly. These new raw-asset/batch methods are host/in-process
capabilities; MCP binary and batch transport require deliberate bounded
adapters rather than treating `Uint8Array` as JSON.

`findBatchImport({corpusId,idempotencyKey})` forwards optional host batch lookup,
returning an existing admitted batch or `undefined`, and rejecting unsupported
services explicitly. Acquisition wrappers can recover a lost response before
refetching mutable URLs. These batch capabilities remain host/in-process, not
implicit MCP JSON tools.

Batch requests also preserve optional `documentKeys`, `rejectedMembers`,
`documentWarnings` (parallel to `documents`), and batch-level `warnings`
through the typed in-process client and RPC facade. Optional
`acquisitionFingerprint` is retained unchanged in requests and responses.
Acquisition wrappers using pre-fetch recovery must supply a lowercase SHA-256
fingerprint of the raw typed request and compare it against the found batch
before fetching. A mismatch or a legacy missing fingerprint requires explicit
rejection or a new key, never silent reacquisition under the old key.
Batch responses preserve member `clientKey`, `title`,
`displayName`, `stage`, and warnings. Core validation and persistence remain
authoritative; the adapters do not reacquire documents or discard warnings.
There is no MCP batch request schema or batch tool: bounded remote acquisition
and asset byte codecs remain explicit host-adapter work.

Document ingestion uses one model-driven `content` pipeline and KnowPro
retrieval. The mode can be omitted; chunk sizing remains configurable.
The protocol rejects the removed `basic`, `summary`, and `full` modes rather
than translating them or falling back to a different search engine. An
accepted ingestion request is not an assertion that indexing has completed;
use the job status to observe completion or failures.

The typed `answer` operation returns an answer with source-linked citations.
By default the answer is synthesized by KnowPro's answer generator over the
retrieved evidence (`mode: "synthesized"`); `answerMode: "extractive"` returns
the ranked evidence snippets verbatim (`mode: "extractive"`).

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.

# @typeagent/memory-client

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
It also exposes the personal how-to settings, candidate lifecycle, and
versioned procedure save, get, list, search, and archive operations through
both in-process and MCP clients.

Procedure JSON and protocol schemas preserve optional schema-v1 `agentEdition`
content, stable step IDs, immutable binding targets, source/asset references,
review stamps, and additional human sections. Both clients validate edition
input with shared pure service validators. `saveProcedure` forwards explicit
`reviewAgentEdition?: boolean` and `safetyConfirmed?: boolean` intent unchanged;
the backend alone stamps review for the resulting exact saved version/hash.
Supplying a model/client `review.state: "reviewed"` does not review an edition.
Secret input literals and unsafe asset payloads are rejected. Commands are
redacted text and never execute through this API.

Catalog binding `arguments` survive both clients and MCP schemas, including
nested `{"$input":"declared-input-id"}` references and `{"$literal": JSON}`
escapes. Shared bounded JSON validation rejects malformed mappings and unknown
input references. Unknown additional-section metadata is retained. Acceptance
requires actual host target-schema validation and an exact argument echo;
identity-only catalog checks cannot stamp a reviewed version.

Source revision responses retain asset metadata; edition assets are opaque
references only. Raw `Uint8Array` asset ingestion is a trusted in-process/host
capability. MCP ingestion rejects raw assets explicitly until a bounded wire
encoding/upload contract is provided, rather than silently discarding them.

`InProcessMemoryServiceClient` and the RPC facade also forward optional
host capabilities without duplicating their domain logic: `getRevisionAssets`,
`readRevisionAsset`, `startBatchImport`, `getBatchImport`, `listBatchImports`,
`retryBatchImport`, `cancelBatchImport`, `listRunbookJobs`, and `getRunbookJob`.
Asset reads return `{ descriptor, bytes: Uint8Array }`. Batch input is
`{ corpusId, idempotencyKey, documents }`, each document being an ingestion
request without `corpusId`. Runbook jobs are separate postcommit jobs, not an
alternate meaning of a completed ingestion job. Unsupported implementations
reject explicitly. These new raw-asset/batch/job methods are host/in-process
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

`requestRunbookSynthesis({corpusId,sourceId,revisionId})` is forwarded in-process
and through the narrow `memory_runbook_synthesis_request` MCP tool.
`memory_runbook_job_get` and `memory_runbook_jobs_list` expose separate durable
job outcomes and actual candidate IDs, including reused jobs and model failures.
No call executes bindings, approves drafts, or overwrites human-edited versions.
Unsupported service implementations reject explicitly. Runbook synthesis is not
a numerical model-quality acceptance assertion.

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

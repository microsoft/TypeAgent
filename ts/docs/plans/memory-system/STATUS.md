# Memory system implementation status

**Audience:** feature owners, reviewers and release planners.
**Source-review date:** 2026-10-16, TypeAgent `00748a4be`.

This ledger separates implemented contracts, focused automated coverage and
live qualification. The documentation alignment ran no product tests or live
memory workloads. Linked tests are evidence of coverage in source, not claims
that they were rerun for this update.

Architecture belongs in [Memory architecture](../../architecture/memory/memory.md),
[Current system](../../architecture/memory/current-system.md),
[Derived Views](../../architecture/memory/derived-views.md) and
[Maintenance](../../architecture/memory/view-maintenance.md).

## Architecture decisions in force

- One model-driven `content` ingestion pipeline; KnowPro owns content retrieval.
- Retained sources/events and human intent are distinct from rebuildable indexes.
- Conversation memory is the profile event ledger in service-backed hosts.
  Legacy/no-service and workspace-plugin exceptions remain explicitly scoped.
- Wiki/Projects construct from bounded indexed evidence. Timeline/troubleshooting
  retain their selected full-evidence inventory/checking path.
- Views are default-on; automatic informational families and explicit maintenance
  have different admission and recovery contracts.
- Publication, exact derivative readiness, human editorial protection and
  execution authority are independent.
- Saved-procedure detection/CRUD/search/promotion is not a current memory-service
  API. Imported instructions remain evidence.

## Delivered implementation and evidence

All rows below are **source-reviewed implementation**, not blanket release
certification. The live-evidence column states what this ledger can establish.

| Capability / default or host                                                                    | Source and focused coverage                                                                                                                                                                                                                                                                                                  | Live evidence / next acceptance action                                                                                                                        |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Corpora, sources, revisions, jobs, search/answers and management; configured service owner      | [Service](../../../packages/memory/service/src/fileMemoryService.ts), [schema tests](../../../packages/memory/service/test/indexSchema.spec.ts), [answer tests](../../../packages/memory/service/test/answerKnowPro.spec.ts)                                                                                                 | No new run. Recheck complete import/ask/replace/forget/restart journey and both configured answer branches.                                                   |
| Typed conversation ledger and command search/backfill; service-backed hosts                     | [Adapter](../../../packages/dispatcher/dispatcher/src/context/conversationDurableMemory.ts), [integration tests](../../../packages/dispatcher/dispatcher/test/conversationMemoryIntegration.spec.ts)                                                                                                                         | No new parity receipt. Exercise current live/replayed events, deletion, citations and cross-conversation recall.                                              |
| Native agent and authenticated runtime MCP; explicit client configuration                       | [Agent](../../../packages/agents/memory/README.md), [MCP tests](../../../packages/memory/mcp-server/test/memoryMcpServer.spec.ts)                                                                                                                                                                                            | Native integration does not establish external endpoint/token discovery. Verify client configuration and standalone store ownership separately.               |
| Browser capture/import and acquired batches/revision assets                                     | [Acquisition coverage](../../../packages/memory/service/test/sourceAcquisition.spec.ts), [batch maintenance](../../../packages/memory/service/test/batchMaintenance.spec.ts)                                                                                                                                                 | Recheck browser capture, member errors, cancellation, resume and import performance on the intended extension/host.                                           |
| Four typed Views with history/edit/conflict/publication/search; default-on                      | [Types](../../../packages/memory/service/src/viewTypes.ts), [store coverage](../../../packages/memory/service/test/viewStore.spec.ts), [build coverage](../../../packages/memory/service/test/viewBuilds.spec.ts)                                                                                                            | Offline mechanics are not per-kind synthesis quality. Qualify useful final prose, edits and exact citation support with configured providers.                 |
| Indexed Wiki/Projects and automatic family maintenance; default-on unless disabled              | [Host options](../../../packages/memory/service/src/viewHostOptions.ts), [host tests](../../../packages/memory/service/test/viewHostOptions.spec.ts), [Wiki tests](../../../packages/memory/service/test/informationalWiki.spec.ts), [retrieval tests](../../../packages/memory/service/test/informationalRetrieval.spec.ts) | No new corpus-wide quality/drain/no-op claim. Check useful subject coverage, project attribution, limitations and pause/restart with bounded authorized data. |
| Automatic editorial protection/unlock, contribution and guarded generated-article consolidation | [Consolidation](../../../packages/memory/service/src/wikiConsolidation.ts), [editorial tests](../../../packages/memory/service/test/viewEditorial.spec.ts), [recovery tests](../../../packages/memory/service/test/wikiConsolidationRecovery.spec.ts)                                                                        | Requires current real-model distinction/merge quality checks. Protected or historically human-edited pages must not be automatically retired.                 |
| Explicit continuing source scope for timeline/troubleshooting                                   | [Maintenance types](../../../packages/memory/service/src/viewMaintenanceTypes.ts), [maintenance tests](../../../packages/memory/service/test/viewMaintenance.spec.ts)                                                                                                                                                        | Qualify changed-input refresh, no-op, conflicts and bounds. Dynamic future-event scopes are not implemented.                                                  |
| Maintained Topics and revision-bound source synopses                                            | [Topics](../../../packages/memory/service/src/topicTypes.ts), [topic tests](../../../packages/memory/service/test/topicService.spec.ts), [service](../../../packages/memory/service/src/fileMemoryService.ts)                                                                                                                | Navigation quality and synopsis fidelity are separate from exact citation validity. No new semantic-quality receipt.                                          |
| Capture-date source search, Changes receipts and source-to-View usage                           | [Service types](../../../packages/memory/service/src/types.ts), [View types](../../../packages/memory/service/src/viewTypes.ts), [MCP tools](../../../packages/memory/mcp-server/src/viewTools.ts)                                                                                                                           | Verify paging/filter/result contracts per client; do not infer claim-time semantics or filter parity across every answer surface.                             |
| Durable privacy-removal enrollment, dependent purge and restart repair                          | [Service](../../../packages/memory/service/src/fileMemoryService.ts), [foundation tests](../../../packages/memory/service/test/maintenanceFoundation.spec.ts), [acquisition tests](../../../packages/memory/service/test/sourceAcquisition.spec.ts)                                                                          | Qualify UI/restart/late-write behavior in isolation. Local cleanup excludes external exports/backups and secure media erasure.                                |

## Acceptance pending

- [ ] Record bounded, dated real-model evidence for Wiki/Projects usefulness,
      critical distinctions, project scope and citation support.
- [ ] Verify automatic maintenance drain, unchanged-evidence no-op, retry/parking,
      durable pause and restart against the current implementation.
- [ ] Exercise the full browser import/capture/cancel/forget journey and current
      performance workload; do not substitute service-only tests for UI acceptance.
- [ ] Exercise generated/human merge, explicit unlock, real conflicts and safe
      generated-article consolidation with old-ID navigation.
- [ ] Verify exact publication/index failure and retry across restart.
- [ ] Recheck native conversation parity and configured external-client setup.

No checked implementation row grants permission to run an unbounded live
rebuild or to operate on a user's active store.

## Remaining product work

Future requirements need their own explicit contracts: distributed ownership/
synchronization, replica ACL/deletion, advanced temporal/contradiction/entity
semantics and any execution/skill integration. These are not implied by the
local informational knowledge base.

Do not carry forward old backlog labels without checking their scope.
Capture-date source filters and editorial View integration now exist; that does
not establish every proposed filter, editor surface or external integration.

## Capability gates

Track these dimensions separately:

| Dimension                | Required evidence                                                  |
| ------------------------ | ------------------------------------------------------------------ |
| Implemented              | Current source and focused contract coverage                       |
| Enabled                  | Host/default/capability configuration                              |
| Qualified for a workload | Dated corpus/fixture, provider, acceptance results and limitations |
| Operational at scale     | Measured throughput, failure/recovery and storage behavior         |

Default enablement can precede workload qualification. It is not proof of
acceptance, and an older failed provider trial is not a permanent verdict on
every current builder.

## Historical October 1 ledger

The previous ledger at [the reviewed baseline](https://github.com/microsoft/TypeAgent/blob/00748a4be87704ce871cdf9d86b6d7032b7f7b73/ts/docs/plans/memory-system/STATUS.md)
described saved procedures and listed broad browser/parity/performance/model
acceptance work. Those unchecked items were not silently completed by this
update; the scoped acceptance actions above retain the evidence gaps.
Removed procedure APIs are not current delivered capabilities.

Historical qualification reports remain dated in their originating records.
This self-contained ledger does not depend on private reports or a sibling
documentation checkout to assert a live pass.

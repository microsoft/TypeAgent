# Derived-view maintenance

Maintenance keeps editable knowledge aligned with eligible evidence without
discarding human intent. Start with [Derived Views](derived-views.md) for build,
citation, conflict, publication and history contracts.

Views are default-on. Hosts can disable all Views with
`TYPEAGENT_MEMORY_VIEW_DRAFTS=false`, or informational Wiki/Projects with
`TYPEAGENT_MEMORY_INFORMATIONAL_VIEWS=false`. Explicit rehearsal budgets are
test controls, not product enablement or lifetime quotas. Provider request
admission/throttling and application scheduling are separate.

## Automatic and explicit work

![Source/index changes dirty automatic Wiki/Projects and Topics; explicit timeline/troubleshooting maintenance resolves scope. Paused, unchanged and blocked work does not synthesize. Eligible work uses guarded builds and preserves accepted checkpoints.](diagrams/view-maintenance.png)

[SVG](diagrams/view-maintenance.svg) · [Editable scene](diagrams/view-maintenance.excalidraw)

Automatic informational work discovers/refreshes subjects after indexing.
Startup and a 30-second reconciliation sweep repair missed dirty hints.
The sweep is not a promise that synthesis finishes every 30 seconds.

Durable acquired bulk imports defer automatic Topics and Wiki/Projects work
until the final active batch settles. Explicit manual builds remain available.
Privacy invalidation is never postponed until a synthesis schedule.

Targets have bounded work/deadlines. Completed targets remain committed while
technical failures, unchanged rejections and human conflicts are recorded
separately. Provider/materialization failures receive one automatic retry before
parking; changed evidence/recipe or explicit rebuild can reopen admission.
Cancellation is explicit. Recovery finishes committed publication/index effects
without repeating synthesis or inventing duplicate versions.

## Indexed Wiki and Projects

`informational-wiki-v1` is the only operational Wiki construction contract;
`informational-project-summary-v1` is the project contract. Both use bounded
indexed fragments and exact citations, not full-source inventories.

Family `update`, `rebuild`, `pause` and `resume` use the existing job/View store.
Pause is durable. Stable IDs are independent of display titles; saved selectors,
aliases, exclusions, category and notes retain editorial intent.

Discovery requires substantive local evidence, not multiple sources or a page
quota. A service mention alone is not an initiative. Case/whitespace/alias
normalization can nominate a match, but cannot prove identity. Explicit symbol
names and incompatible project/episode scope remain distinct or ambiguous.

Bounded retrieval favors relevant indexed evidence, corrections/qualifications
and source diversity; it does not guarantee exhaustiveness. Wiki limitations
remain visible in body and summary. Project output keeps owners, milestones,
incident closure, capacity qualification and overall project state separate.
Review ownership is not accountable service ownership; rehearsal is not rollout.

Old `wiki-v1` bundles, inventory-backed Wiki/Projects and explicit-subject
registries are rejected, not silently migrated. Historical qualification receipts
do not become current contracts.

### Source-overlap Wiki admission and contribution

For new automatic candidates, actual source/revision overlap nominates bounded
comparisons with current eligible pages; it does not establish equivalent purpose.
Admission distinguishes:

- `distinct`: create a useful independent page.
- `covered`: actual canonical prose explains the essential distinctions.
- `contribute`: refresh the same scoped purpose with missing evidence.
- `ambiguous`: record possible destinations and block for explicit review.

Citation overlap alone is not prose coverage. Contribution uses bounded original
indexed evidence, preserves earlier qualifications, validates actual merged prose
and binds only after the exact canonical revision is ready. Failures/conflicts
do not falsely complete the candidate. Existing article prose is comparison or
merge context, never new source truth.

## Editorial protection and consolidation

Deliberate human edits are protected at reliable edit units. The service exposes
`protectedTargets`; browser clients do not guess those units. An explicit unlock
save records intent without immediately rewriting text, then schedules eligible
maintenance. Ordinary saves alone do not require another synthesis pass.

Consequential changes check actual merged prose for quantities/cohorts, scope,
correction/withdrawal and other critical distinctions. Unsupported output is a
technical rejection, not a request for blanket approval. Genuine human overlap
uses the existing recoverable conflict path.

New-candidate contribution differs from consolidation of existing generated
Wiki articles. Eligible generated, unprotected articles with no historical human
edits can be consolidated when current original indexed evidence establishes
one scoped purpose and consequential output checks pass. Shared infrastructure,
vocabulary, source lists or topic parents only nominate comparison.

Consolidation preserves unique sections/excerpts/citations, commits canonical
acceptance before redirect activation, and waits for exact derivative readiness.
Old-ID reads carry canonical identity and anchor mappings; historical reads
remain explicit. Restart resumes committed effects without another synthesis.
Human-edited historical pages are not automatically retired. Redirect cycles/
over-deep ancestry and changed targets block rather than create semantic retry
loops. No new approval framework or authoritative entity merge follows.

## Maintained Topics and source synopses

Topics are maintained navigation snapshots over eligible original indexed
occurrences, with source/revision citations, parent/related associations,
summaries and limits. `queryTopics` pages that projection; `rebuildTopics` uses
existing maintenance jobs. Label/alias editorial authorship does not turn a
generated summary into human-authored evidence.

Source synopses are exact-revision navigation previews with pending/ready/failed/
unavailable status, freshness and fidelity limits. Failed synopsis work does not
block source indexing/search. Neither Topics nor synopses are independent
corroboration or authoritative project equivalence.

## Explicit timeline and troubleshooting maintenance

These builders retain full-evidence inventory/checking and explicit definitions
for continuing source membership:

| Scope              | Membership                                                   |
| ------------------ | ------------------------------------------------------------ |
| `pinned` or absent | Exact selected sources/events; no automatic advancement      |
| `currentSources`   | Listed source IDs at current ready revisions                 |
| `scopedSources`    | Source types, all required tags and exact `metadata.project` |

Resolution enumerates membership, not a truncated relevance result. Missing,
pending, inaccessible, empty or oversized scopes block explicitly. Canonical
event selection and temporal bounds remain fixed; dynamic future-event scopes
are not implemented.

Accepted dependency fingerprints include eligible source content/metadata/
pipeline, model, scope, temporal bounds and event evidence. Unchanged plans
make no synthesis calls. Failed, stale, cancelled or conflicted work cannot
advance an accepted checkpoint.

## Service and UI controls

The View-capable service, RPC, MCP and browser share guarded operations:

- `updateViewMaintenance`: save explicit scope with head/version guards.
- `planViewMaintenance`: preview targets without writes or synthesis.
- `maintainViews`: admit explicit targets or control a family.
- `getViewMaintenance`: read a receipt and current outcome.

Example in a host with an initialized View-capable service:

```typescript
const { head } = await views.listViews(corpusId);
const result = await views.maintainViews({
  corpusId,
  expectedHead: head,
  family: "wiki",
  operation: "update",
});
const receipt = await views.getViewMaintenance({
  corpusId,
  receiptId: result.receiptId,
});
```

`result` contains `receiptId`, `plan` and an optional `job`. Do not assume every
request generates a job; unchanged, paused or blocked outcomes remain explicit.
`projects` and `topics` are separate families. Read the current head again before
a subsequent mutation.

Memory Hub exposes family controls, explicit maintenance, editable content,
protection/unlock, publication/index state and visible errors. Unsaved edits
must not be replaced by polling. The private-store CLI offers the same
maintenance operations, but must not be used against a running owner's store.

## Verification and limits

Source contracts: [maintenance types](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/memory/service/src/viewMaintenanceTypes.ts),
[scheduler](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/memory/service/src/fileMemoryService.ts),
[consolidation](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/memory/service/src/wikiConsolidation.ts),
[Topics](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/memory/service/src/topicTypes.ts).

Coverage: [maintenance](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/memory/service/test/viewMaintenance.spec.ts),
[batch deferral](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/memory/service/test/batchMaintenance.spec.ts),
[editorial updates](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/memory/service/test/viewEditorial.spec.ts),
[consolidation recovery](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/memory/service/test/wikiConsolidationRecovery.spec.ts).
Offline tests establish lifecycle mechanics, not real-model semantic quality.
Privacy removal and current evidence eligibility override all editorial and
scheduling state. See [History and forgetting](derived-views.md#history-and-forgetting).

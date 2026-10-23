# Derived Views: construction, edits and publication

A View is an editable, versioned document built from saved sources or events.
Use it to collect evidence into a wiki page, project brief, timeline or
troubleshooting guide. Check its citations against the original sources before
relying on a generated claim. A View cannot execute a procedure.

[Memory architecture](memory.md) describes the overall model. [View maintenance](view-maintenance.md)
covers refresh and discovery.

## View kinds

| Kind                  | Construction                              | Evidence and output                                                                                                              |
| --------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Wiki                  | `informational-wiki-v1`                   | One independently identified page per record, bounded indexed citations, editorial category and note                             |
| Project brief         | `informational-project-summary-v1`        | Bounded indexed evidence for one initiative: goals, owners, separate status dimensions, milestones, decisions, risks and context |
| Timeline              | Full-evidence selected-record pipeline    | Exact source revisions and/or canonical events, with separate occurrence, learned, capture and generation times                  |
| Troubleshooting guide | Full-evidence inventory/checking pipeline | Selected retained evidence, prerequisites, diagnostic path, guards, verification and recovery limits                             |

Wiki and Projects find useful subjects across a collection and retrieve exact
indexed fragments, so you don't have to pick every source. One substantial source
can justify a page. The output is bounded and doesn't summarize the whole
collection. If an owner or project state is unknown, the page says so.

Timeline and troubleshooting builders work only from the inputs you select. They
take an inventory, check each source independently, build the document, and then
check coverage and support. These checks use a model, so they don't prove the
meaning is right. Wiki and Projects don't use the full-source inventory.

Old inventory-backed Wiki bundles, `wiki-v1`, explicit-subject registries and the
removed full-source project construction are not supported for compatibility.

## Building a View

![Indexed Wiki/Projects and selected full-evidence builders converge on exact snapshots, protected edit merging and guarded publication/indexing. Failures preserve current content.](diagrams/view-build-flow.png)

[SVG](diagrams/view-build-flow.svg) · [Editable scene](diagrams/view-build-flow.excalidraw)

A build records the definition, exact evidence revisions, model and recipe,
and expected target versions. The model generates the document without holding
the store's write lock. Before saving, the service checks those versions again
and confirms that the evidence is still eligible and the build has not been
cancelled. It rejects results invalidated by a concurrent edit, source replacement
or privacy removal.

`buildViews` returns a durable job with a result for each target. A job's state is
`running`, `complete`, `partial`, `failed`, `cancelled` or `interrupted`. A target
can be saved, merged, conflicted, blocked, stale or failed, so a complete job
doesn't mean every target produced a useful document. Cancelling stops future
saves but doesn't undo targets that already saved.

### Example

This TypeScript runs in a host with an initialized View-capable service named
`views`. `corpusId` and `currentSources` must be real retained identities. The
array holds `{ sourceId, revisionId }` entries, not file paths.

```typescript
const { head } = await views.listViews(corpusId);
const job = await views.buildViews({
  corpusId,
  expectedHead: head,
  publication: false,
  targets: [
    {
      expectedVersion: 0,
      definition: {
        viewId: "incident-guide",
        kind: "troubleshootingGuide",
        selector: { kind: "sources", sources: currentSources },
      },
    },
  ],
});
const progress = await views.getViewBuild({ corpusId, jobId: job.jobId });
```

`expectedVersion: 0` asks for a new guide. It doesn't overwrite an existing one.
`getViewBuild` returns a `ViewBuildJob` or `undefined`, so handle a missing
receipt. Otherwise read `state` and `results`. Don't publish a View ID until a
saved exact revision exists. For automatic Wiki and Projects, use the family
operations in [Maintenance](view-maintenance.md#service-and-ui-controls).

## Exact citations and relationships

A citation keeps the source and revision identity, a locator and an excerpt.
Locators for indexed informational content encode the block identity, its hash
and bounded UTF-16 ranges. Citations for full-evidence builds resolve to the
retained original text. Timeline event citations also name the canonical event.
Generation time is not the time an event occurred.

Stable section IDs and typed relationships are stored separately from graph
labels. Relationships distinguish a source-backed assertion from a dependency
introduced by source selection.

When reviewing a View, check that each citation resolves to the intended passage,
that the passage supports the claim, and that important evidence is not missing.
A generated View does not count as independent corroboration of its own sources.

## Explicit edits and conflicts

The service authenticates human saves and applies optimistic head and version
guards. It keeps the generated base separate from the current human text. A
rebuild uses a bounded three-way merge of the old generated base, your current
text and the new generation. Relationships keep their semantic identities and
explicit removals. The merge does not use a language model to choose between edits.

For informational maintenance, deliberate human edit units are protected.
`protectedTargets` is the service's authoritative list. An explicit unlock records
what the user wants before the service schedules a revision. Routine generated
corrections can still happen automatically. Privacy removal overrides protection.

When edits overlap, the service keeps the current content and creates a durable
comparison. To resolve a conflict you must supply the exact current head, version,
revision and input guards, and choose the human text, the generated text or a
combination. The service then checks the resulting prose. A clean text merge
doesn't mean the meaning survived. See
[Editorial maintenance](view-maintenance.md#editorial-protection-and-consolidation).

## Publication and search

Publication policy is resolved in this order: a one-build override, then the
saved View's override, then the corpus policy. An explicit `false` doesn't fall
through to the next level. Auto-publication is on by default; it does not mark
the content as human-reviewed.

Informational content doesn't need the full-source inventory proofs that
timelines and troubleshooting guides use. Each path still enforces its own
validation, current evidence, target guards, and conflict and privacy gates.
Saving or reviewing a draft that has no sources doesn't produce a validated
generated base.

`getViewPublication` returns `latestBuiltRevisionId`, `publishedRevisionId`,
`indexedRevisionId`, `indexState` and reason fields. `indexState` is `absent`,
`pending`, `failed` or `ready`. A publication can succeed while indexing it fails.
`retryViewIndex` repairs the index for the exact published revision without
generating a new document.

`searchViews({ corpusId, query, freshness: "current" })` returns a
`ViewSearchMatch[]`. Each match has the exact View, a score and snippet, the
original evidence, `review: "unreviewed"`, `freshness: "current"` and
`corroboration: "derived"`. Only eligible published revisions with a ready index
come back. Pending drafts, stale evidence and unresolved conflicts don't get
substituted into default search.

## History and forgetting

![Retained evidence stays outside private artifact Git. Committed View/Topics snapshots preserve edits and comparisons; authorized forgetting purges dependent history and indexes before reads reopen.](diagrams/view-history-boundary.png)

[SVG](diagrams/view-history-boundary.svg) · [Editable scene](diagrams/view-history-boundary.excalidraw)

`listViews` returns the corpus's current `head`. `getView` reads the current
revision or an exact one, and `getViewHistory` returns `{ commitId, version }`
entries. A View's revision ID is different from the corpus commit ID. Private Git
commits snapshot View state. They don't include the KnowPro index or the canonical
source content.

Once source forgetting is authorized, the service records it durably. It must
finish cleaning up the source, index, Views, history, assets, batches and context
before corpus content reads open again. Dependent builds, conflict payloads,
influence from uncited sources and private history can't get around forgetting by
using an older commit. Forgetting an event also purges the timelines that depend
on it. A restart resumes unfinished cleanup. Deleting a visible file or ref alone
doesn't give you this guarantee.

This is managed local removal. It does not securely erase SSD blocks, external
backups, screenshots or exported copies.

## Interfaces and verification

In-process, RPC, MCP and browser clients all route to the owning service. The
native memory agent doesn't have a command for every View operation. The
private-store CLI is another exclusive owner, so don't use it on the store of a
running server.

Contracts: [View types](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/memory/service/src/viewTypes.ts),
[store](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/memory/service/src/viewStore.ts),
[MCP tools](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/memory/mcp-server/src/viewTools.ts).
Focused coverage: [builds](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/memory/service/test/viewBuilds.spec.ts),
[store](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/memory/service/test/viewStore.spec.ts),
[Wiki cleanup](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/memory/service/test/wikiCleanup.spec.ts).
These offline lifecycle tests don't measure how well live models perform.

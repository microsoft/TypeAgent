# Manual derived-view maintenance

Maintenance is an opt-in developer extension of the four-view build pipeline:
wiki, project brief, timeline and troubleshooting guide. It selects affected
views incrementally and rebuilds each selected view from its complete retained
evidence. It does not patch prose from fact deltas or schedule background synthesis.
The existing `TYPEAGENT_MEMORY_VIEW_DRAFTS` gate and live-quality qualification
boundary still apply.

## Definition, snapshot and checkpoint

The persisted definition records continuing intent separately from the exact
selector used by one build:

| Scope                                 | Membership                                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `pinned` or no maintenance definition | Existing exact-source/event builds; no advancement or expansion                                |
| `currentSources`                      | Listed source IDs at their current ready revisions                                             |
| `scopedSources`                       | Current sources matching optional source types, all supplied tags and exact `metadata.project` |

Resolution enumerates membership, not top-K retrieval results. It blocks on missing
configured sources, matching pending/failed ingestion, empty scope, suppressed
source knowledge and overflow. Timeline document revisions can advance while its
explicit canonical-event selection and temporal bounds remain fixed. Dynamic
event-only/future-event scopes are not part of this release.

Each accepted generated version retains a logical fingerprint, source revision/
content/metadata/pipeline identities, wiki registry and page manifests. The logical
fingerprint includes scope/discovery rules, temporal bounds, canonical-event
identity/content, source capture/modified metadata, pipeline configuration and
model identity. It excludes actors, job IDs, build/acceptance timestamps,
output heads and output versions. Corpus/index timestamps are not freshness proofs.
Missing manifests force reconciliation; an unknown generated base blocks automatic
edit replacement.

Page manifests record contributing evidence and conservative context dependencies
on **all selected sources**. This deliberately favors completeness over precise
page-level invalidation while construction still rebuilds whole views.

## Explicit wiki subjects

Dynamic wikis require `wikiDiscovery.rules = "explicit-subjects-v1"`. Subject keys
come from source `metadata.viewSubjects` or reviewed definition bindings, not model
invented keys, page titles or normalized names.

Example ingestion metadata:

```json
{
  "project": "checkout",
  "viewSubjects": [
    { "key": "payments-service", "title": "Payments", "taxonomy": "system" },
    {
      "key": "connection-pool",
      "title": "Pool pressure",
      "taxonomy": "concept"
    }
  ]
}
```

Example maintenance definition:

```json
{
  "schemaVersion": 1,
  "scope": { "mode": "scopedSources", "project": "checkout" },
  "wikiDiscovery": {
    "rules": "explicit-subjects-v1",
    "createDraftPages": true,
    "subjects": [
      {
        "key": "payments-service",
        "title": "Payments",
        "taxonomy": "system",
        "pageId": "existing-payments-page"
      }
    ]
  }
}
```

Use `pageId` only in a reviewed binding to an existing matching-taxonomy page.
Legacy pages need those explicit bindings before dynamic reconciliation.
Source metadata cannot assign/rebind page IDs. Reviewed bindings resolve conflicting
display labels for an established key; taxonomy changes and identity rebinding block.

New subjects receive deterministic UUIDv8 page identities scoped to corpus, view
and subject key. Allocations become persisted registry entries only with accepted
output. Repeated discovery does not duplicate pages; a new subject in a revised
old document is discovered just like one in a new document. Known keys extend their
existing pages, and renames preserve IDs. The model must use supplied page IDs, reviewed titles and
taxonomies and represent every discovered subject. The construction schema binds
those fields together for each subject. Metadata supplies identity,
not evidence support: inventory/source checks and final semantic audits still apply.

Existing explicit omission/merge edits remain authoritative. Accepted manifests
retain omitted keys and survivor mappings rather than forgetting those intentions.
When removing evidence would retire an active unmapped page, this release blocks
for explicit resolution instead of deleting it automatically. Registry and privacy
provenance have separate 128-entry bounds; exceeding them blocks for review.

## Admission and acceptance

1. Preview a bounded plan for explicit view IDs: `pinned`, `unchanged`, `blocked`
   or `rebuild`, with reasons and dependencies.
2. Submit the exact plan head and target versions. Re-resolve under the corpus
   write boundary, so preview is not an authorization or concurrency bypass.
3. Admit only affected full-view targets through existing inventory, construction,
   support, human-edit merge and whole-artifact validation.
4. Re-resolve membership and recheck source/event/rule/model identity and target/edit
   guards before materialization. Newly eligible evidence arriving during generation
   invalidates an obsolete plan even if its former sources are unchanged.
5. Commit each accepted artifact, registry and manifests together in the existing
   private Git history. Failed, stale, cancelled or conflicted attempts do not
   advance their evidence checkpoints. Partial batches checkpoint successes separately.
6. Apply existing publication/index policy separately. Maintenance does not imply
   publication, review, skill approval or execution. Index retries reuse accepted output.

No-op maintenance makes zero synthesis calls. It records an inspectable receipt
without creating a new artifact version. Receipts reference existing build jobs
rather than copying retained source text. Up to 100 latest receipts are directly
readable; accepted manifests and existing Git history retain provenance.

Ingestion/suppression changes issue lightweight invalidation, not synthesis.
Potentially outdated maintained drafts remain stale after ordinary content edits.
Publication/search independently re-resolve maintenance freshness, including new
membership, even when publication refers to an older revision.

Forget/clear includes manifests, registry/tombstones, discovery privacy provenance,
receipts, pending build/conflict snapshots, caches and the existing Git object purge.
Registry provenance conservatively retains prior source IDs so losing a current
citation cannot evade forgetting. Privacy purge drops diagnostic maintenance plans/
receipts conservatively; backups and external exports are outside local guarantees.

## Controls

All operations use the same service contracts across in-process/RPC clients, MCP,
parent/browser transports, extension forwarding and the Memory Hub:

- `updateViewMaintenance`: opt in/change a definition with exact head/version guards.
- `planViewMaintenance`: preview without writes or synthesis.
- `maintainViews`: persist a receipt and optionally admit an affected-view build.
- `getViewMaintenance`: inspect a persisted receipt and its current build outcome.

The Hub exposes **Maintain**, a bounded JSON definition editor, preview, run,
accepted manifests and build plans. Unsaved edits and service failures are explicit.
Publication controls and execution restrictions remain unchanged.

The exclusive-owner CLI adds:

```powershell
node dist\memoryViewsCli.js --store C:\Temp\memory-views --enable-view-drafts set-maintenance definition-update.json
node dist\memoryViewsCli.js --store C:\Temp\memory-views --enable-view-drafts plan-maintenance plan-request.json
node dist\memoryViewsCli.js --store C:\Temp\memory-views --enable-view-drafts maintain maintenance-request.json
node dist\memoryViewsCli.js --store C:\Temp\memory-views --enable-view-drafts maintenance-status <corpusId> <receiptId>
```

`plan-request.json` contains `corpusId` and `viewIds`.
`maintenance-request.json` contains `corpusId`, the preview's `expectedHead` and
`targets` with `viewId`/`expectedVersion`. `definition-update.json` additionally
identifies one `viewId` and its expected version, with the definition in `maintenance`.
Do not use this CLI against a store owned by a running server.

## Qualification and later work

Offline tests cover no-op call counts, new/revised-source discovery, reviewed
renames, omissions, concurrency, partial batches, cancellation/restart, forgetting,
all four HTTP/parent view paths, real authenticated MCP and UI failure preservation.
These are lifecycle tests, not model-quality guarantees.

`viewMaintenanceQuality.test.ts` runs the real configured adapter on a synthetic
two-checkpoint corpus. It requires accepted exact-page coverage, stable identities,
retained numerical/status facts, no missing inventory facts and zero model stages
on no-op. Run explicitly from the service package after building:

```powershell
npm run jest-esm -- --runInBand --testPathPattern="viewMaintenanceQuality[.]test[.]js$"
```

The configured-model two-checkpoint test passed locally with exact identity-bound
schemas. The initial run exposed an identity/title mismatch, which was corrected
by constraining each page's ID, reviewed title and taxonomy together rather than
weakening acceptance checks.

It uses existing configured credentials and never fetches keys. A passing synthetic
run does not qualify broader distillation corpora. Periodic triggers, selective page
synthesis, automatic retirement/identity migration and durable change cursors remain
separate work; physical KnowPro index storage in Git is unnecessary.

# Derived-view maintenance

Views are enabled by default. The host can disable all Views with
`TYPEAGENT_MEMORY_VIEW_DRAFTS=false`, or only informational Wiki/Projects with
`TYPEAGENT_MEMORY_INFORMATIONAL_VIEWS=false`. Explicit test rehearsal budgets
do not enable product behavior or impose lifetime product quotas. Configured
provider request admission, 429/retry handling and application scheduling remain
separate concerns.

## Indexed Wiki and Projects

`informational-wiki-v1` is the sole operational wiki construction contract.
Each record contains one independently identified, editable page with bounded
indexed citations. The informational family discovers wiki targets from the
existing index after ingestion. Family `update`, `rebuild`, `pause` and `resume`
use the existing maintenance service; durable pause survives reopening.

Old source-only wiki definitions, `wiki-v1` requests, inventory-backed bundles
and `wikiDiscovery.rules = "explicit-subjects-v1"` are rejected explicitly.
There is no compatibility alias or serialized migration. Existing historical
qualification receipts are not rewritten.

Page titles, fixed concept/system/project categories, personal notes, source
exclusions, exact citations and stable identities remain editable. Prose
regeneration retains editorial overrides or exposes conflicts rather than
silently overwriting them. The browser creates wiki pages through the indexed
family and rebuilds saved informational definitions, not full-source bundles.
Bundle merges, omissions and explicit-subject registries are not operational
editor controls.

Projects retain `informational-project-summary-v1`, sharing bounded indexed
retrieval without an inventory pipeline. Family `projects` discovers typed
initiative subjects with local goals/scope evidence after successful indexing.
A service mention alone is not a project. New candidates and existing saved
selectors are reconciled through the same family/job/view store as Wiki, with
durable independent pause/resume, failures and restart recovery.

Selector/alias case, whitespace and underscore variants nominate compatible
descriptors, never titles. Reuse requires shared indexed subject evidence and
compatible extracted types and explicit project/initiative/episode/scope facets.
Missing identity metadata is not proof of equivalence; disjoint evidence records
an ambiguity rather than creating another lexical duplicate. Explicit symbol
types do not receive implicit underscore/space equivalence. Only duplicate
unmaterialized nominations can be retired. Historical saved pages remain
independent, including edits, references, exclusions and stable IDs; multiple
compatible saved pages report an ambiguity and are never merged automatically.
This is conservative lexical nomination, not semantic grouping or hierarchy.
Exact indexed symbol names retain their original spelling. Multiple exact
symbols collapsed into one folded KnowPro term expose an ambiguity instead of
nomination as one newly generated page; no automatic cross-record consolidation
or new disambiguation workflow is provided.
A mixed meeting can supply
evidence for multiple initiatives; synthesis must keep goals, owners and each
status dimension bound to the selected initiative and retain unknowns.
Status prose separately preserves incident closure and blocked/unvalidated
capacity qualifications and reasons; the bounded capacity enum may represent
unvalidated capacity as `pendingOwnerReview`. Review ownership does not establish
accountable service ownership, and rehearsal acceptance does not complete a
rollout. Project prompt revisions invalidate evidence no-ops without changing IDs.

Indexed subject discovery requires local substantive content, not multiple
sources or a page quota. Dates, bare quantities, metadata-only subject lists and
unsupported headings do not independently nominate pages. Generic properties
require explanatory content rather than an incidental state/value. Useful
one-source definitions, observations and charters remain eligible. These
deterministic content checks do not semantically qualify generated prose.
Legacy unmaterialized metadata/shell nominations are filtered with explicit
maintenance-plan reasons; saved pages are not removed or reclassified by this
usefulness gate. Unknown extracted type/scope is not a global type or scope:
shared indexed evidence is still required, and known metadata is retained when
an unknown descriptor is enriched.

Bounded retrieval selects by indexed relevance, new correction/counterexample/
qualification/observation signals and source diversity rather than newest-three
selection. Interleaved windows retain exact indexed locators and the existing
12-fragment, 2000-character/window and 32000-character read ceilings. Unselected
candidate blocks set the limited flag. Selection and prompts preserve older
bounded successes, measurements and initiative-specific conditions without
claiming exhaustiveness. Shared vocabulary and infrastructure are navigation
hints, never authority to unify project owners, states, milestones or episodes.
Wiki coverage limits appear in both body and summary so body-only exports retain
the caveat. Categories, notes and readable titles remain editorial metadata,
not retrieval scope. Grouping prompt changes invalidate Wiki evidence no-ops;
the timeline/troubleshooting pipeline and project goals/scope remain unchanged.
Versioned synthesis identity is shared by snapshot fingerprints and repeated
build-receipt lookup, preserving request idempotence across prompt revisions.

### Source-overlap Wiki admission and contribution

Only new, unmaterialized automatic Wiki candidates undergo purpose admission.
The current published/index-ready pages nominate at most eight comparisons.
Contributing source sets are derived from actual page citations and incoming
selected indexed passages, **not** all queried sources, descriptors or derivative
Wiki indexes. Keys include both source ID and exact revision ID. Empty sets do
not overlap; a replacement revision is not interchangeable with its predecessor.
Identical/subset sets rank first, then exact shared/union ratio and exact-fragment
overlap, with stable-ID ties. No guessed "high overlap" threshold makes a decision.

Source overlap nominates comparison even if locators differ. Exact shared
fragments are separately recorded. Scope/content review preserves independently
useful purposes, explicit projects/episodes, units/statistics, cohorts and
qualifications. A resource definition and its scoped failure explanation can
share a canonical page without unifying the underlying KnowPro entity/topic.

The typed assessment has four outcomes:

- `distinct`: construct an independent new page.
- `covered`: every selected fragment's essential distinctions have explicit
  exact witnesses in actual canonical prose; citation overlap alone is not
  coverage. Truncated comparison prose cannot prove complete coverage.
- `contribute`: missing essential distinctions belong in the same scoped
  canonical purpose. Refresh the canonical stable ID using its exact cited
  indexed evidence plus incoming current indexed evidence. Existing prose is
  comparison/merge context, never source truth. Preserve earlier qualifications.
- `ambiguous`: multiple existing pages serve that purpose. Persist their IDs
  in a blocked receipt for explicit review; never delete/merge historical pages.
  No new Inbox request/response or graph-canonicalization feature is provided.

Contribution takes the bounded union of two existing reads: at most 24 distinct
fragments, 2,000 characters each, 48,000 excerpt characters total. These are
application evidence bounds, not provider context/token quotas or test envelopes.
Overflow blocks explicitly rather than dropping earlier facts. Existing aliases
are retained and candidate selectors are added within the existing seven-alias
contract; capacity exhaustion is explicit, never silent alias deletion.

Refresh uses the existing generated-base merge/edit-conflict machinery. Titles,
taxonomy, personal notes, aliases, exclusions, references and editorial changes
remain preserved or explicitly conflicted. The merged actual prose is checked
against **all combined evidence**, including earlier qualifications and novel
contrasts. Unsupported claims or missing essential distinctions cannot bind
the candidate. Target version/definition/revision, source revisions/content,
indexed locators, exclusions, suppression/forgetting and cancellation are
rechecked before accepting the canonical update.

The existing build result atomically records the canonical contribution and
its frozen input with state `committed`. Only after that exact canonical revision
is visible and derivative-index-ready does the receipt become `bound` and the
unmaterialized candidate become a genuine covered `skipped` result. Index,
provider, conflict or stale failures remain incomplete and do not advance family
completion. Unresolved contribution edit conflicts remain pending/blocked
without repeating model calls; authenticated conflict resolution is required.
Retry of a matching committed contribution finishes indexing/binding without
another canonical version or synthesis. Already-ready indexing is not reset.
Privacy purge and runtime cancellation include borrowed canonical evidence.
Initial missing-distinction requirements are remapped to combined fragment IDs
and must survive the final coverage assessment unchanged, with exact new prose
witnesses. A later checker cannot silently weaken/omit the original requirement.
Subsequent canonical maintenance retains still-eligible cited fragments and
checks contribution coverage again; obsolete source revisions/exclusions are
never copied forward as evidence. Explicit changes of the canonical query
invalidate that old-purpose preservation context.

Replay requires unchanged candidate evidence/model plus the exact current
canonical publication/revision and bound contribution receipt. Normal refresh
uses the added selectors to retrieve the contributing explanation. Wiki prompt
identity is `wiki-source-contribution-v3`; Projects and their prompt identity
are unchanged. Offline tests verify these mechanics; they do not establish
real-model semantic quality or authorize another live rebuild/ingestion.

Project retrieval searches current eligible indexed postings across the
collection before selecting bounded fragments. Neither the first/last 32
documents nor a user's source selection defines automatic coverage. The saved
selector retains only exact evidence revisions for the bounded build. A manual
project build may pass an empty source selector to search all eligible sources.
Queries, aliases, exclusions and editorial titles/prose remain editable.
Unchanged evidence makes no synthesis calls; new uncited evidence, replacements
and removal dirty the family. Missing/excluded evidence blocks visibly rather
than substituting invented content. Privacy eligibility still gates every read.

Publication and derivative indexing are independent per-record operations.
Creating or updating a page does not imply that its derivative index is ready.
Citation eligibility, source suppression/forgetting and privacy guards still
apply independently of publication state.

## Explicit timeline and troubleshooting maintenance

Timeline and troubleshooting guides retain their shared full-evidence inventory,
support, temporal and publication helpers. Their manual maintenance definitions
select continuing membership independently of the selector used by one build:

| Scope                                 | Membership                                                   |
| ------------------------------------- | ------------------------------------------------------------ |
| `pinned` or no maintenance definition | Exact sources/events; no automatic advancement               |
| `currentSources`                      | Listed source IDs at current ready revisions                 |
| `scopedSources`                       | Matching source types, all tags and exact `metadata.project` |

Resolution enumerates membership rather than truncating top-K relevance. Missing,
pending, inaccessible, empty or oversized scopes block explicitly. Timeline
source revisions can advance while canonical-event selection and temporal bounds
remain fixed. Dynamic event-only/future-event scopes are not implemented.

Accepted versions retain dependency fingerprints and conservative privacy source
identities. Fingerprints include source content/metadata/pipeline, model, scope,
temporal bounds and canonical-event evidence, not actor/job/time/output versions.
No-op plans make no synthesis calls. Failed, cancelled, stale or conflicted work
does not advance accepted dependency checkpoints.

The removed wiki-only registry/page manifests are not required by these consumers.
Privacy provenance still conservatively retains previous source IDs so removing
a citation cannot evade forgetting. Forget/clear purges local views, dependencies,
receipts, conflicts, caches and private history; external backups/exports are
outside local guarantees.

## Service and UI controls

In-process, RPC, MCP, gateway and browser transports share strict contracts:

- `updateViewMaintenance`: change an explicit definition under head/version guards.
- `planViewMaintenance`: preview without writes or synthesis.
- `maintainViews`: record a receipt and optionally admit work; also controls the
  informational `wiki` and `projects` families.
- `getViewMaintenance`: inspect the receipt and current build outcome.

The Hub exposes manual maintenance for timeline/troubleshooting, informational
family controls, explicit editorial changes, publication state and build errors.
Unsaved edits and failures remain visible. No approval or execution authority is
granted by a generated view.

The exclusive-owner CLI uses the same operations:

```powershell
node dist\memoryViewsCli.js --store <isolated-store> set-maintenance definition-update.json
node dist\memoryViewsCli.js --store <isolated-store> plan-maintenance plan-request.json
node dist\memoryViewsCli.js --store <isolated-store> maintain maintenance-request.json
node dist\memoryViewsCli.js --store <isolated-store> maintenance-status <corpusId> <receiptId>
```

Do not use this CLI against a store owned by a running server. Offline lifecycle
tests are not model-quality or live provider-capacity qualification.

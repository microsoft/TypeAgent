# wiki-views

Examples for TypeAgent's existing informational wiki and project-brief
builders. The private package is named **`wiki-views`**; its shared example
directory is `examples/viewExamples`. No extension provider is required.

The offline commands use `FileMemoryService`, a real persisted KnowPro corpus index
and deterministic extraction/synthesis injection. They establish orchestration and lifecycle behavior, **not** factual
model quality. Original small source fixtures are development material, not
independently approved evaluation gold.

Memory-approach quality evaluation uses real-model (`live`) runs only. Offline
outputs are excluded from the evaluation matrix; retain offline tests solely
for deterministic orchestration, citation and lifecycle regressions.

## Build and run

From the repository's `ts` directory in PowerShell:

```powershell
if (Test-Path $PROFILE) { . $PROFILE }
pnpm run build
pnpm --filter wiki-views run wiki-views --list
pnpm --filter wiki-views run wiki-views --mode offline --case capacity-review-wiki --root .runs\wiki-first
pnpm --filter wiki-views run wiki-views --mode offline --case capacity-review-projectBrief --root .runs\brief-first
pnpm --filter wiki-views test
pnpm run test:memory-quality
```

Filtered commands run with the example package as their working directory.
Every run root must be a **new child** of this package's `.runs`, `.data` or
`.test-runs` directory. Existing roots, source trees, symbolic links/junctions
and external/profile paths are refused. The runner never discovers a production
store or deletes an existing run. Retain receipts; clean up only specifically
identified owned run directories after closing the service.

Run-root paths use the host operating system's path syntax. Offline regression
fixture modules resolve portably on Windows, Linux and macOS.

To use already prepared external construction data, pass
`--input <construction.json> --case <case-id>`. The runner never opens its
adjacent evaluator packet. The packet must carry `schemaVersion: 1`,
`purpose: "construction-only"` and bundles with stable IDs, informational kinds,
bounded query/aliases and sources with retained-text SHA-256. Dataset source
versions are mapped to actual corpus/source/revision/content-hash identities
after ingestion; they are not assumed to be memory revision IDs.

## Artifacts and state

- `.wiki-views-owned.json`: explicit ownership marker.
- `construction.json`: the retained construction packet and release identity.
- `source-mapping.json`: actual ingestion identities and terminal receipts.
- `saved.json`: exact stored version, content and relationships.
- `rendered.txt`: product `viewContentToText` output, not an alternate schema.
- `request-evidence.json`: original indexed construction snapshots.
- `receipt.json`: terminal build results, exact artifact hashes, mode,
  injected behavior, authorization identity and publication/index state.
- `failure.json`: explicit component, stage and reason after a store was opened.

Automatic family work is durably paused before import; corpus auto-publication
is disabled; explicit builds use `publication: false`. A successful example
creates a draft, not a searchable published view. Every emitted indexed citation
is resolved against its exact original revision before success is recorded.

Memory Hub includes current drafts when browsing Views. **Open current view**
does not require publication; the current saved revision is labeled exact rather
than historical. Published search still excludes these draft-only examples.

Project briefs display the `goalsScope` section as **Goals and Scope** in Memory
Hub and text exports. Saved drafts using the internal identifier are formatted
at display time without changing retained artifacts or custom headings.

Indexed construction snapshots are selection diagnostics, **not** complete
provider wire requests or a factual-quality scorecard. Receipts deliberately
set `qualityBaseline: false`. Live campaign execution must additionally capture
actual admitted provider requests, measured usage and independently bound human
annotations; do not promote these diagnostic receipts into measured baseline
records or score deterministic injected output.

## Live boundary

Live execution requires `--mode live --authorization <approval.json>`, where the
non-secret approval record contains `approved: true` and a nonempty `identity`.
The integration owner supplies this record only after separate approval for
ingestion and synthesis. It is an authorization attestation, not authentication
or permission to acquire/publish source data. Existing approved runtime/model
configuration must already be provisioned; no key provisioning or sign-in is
initiated by the example. Missing approval/configuration fails explicitly and
never switches to offline.

The host API accepts configured synthesis options for approved live callers;
offline is the default development lane. Neither tests nor help/list commands
need credentials, dataset acquisition, external services or model requests.

To inspect what the configured models actually generate, use the same case and
a new owned root with explicit authorization:

```powershell
pnpm --filter wiki-views run wiki-views --mode live --case capacity-review-wiki --root .runs\live-wiki --authorization <approval.json>
pnpm --filter wiki-views run wiki-views --mode live --case capacity-review-projectBrief --root .runs\live-brief --authorization <approval.json>
```

This performs real ingestion and synthesis without deterministic model/index
injection. The original capacity fixture contains status/approval evidence but
no substantive project description; a live model must not invent missing goals
or deliverables. Use sufficiently descriptive approved sources for a useful
project-understanding evaluation. Live execution alone does not make the original
development fixtures reviewed quality gold.

## Dataset and evaluation tooling

Separate offline preparation and campaign tools live in
[`tools/memory-maintenance-qualification`](../../tools/memory-maintenance-qualification).
See the [dataset preparation/acquisition commands](../../tools/memory-maintenance-qualification/quality-view-data-README.md)
and [campaign/scorecard commands](../../tools/memory-maintenance-qualification/quality-view-campaign-README.md).
External asset acquisition, upstream licenses, source accessibility, evaluator
custody and independently reviewed gold are separate gates. The existing frozen
24-bundle pilot is unchanged and must not be supplied to implementation workers.

The six original fixture topics illustrate capacity versus incident status,
reviewer versus accountability, undated proposed milestones, withdrawn
decisions, same-name scoped initiatives and shared concepts without identity.
Each has original baseline, update and correction sources. All six topics are
development orchestration fixtures, not an untouched confirmation split.
Independently reviewed confirmation projects must be authored and held separately.
Typed state remains conservatively unknown in the deterministic copy fixture:
its prose is input evidence, not a semantic interpretation or independent gold.

## Full online development run

The 2026-11-07 execution generated 52 live drafts: all 12 original cases, all 32
query-specific briefs from the first five QMSum Product training meetings, and
eight of ten selected FreshWiki topics. Two FreshWiki topics could not be built
because permitted original supporting evidence was unavailable. This is the
planned development sample, not the entire public datasets or confirmation.
See the [execution results and source shortfalls](../../../../codeDocs/TypeAgent/forAgent/projects/inProgress/2026-11-07_wiki-project-brief-validation/README.md#full-online-development-dataset-run).

Full QMSum transcripts were imported; their answers, topic annotations and
reference spans stayed outside generation. FreshWiki target articles likewise
remained evaluator-only: only matched, separately licensed supporting snapshots
were imported. Access failures and unsupported reuse licences did not produce
placeholder views or reference-article substitutions.

Qualified adapter IDs are preserved in explicit dataset-to-runtime mappings;
safe hashed view/source IDs satisfy the example's identifier constraints.
The mappings are retained in each construction packet's release metadata.
All attempts, including failed attempts and the source-backed Eukaryote
grammatical-alias replay, are retained separately. These remain development
inspection outputs, not reviewed quality scores or measured provider-usage
baselines. Draft publication is still disabled.

The compiled Jest suite exercises both informational kinds with exact indexed
citations, draft governance, restart/publication/search, replacement/privacy
invalidation, protected summaries/conflicts and durable family plans. Product
qualification tests separately cover detailed typed-state, contribution,
consolidation and publication recovery contracts.

## Canonical project briefs

QMSum preparation now groups named, transcript-verified AMI meetings into one
canonical project bundle. Project identity comes from the pinned AMI scenario
series, never from similar model-generated titles or shared remote-control
terminology. The earlier 32 QMSum outputs were query variants, not 32 projects.
The first five selected records belong to five different series; related
training meetings must be selected explicitly to cover their lifecycle.

The bundle's optional `project: {id, meetingIds}` must identify a project brief
with the same stable bundle ID and the exact ordered source IDs. For these
bundles, the runner ingests one meeting at a time and builds the **same view**
against all meetings admitted so far. It does not create another view for
each query or meeting. Later sources cannot enter earlier build snapshots.
Ordinary wiki/brief bundles retain their existing ingest-all/build-once behavior.

Each intermediate version is retained in
`revisions/<sequence>/{saved.json,rendered.txt,revision.json,source-mapping.json}`;
the final root artifacts describe the current canonical brief. The receipt
lists the stable project identity and successive revisions. All versions keep
original citations; all remain unpublished. Reopening the store exposes one
current project view with historical revisions. A replay still requires a new
owned root and is not a mutation of an arbitrary existing production store.

Consequential project updates are checked against the original indexed evidence
after merging human-protected edits. A rejected configured-model update gets
one bounded complete-brief repair using the same frozen evidence, followed by
structural validation, another human-edit merge and an independent check of the
actual merged output. Repeated rejection, invalid assessment, protected-edit
conflicts and cancellation still block materialization. No guard is disabled;
adapters without the project repair callback retain their existing rejection
behavior. Failure retains the previous accepted revisions and `failure.json`,
not a successful final receipt.

Default execution time is two minutes per meeting for canonical bundles; the
host API can still supply an explicit `timeoutMs`. Use the normal live command
with the canonical construction packet and its stable project ID:

```powershell
pnpm --filter wiki-views run wiki-views --mode live --input <canonical-construction.json> --case qmsum-ami-es2002 --root .runs\es2002-canonical --authorization <approval.json>
```

Dataset questions, answers, topic labels and reference spans remain separate
evaluation material. Canonical briefs require their own independently reviewed
project expectations; query-reference coverage is not a substitute for them.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.

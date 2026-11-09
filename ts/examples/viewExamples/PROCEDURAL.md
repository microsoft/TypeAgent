# Procedural memory-view example

A trusted, explicitly loaded **memory-view pack**, using the real
`FileMemoryService` and KnowPro index. The original fictional phone-support
fixture demonstrates prerequisites, safety guards, branching troubleshooting,
unknown observations, caller-confirmed verification, and terminal escalation.
It is not instructions for a real device.

## Run on Windows

From this directory, after the workspace has been restored and built:

```powershell
if (Test-Path $PROFILE) { . $PROFILE }
pnpm start
pnpm start --publish
pnpm test:local
```

Use the repository-supported Node version and standalone pnpm, not Corepack.
From the workspace `ts` directory, build with `pnpm run build`.

Each run creates a **new**, uniquely named [`.runs`](./.runs) directory.
It never reuses or deletes an existing memory corpus. The default builds an
unpublished draft. `--publish` explicitly admits publication **only in that
run's fictional corpus**; it is not permission to execute the procedure.
Results include `procedure.txt`, `view.json`, `result.json`, and durable memory.
The receipt distinguishes target state, published/indexed revision,
index readiness, search visibility, and verified restart.

## What is offline?

The default host uses an explicit **lexical topic extractor**, disabled
embeddings, and a language model that throws on any inference attempt.
KnowPro still performs real indexing and persistence. Literal-token view search
works; this is **not** production knowledge extraction, semantic retrieval,
prose extraction, or an answer-quality benchmark.

`runExample` in [host.ts](./src/host.ts) also accepts an explicitly supplied
`indexSettingsFactory`. A caller can inject approved real-ingestion settings
without changing the provider. That mode can make model/embedding requests:
obtain approval for access, source custody, privacy and spend **before calling
it**. The CLI deliberately does not load credentials or offer an implicit live
fallback. No new ingestion API is necessary for this example.

## Define a custom view

1. Implement the bounded graph contract in
   [contract.ts](./src/procedural/contract.ts).
2. Export a named factory through [pack.ts](./src/procedural/pack.ts).
   Host context requires a corpus ID, selected-source allowlist, and an explicit
   authorization callback. Scope is rechecked at lifecycle boundaries.
3. Declare static manifest/provider exports in [package.json](./package.json).
   List **every provider runtime asset** in [manifest.json](./manifest.json);
   this includes the compiled contract, implementation and [recipe](./src/procedural/recipe.txt).
4. Inspect the absolute package root, select the factory, load it with host
   context, then opt the service into `extensionBuilds`. Inspection is data-only;
   activation runs trusted code and is not a sandbox or a source-access grant.
5. Use `extensionViewId`, exact ingested revision selectors, the provider identity
   and explicit optimistic head/version guards. Build without publication.
6. Inspect the target result, read its exact saved revision, and validate every
   UTF-16 citation, input-use declaration and block binding.
7. Publish only with explicit approval and exact revision/head/version guards.
   A draft is not a search fallback.

Provider identity hashes pin the output schema, recipe and compiled
implementation. The installation fingerprint also covers package metadata,
manifest and raw runtime bytes. Changed assets require explicit reinspection;
changing an already imported package root requires host restart.
The API requires a positive model-call bound, so the deterministic descriptor
uses `1`; it has **no model** and always denies the `model` operation.

## Documented source format, not arbitrary prose

[connectivity.jsonl](./fixtures/connectivity.jsonl) is original `procedure-v1`
JSONL. The first nonblank line is exactly:

```json
{
  "schemaVersion": 1,
  "procedureId": "mock-connectivity",
  "title": "Fictional lantern connection support",
  "entryStep": "check-link"
}
```

Remaining lines are records:

| Kind                               | Required fields besides `kind` and unique `id`                             |
| ---------------------------------- | -------------------------------------------------------------------------- |
| `context`, `prerequisite`, `guard` | `text`                                                                     |
| `step`                             | `text`, `requiredInputs` (array), `expectedObservation` (string or `null`) |
| `transition`                       | `from`, `to`, `condition`                                                  |
| `outcome`                          | `text`, `result` (`resolved` or `escalated`)                               |

IDs are lowercase kebab-case, at most 64 characters. Text is bounded to 1,000
characters; required-input arrays to 10 entries; each source to 64 records.
The provider accepts up to four exact, complete sources with the same
`procedureId`, within its aggregate 120,000-character input limit.
No field is silently dropped or defaulted.

Transitions must start at steps and end at existing steps/outcomes. Every step
needs a nonempty guard; every graph node must be reachable; cycles and duplicate
IDs/conditions are rejected. An explicit terminal escalation is required.
`null` observations remain unknown. Natural-language conditions are displayed
as guidance, **not machine-executable predicates**.

The payload preserves each source's graph and stable, evidence-bound block IDs.
Each record cites its exact original JSONL line, with original UTF-16 offsets.
Full-source alternatives that disagree remain separate, are marked
`conflicted`, and carry opposition evidence. The provider never selects an
authoritative alternative or invents a resolution. Content validation
reconstructs the projection, rejecting changed instructions, qualifiers,
conditions, evidence, or presentation bindings.

## Action-level support guides

The opt-in prose factory extracts unordered alternatives as one `actionCollection`
and individually cited `action` records. A collection lists every option exactly
once and records `any-order` or `unspecified`, never an invented priority.
Each action retains its title, instructions, canonical action, information
requests, literal form instruction, generic interface parameters, within-option
sequence, selection condition and expected observation. Nullable fields mean
the source does not specify them; empty lists mean explicitly none.
Interface parameters are not promoted to scenario-required inputs.
The structured JSONL factory retains its original contract.

Source-defined workflows may instead use typed actions as guarded graph nodes,
with non-action steps where needed. Only source-supported ordering is represented;
overlapping conditions, external subflow referrals and unknown results stay
explicit. The reader shows readable branch endpoints and conditions, not a
manufactured linear checklist.

When a guarded graph would invent precedence or skip required instructions,
prose can use one `workflow` with `order: "partial-order"` and `nodeIds`
referencing every action, step and outcome exactly once. Cited
`orderingConstraint` records retain only source-defined `before`, `after` and
`condition` claims; execution transitions and collections cannot be mixed in.
Contradictory constraints may form cycles: each conflicting constraint requires
opposing evidence and an explicit source-gap record. The payload deterministically
reports `orderingConflictIds`; neither node listing nor constraints imply an
executable total order. Conditional alternatives are not made mandatory.
Agent JSON declares `action-collection`, `guarded-graph` or `partial-order`
topology. Structured JSONL retains its original strict acyclic rules.

All three structures use the fixed `procedure-guide-v1` template in Memory Hub:

- **Support guide:** concise action/decision cards, common rules and prerequisites,
  and concrete outcomes under **How to finish**. Source scope, full limitations
  and unknown terminal outcomes belong in **Evidence & gaps**. Applicable source
  conditions remain visible; generic descriptions do not imply applicability.
  Explicit any-order collections retain a short option-selection instruction
  when they cover the displayed actions.
  Related gaps sharing exact citation bindings appear as compact closed warnings
  beside actions/choices, with full gap text and pinned evidence links.
  Ordering/branch claims are collapsed evidence, not additional tasks.
- **For agents:** copyable typed JSON, stable block/source/revision IDs and
  exact supporting/opposing citation bindings.
- **Evidence & gaps:** the same claims with retained-source excerpts and an
  authorized full-original reader. Technical qualifications remain accessible.

  The prose output contract `support-procedure-graph-v6` adds source-grounded
  `decisionTable` records for choices that affect requests, form values or next
  actions. Each table has a title, concise text, 2-4 columns and 1-8 rows of equal
  width; `appliesTo` references 1-8 existing action IDs. Tables are comparisons,
  not graph nodes, execution branches or new policy. The structured JSONL factory
  does not accept them.

  The [generation instructions](./src/procedural/proseRecipe.txt) require each
  action once, concise human prose, complete typed fields, one source-defined closure and no
  duplicated verification limitation. Choice tables retain source qualifiers,
  overlaps and unknowns without recopying every comparison into action text.
  Coverage is checked across action text, typed fields and table cells together.
  These are generation requirements, not authority to resolve source conflicts.
  An explicit any-order source uses an unordered collection containing only its
  selectable options. Conditional apology/end instructions belong in the failure
  outcome, not an extra selectable wrap-up action. Explicit no-entry form notices
  remain in typed fields rather than the default human instruction.

  The shared reader renders tables as text, keeps verbose typed fields and
  citations under closed **Details and sources**, and moves relationship cards
  to **Ordering and branch evidence**. It recognizes those records in older
  saved layouts too, without modifying immutable payloads. Exact claim links
  expand ancestor disclosures before focusing. Fresh generation is necessary
  to add tables to old drafts; changing the reader does not rewrite them.
  Card sources use numbered references such as `[1]`, with stable numbers for
  exact retained source/revision/excerpt bindings. Supporting and opposing roles
  remain in accessible labels, tooltips and the evidence drawer.
  Generated summary, review and ordering notes are kept in the closed provider
  metadata disclosure rather than before the guide. This does not change saved
  content, pending review status or execution permissions.

  All three saved layouts represent every evidence-bound claim exactly once;
  the human reader projects operational content rather than source-analysis cards.
  The evidence reader and agent JSON retain all claims. The
  provider reconstructs both the payload and presentation on cold reads, rejecting
  tampering. No provider HTML, executable procedure controls, automatic publication
  or inferred payment-handling authority is introduced.

With the prior model/data approvals and verified ABCD cache, generate only a
fresh cart draft without rerunning the prediction comparison:

```powershell
if (Test-Path $PROFILE) { . $PROFILE }
pnpm live --approved-model-work --build-only --source shopping-cart
```

This run schedules no baselines or predictions. Its saved stages and draft
restart are verification of construction, not independent content evaluation
or evidence of improved task performance.

The pinned adapter additionally supports `slow-speed` (Website Too Slow),
`search-not-working` (Search Not Working), `initiate-refund` (Initiate Refund)
and `missing-item` (Missing Item). Generate all four in this order, in one new
owned corpus:

```powershell
pnpm live --approved-model-work --build-only --sources 'slow-speed,search-not-working,initiate-refund,missing-item'
```

`--source` and `--sources` are mutually exclusive; selected sources require
`--build-only`. Empty, unknown or duplicate selections fail. Additional example
flows do not change the frozen slow-speed/cart comparison or its four dev cases.
ABCD communication-only `N/A` instructions are retained without inventing a
machine action. Other buttons require explicit mappings to the pinned ontology;
generic parameter inventories are still not promoted to required inputs.
Missing Item's overlapping seven-day rules must remain visible, not silently
rewritten as disjoint conditions. Benchmark financial/default instructions are
retained as source policy, never real transaction authority.
Refund's conflicting starting instructions are retained rather than converted
into alternative paths that skip either action. Bare field lists are retained
without inventing requests to collect them; interface classifications remain
explicit metadata.

## Verification and packaging

The compiled tests cover malformed graphs, exact LF/CRLF/non-ASCII spans,
unknowns, retained guards, evaluator-selected branch paths, conflict preservation,
authorization, publication/search, restart, source replacement/forget,
cancellation and stale optimistic guards.
Prose tests additionally cover complete passage accounting, semantic rejection,
bounded repair, durable managed model requests, cold-read reconstruction without
inference and corpus/source revocation. Dataset tests check exact upstream
mappings, frozen selection bounds and separation of targets from model input.

[expectations.json](./test/expectations.json) is **evaluator-only**. It is never
ingested or read by the provider and is excluded from the packaged runtime.
Passing three authored routes demonstrates fixture graph conformance, not
next-action prediction on real dialogues or extraction quality.

After a run has created `.runs`, produce a local tarball without publication:

```powershell
pnpm pack --pack-destination .runs
```

Install its dependencies normally in the receiving host, inspect the extracted
absolute package root, and explicitly select `createProcedureProvider`.
The relocation test supplies host-installed dependencies and uses a separate
native Node process, not Jest's module resolver. Neither provider asset locates
its original checkout.

## Opt-in ordinary-prose extraction

[proseProvider.ts](./src/procedural/proseProvider.ts) exports the separate
`createProseProcedureProvider` factory. The structured parser remains the
default. Inject a `ChatModel`, a SHA256 model-configuration identity,
`approvedModelWork: true`, the corpus/source allowlist and authorization callback.
The service also requires a shared `informationalBudget`.

[proseContract.ts](./src/procedural/proseContract.ts) creates complete,
paragraph-based packets: at most 120,000 source characters, 128 passages,
12,000 characters per passage and 64 graph records. Oversized sources fail;
they are not silently truncated. Each passage needs represented support/opposition
or an explicit unused-material reason. Original UTF-16 locators remain intact.
The provider runs extraction and a separate source-semantic check through
managed `context.complete`, with one repair round and at most four model stages.
Native structured-output schemas constrain wrapper shapes and record kinds;
domain bounds and semantic checking remain mandatory. Canonical source action/
slot identifiers retain their exact spelling, including underscores.
Candidates, rejections, model attempts and acceptance checkpoints are durable.
Cold reads reconstruct the saved content without inference.

Unlike structured `procedure-v1`, prose can represent a source-defined
`unresolved` or `unknown` terminal outcome. It must not invent escalation,
successful verification, required inputs or action order. Conditions remain
natural-language guidance, not an executable protocol. Accepted receipts always
say `humanReview: "pending"`: a model check is not independent human review.
An unordered action collection may be one macro-step with separately grounded
action-detail context blocks. Its text must preserve multiple-action choice and
its exit guards must apply to the whole collection, not just one attempted action.
Graph acyclicity does not imply that the underlying workflow is acyclic.

## Approved development pilot

Only after explicit approval for configured-model requests and public-data
download/evaluation, run from this checkout:

```powershell
if (Test-Path $PROFILE) { . $PROFILE }
pnpm live --approved-model-work --approved-abcd-download
```

The flags acknowledge prior approval; they do not obtain it. The live CLI loads
existing TypeAgent model configuration, preserves native request capacity and
enforces bounded per-build/per-request budgets. It never prints configuration
credentials. Azure-backed configurations need an existing supported sign-in;
complete browser authentication interactively, never share tokens or device codes.
An agent environment may require process-local `AZD_NON_INTERACTIVE=false` for
an explicitly approved `azd auth login`.
Importing the live module is inert; programmatic `runApprovedPilot` also requires
`approvedModelWork: true` before it loads configuration or accesses files.

[abcd.ts](./src/abcd.ts) pins the MIT-licensed
[ABCD repository](https://github.com/asappresearch/abcd) to commit
`6b8700ce67c6b37b062dd7a60abc76d7ef832a97`, verifying guidelines, ontology,
v1.1 archive and license hashes. Downloads and receipts stay in ignored `.runs`;
no corpus is redistributed in Git. A verified existing cache needs no download.
Construction uses complete selected guidelines and action/slot schemas only.
Exact upstream JSON pointers, key/value distinctions, SHA256 values and retained
character offsets are saved separately. Irrelevant ontology personal-value
enumerations are excluded.

The pilot builds the original [prose fixture](./fixtures/connectivity-prose.txt)
and two site-troubleshooting flows. It freezes two development decisions per
flow before any completion. Model input contains only the delexicalized transcript
prefix **before** the target turn; scenario metadata, gold targets, rankings
and future turns stay evaluator-only.

The same configured model, complete history and budget contract compare:

- complete raw source, selected by oracle flow;
- an actual built-in troubleshooting-guide draft;
- the custom procedure graph.

The evaluator supplies the **full ontology action vocabulary**, not a per-flow
allowed-action mask. Per-flow membership is scored afterward from the guidelines.
The frozen four-case slice has empty gold slot lists; exact value agreement here
does not validate populated-slot prediction. A future pilot needs preselected
nonempty-slot and termination cases, independently reviewed gold and locked tests.

This is an **oracle-scoped, teacher-forced development representation pilot**,
not an end-to-end retrieval benchmark or whole-task rollout. ABCD site guidelines
allow actions in any order. Gold action agreement, exact slot-value agreement
and narrow source-action membership are separate metrics; membership is not
full policy validity, and a different allowed action need not be incorrect.
No independent extraction scorecard, holdout improvement or task-success claim
follows from model acceptance or this small pilot.

Each new live run saves `plan.json`, exact source/mapping receipts, build jobs,
available view versions, every scheduled prediction, model attempts/usage/token
reservations/latency/raw responses and `summary.json`. Exact saved views are
rechecked after service restart without inference. Failed or missing builds remain failures;
there is no representation fallback. Incomplete runs exit nonzero. Dollar costs
are not fabricated when the model interface does not report them.
The live runner retains lexical, non-model ingestion and disables publication.
No private documents, real procedure execution or voice tasks are authorized.

P0-P3 are verified offline. P4 extraction and the first P5 ABCD pilot are
implemented; independently reviewed extraction gold, larger/held-out evaluation,
FloDial terms, additional datasets and demonstrated improvement remain follow-up.
See the [implementation plan](../../../../codeDocs/TypeAgent/forAgent/investigations/completed/2026/2026-11-07_procedural-view-examples-and-implementation.md).

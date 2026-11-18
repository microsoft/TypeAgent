# Wiki admission decision-model experiment

This qualification-only experiment preserves the first-stage G0/G1/D1 matrix:

| Arm | Standalone admission                                                                                                            | Canonical contributions                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| G0  | Existing generative assessment, with full current pages                                                                         | Existing generative assessment and guards |
| G1  | Source-only generative utility choice; continue existing assessment unless evidence-only deferred                               | Unchanged                                 |
| D1  | Identical utility packet/criteria through native Azure `decision_1`; continue existing assessment unless evidence-only deferred | Unchanged                                 |

No experiment arm is enabled by default. Nomination and assessment page context
now include summaries, section headings and complete section bodies, including
content beyond character 6,000. The eight-candidate cap, scope filters, original
evidence checks, revision guards, canonical writing/repair and indexing remain.
An uncertain utility result continues the generative assessment. Provider,
context-budget and invalid-answer errors fail explicitly; they are not deferrals
or silent generative fallbacks.

Plain D1 remains **utility-gate v1** for historical compatibility. Explicit
`--d1-revision decision-first-v2` enables native decisions for full admission,
canonical selection/coverage, final source support, editorial acceptance,
completeness, consolidation compatibility/preservation, and optional inventory
auditing. Luna authors actual prose/repairs and conditionally authors source-bound
distinctions only when a subsequent decision needs them. Native answers select
host-supplied IDs; the host binds exact witnesses and fixed explanations.
Unrelated context cannot become a contribution or satisfy covered suppression.
Existing deterministic evidence/revision/human-edit guards remain authoritative.
Receipts, identities and campaigns record the treatment revision. Never relabel
or pool historical v1 results with v2.

Use `--writer-contract shared-prose-v1 --d1-revision decision-first-v2`
for a versioned shared-writer G0/D1 comparison. Both arms then use identical
Luna prose-only messages/schema on identical inputs. G0 classifies completeness
in a separate generative call; D1 uses native completeness. The contract is
recorded in campaign/trial/assessment metadata and adapter identities. This G0
has a different call structure from historical G0; never pool their timings.

Shared Wiki regeneration retains original indexed passages from eligible
unchanged source revisions, fingerprints the effective evidence, and checks
supported prior domain claims against actual replacement prose. Prior prose
is a claim checklist, not evidence. Revised, removed and excluded source
revisions are not retained, and are explicitly identified to the checker.
Every changed ordinary Wiki update is checked, not only keyword-triggered
consequential changes. Missing/uncertain preservation fails visibly before
replacement; existing correction, withdrawal, human-edit and publication
guards still apply. Complete evidence is never silently truncated.

V2 defaults quality to `decision-first-v2` (also explicitly selectable through
`--quality-mode`). The configured GPT-6/6.1 quality pool authors source facts;
native decisions assess support/criticality, full-Wiki fact coverage, per-page
ratings/defects, page-purpose pairs and both-order preference. All facts/pages
are audited; uncertainty and per-comparison failures remain explicit. Native
construction/quality model overlap is reported as correlated-error risk.
Independent human labels remain necessary for accuracy qualification.

Native source-ledger validation supplies complete hash-bound original sessions
with every fact batch, not just paragraph quotations. The recorded policy is
`ledgerSupportContextPolicy: complete-original-source-v1`. Missing sources,
changed hashes and quotes absent from the original source fail before inference.
Ledger requests contain at most four facts from one complete source to avoid
cross-session context and repeated-quote amplification. A source-support rejection
can trigger one source-bound artifact repair through the configured quality-author
pool. Native support, criticality and repair-fidelity checks must then pass; IDs,
source hashes and fact counts cannot change. A repair can select a first/last
paragraph witness; the host binds the exact contiguous source span, including all
intervening turns, when a compound fact needs more than one paragraph. Reversed
or unknown witness bounds fail. Unresolved rejection or provider
errors fail that history's ledger explicitly; later histories continue. No
incomplete ledger is used to score a Wiki, and no generative verdict fallback or
automatic fact dropping is allowed.

Coverage checks all actual prose witnesses from one complete Wiki at a time,
without duplicating page bodies and citations in the same request. Page ratings
and purpose matching retain full prose. Final preference consumes the complete
audited page/fact results rather than resending both Wikis. Full-source request
limits must be verified for every native pool member; an undeclared limit is not
permission to truncate source context.

## Prerequisites and authorization

- Build from the selected TypeAgent checkout's `ts` directory with standalone
  pnpm. Import the PowerShell profile first. Do not enable Corepack.
- Provision normal local configuration, production ingestion/view/embedding
  deployments, native Azure decision endpoints and explicit request
  input/context/output limits. No credentials belong in command arguments.
- Choose a configured **GPT-6 or GPT-6.1** judge pool, distinct from the Wiki
  writer **and GPT 6.1 Sol ambiguity-resolver pools**. Every judge-pool member must resolve to one of these families;
  older or unidentified models fail before inference. `--judge-endpoint` takes
  a configuration name, not a URL/key. The workflow below selects
  `GPT_6_1_TERRA`; use it only where that pool is already configured with
  explicit request limits. No new deployment is required. Endpoint separation
  is a harness role-isolation guard, not proof of unbiased or independent model
  accuracy. Never fall back to GPT-5.4-mini.
- Supply the pinned `longmemeval_s_cleaned.json`, official `evaluate_qa.py` judge
  source and the other machine's immutable five-question selection manifest
  containing `questionIds`. The dataset and official judge are hash-validated by
  the existing LongMemEval loader.
- Use a **new private directory outside every Git checkout** for every command.
  Raw histories, questions/gold, frozen stores, full pages, evidence, assessment
  receipts and model outputs are private artifacts, not codeDocs/Git content.
- Every command requires `--authorized-live-benchmark`. It authorizes real
  configured model/embedding requests within the explicit watchdog deadline.
  These commands are not offline accuracy evaluations.

The exact histories contain 44, 45, 47, 53 and 49 complete sessions respectively
(238 total): `d24813b1`, `4f54b7c9`, `c8090214`, `cc5ded98`, `eeda8a6d_abs`.
Questions/gold are stored separately and never used for Wiki construction.

## PowerShell workflow

Run from `ts`. Replace the private input paths and confirm the judge name is configured before execution.
Do not treat the example budgets as a spend approval.

```powershell
if (Test-Path $PROFILE) { . $PROFILE }
pnpm run build

$tsRoot = (Get-Location).Path
$reposRoot = Split-Path (Split-Path $tsRoot -Parent) -Parent
$archive = Join-Path $reposRoot ('memoryRunArtifacts\wiki-admission-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $archive | Out-Null
$inputs = Read-Host 'Private directory containing the pinned benchmark inputs'
$judge = 'GPT_6_1_TERRA'
$harness = '.\tools\memory-maintenance-qualification\wiki-admission-experiment.mjs'
$seeds = Join-Path $archive 'seeds'

pnpm run ci:node $harness prepare `
    --dataset (Join-Path $inputs 'longmemeval_s_cleaned.json') `
    --judge-source (Join-Path $inputs 'evaluate_qa.py') `
    --selection-manifest (Join-Path $inputs 'selection-manifest.json') `
    --cases 4f54b7c9,d24813b1 `
    --output $seeds --minutes 90 --authorized-live-benchmark
```

Preparation uses production durable batch ingestion, one source per original
session, with all automatic maintenance held. It checks ready original revisions,
zero maintained views/build receipts and no running maintenance. Services are
closed before byte-hashing each source-only store; independent copied stores must
cold-reopen with identical source identities/revisions and source-only retrieval.
The reopen invariant resolves the original indexed-text anchors and compares
exact expanded-content hashes. It does not rerun an LLM-interpreted query and
mistake ranked-result variation for changed index bytes.
By default all five histories are prepared. Explicit `prepare --cases` narrows
ingestion/freeze, not input validation: all five original histories and the
selection manifest are still validated in full. The manifest separately records
the validated selection and the actually frozen case IDs; the example freezes
89 sessions across the two comparison cases. Only after every selected case
passes is `seeds.json` marked `frozen`. Partial preparation
is evidence of failure, not a reusable seed. Existing destinations are never
overwritten.

If preparation fails after a history was fully ingested and byte-hashed,
`prepare --reuse-preparation <previous-private-output>` can recover those
source-only stores into a new output directory. Configuration, compiled product,
complete construction, original store hashes, import receipts, source eligibility
and no maintained views/builds are all revalidated. The new manifest records
recovery provenance and reruns the current probe policy; it does not rewrite or
declare the previous failed preparation successful. Changed product code or
source histories require fresh ingestion.

Run a Wiki-readiness diagnostic first. A single repetition is exploratory, not
qualification. Each command is capped at six hours; for a multi-stage campaign,
an outer controller must share one fixed six-hour deadline across preparation,
construction, replay and judging, retaining export/close reserve. The following
construction-stage allowance is not a separate six-hour campaign authorization.

```powershell
$diagnostic = Join-Path $archive 'wiki-diagnostic'
pnpm run ci:node $harness run --seeds $seeds --output $diagnostic `
    --scope wiki --cases 4f54b7c9,d24813b1 --arms G0,D1 `
    --d1-revision decision-first-v2 --repetitions 1 `
    --readiness-minutes 60 --minutes 240 `
    --judge-endpoint $judge --authorized-live-benchmark
```

Each trial gets a fresh independent seed copy. G0/G1/D1 order is alternated and
rotated across repetitions; `4f54b7c9` is attempted first. The same compiled
implementation and sanitized effective provider configuration must match
preparation. Harness-only changes can reuse frozen seeds: both the original seed
checkpoint and current execution checkpoint are recorded. Compiled product changes
require new preparation. No executable files may change during an active run.

Use `--counterbalance-cases` to also reverse arm order between adjacent histories
in a single-repetition pilot. The default preserves historical schedules. The
flag is recorded in the campaign; five histories give a 3/2 first-arm split,
not perfect balance. Two repetitions reverse that split and balance each paired
history's starting arm. A single repetition remains exploratory.

Use `--arms G0,D1 --repetitions 1` for an explicitly scoped first generative/native
decision pilot; the default remains all three arms. Omitting G1 sacrifices the
staging-only control and must be recorded, not described as the complete
three-arm qualification matrix. An outer controller may assign each stage only
the remaining allowance from one fixed aggregate deadline; otherwise `--minutes`
applies to that individual command.
Use `--cases 4f54b7c9,d24813b1 --arms D1` to run only the decision candidates
corresponding to two retained generative baselines. Readiness timeouts must not
exceed the product's 60-minute maximum.

Synthetic warm-up calls and their provider roles/receipts are separately labeled
`excluded-warmup:*` and excluded from measured assessment/readiness results.
Clone/reopen/probe time is also outside readiness timing. Services share the
normal maintenance model scheduler. Trials are sequential, not concurrent
competing campaigns. Individual acceptance failures and timeouts are retained,
and subsequent independent trials continue within the aggregate budget. Cancellation
stops further trials. Export/close failures or executable checkpoint changes stop
the campaign rather than risking contaminated comparisons. Common-input replay
also continues after individual call failures and honors `--arms`.
Unattempted trials remain explicit.
The watchdog reserves two minutes for cancellation, exporting evidence and close.
For diagnostic quality comparisons, `judge --include-failed-candidates` can
compare an exported failed candidate against a completed G0 baseline. The report
retains both statuses and sets `readinessComparable:false`; this does not convert
an acceptance rejection into a readiness success. `--cases` also limits source
checklists to the selected histories.

If G0 also failed, explicitly add `--include-failed-baselines` to judge its
exported partial Wiki diagnostically. Both flags are required when both arms
failed. Defaults still exclude failed controls. Comparisons retain both readiness
statuses, and either failed arm makes `readinessComparable:false`; snapshot
quality is not a successful-readiness speedup or an accuracy qualification.

After diagnostics pass, a separate `--scope full --repetitions 3` campaign runs
all required readiness families, answers the selected questions, and applies the
official answer judge. A complete 45-trial matrix can exceed 45 hours and cannot
fit this harness's six-hour command/campaign cap. It needs separately authorized,
balanced bounded batches rather than a larger `--minutes` value. Wiki-only
success never substitutes for full readiness or answer quality.

## Common-input replay and independent labels

Live constructions diverge after different admissions. Their decisions cannot
all be paired directly. Replay captured, complete assessment inputs against all
three arms without modifying a Wiki:

```powershell
$tape = Join-Path $diagnostic '4f54b7c9-G0-0\assessments.jsonl'
pnpm run ci:node $harness replay --tape $tape `
    --output (Join-Path $archive 'common-input-replay') `
    --minutes 360 --authorized-live-benchmark
```

Replay deduplicates common input hashes and writes a new assessment tape plus
`agreement.json`: confusion matrices, per-class precision/recall/F1, macro-F1
over reference-supported classes, conditional canonical/ambiguity/deferral-kind
agreement, utility deferral rates, p50/p95 logical/utility/full-assessment
latencies and paired common-input latency deltas. Failed calls and unattempted
work remain failures/missing measurements, not speedups.

Without independent labels, these metrics are explicitly **G0 agreement, not
accuracy**. For adjudicated accuracy, add `--annotations <private-json-path>`:

```json
{
  "adjudicated": true,
  "reviewerIds": ["independent-reviewer-a", "independent-reviewer-b"],
  "items": [
    {
      "requestHash": "<captured-common-input-hash>",
      "disposition": "defer",
      "canonicalViewId": "",
      "deferBasis": "evidence"
    }
  ]
}
```

Use the five host disposition labels. `covered`/`contribute` need the canonical
ID; `ambiguous` needs `ambiguousViewIds`; `defer` needs `evidence` or
`canonical-context`. Reviewer identifiers are opaque labels, not personal data.
Curate rare/counterexample inputs as well as common deferrals; do not mistake the
dominant deferral class or selectively annotated inputs for population accuracy.

## Independent blind Wiki judging

The explicit `--quality-mode generative-staged-v2` control uses the independent
GPT-6/6.1 judge pool to answer bounded, enum-only questions through the same
page/fact/purpose audit orchestration as the native evaluator. It does not use a
monolithic whole-Wiki response. Source support/criticality and coverage use
four-fact batches; every complete source and every complete Wiki page remain
available. Page scoring and purpose matching retain the actual query, aliases,
prior qualifications and complete citation metadata as well as prose. Coverage
witnesses are whole actual pages, so a compound fact is not
incorrectly restricted to one arbitrary 1,000-character chunk. Every fact is
accounted for in both blind orders. Host-selected IDs bind exact source/page
text, rather than asking the model to reproduce quotations or invent IDs.

This mode audits source support without dropping rejected or uncertain facts.
Those facts remain in the denominator with uncertain coverage on both sides.
Unknown criticality is conservatively critical. An uncertain page dimension is
an explicitly flagged lower bound of 1, not an estimated rating, and prevents
qualification. Source-audit transport/schema failures leave an incomplete ledger
receipt and prevent that history from proceeding. Neither repeated voting nor a
generative fallback changes any previous native rejection.

For identical fact denominators, `--ledger-source <live-quality.json>` and
`--ledger-source-hash <canonical-json-sha256>` reuse a previously live-authored
checklist. The host checks the artifact hash, complete construction hash, unique
fact IDs, original source hashes and exact quotations before re-auditing it.
This is explicit provenance-bound reuse, not offline quality injection.
`--include-censored-snapshots` allows diagnostic inspection of exported timeout
snapshots; it never makes them successful readiness pairs.
An explicitly composed diagnostic campaign can list `nonComparableCases` for
snapshots from different construction checkpoints. Even if both statuses are
complete, these cases have no paired latency reduction.

The new mode persists `scorecard.json` alongside `quality.json`. It separates
construction readiness, unresolved source facts, exhaustive coverage counts,
purpose recall, unrounded per-page dimension means and critical-loss alerts.
Only same-campaign successful pairs have a latency-reduction figure. A machine
gate failure is `NO-GO`; otherwise the pilot remains `HOLD` pending independent
accuracy labels, repetitions and the staging-only control. A model-scored pilot
can never self-certify a production `SHIP`.
Incomplete provider responses remain failures; Responses API receipts preserve
the provider's reason (including output limits or content filtering). The harness
does not convert such failures into verdicts or bypass content filters.

```powershell
pnpm run ci:node $harness judge `
    --campaign (Join-Path $diagnostic 'campaign.json') --seeds $seeds `
    --judge-endpoint $judge --output (Join-Path $archive 'blind-quality') `
    --minutes 360 --authorized-live-benchmark
```

Before reading page snapshots, the independent judge builds source-only fact
checklists from every complete original session, without questions/gold or
survivor-page selection. Exact source quotes are host-validated. Completed paired
Wikis are judged twice, with opaque A/B sides reversed, using full current pages,
their original indexed evidence, and every independent checklist fact. Missing
or empty Wikis are judgeable and cannot disappear from the quality denominator.
Checklist facts select a host-supplied original paragraph witness ID; the host
binds its exact unmodified text as the quote. The complete original source and
all paragraph witnesses are supplied, without truncation. Unknown IDs fail
explicitly. This avoids model-generated ellipses/paraphrases without normalizing,
deleting or accepting invented quotes; semantic support still requires review.
An independent source-checklist failure is recorded per history, without judging
that history against an incomplete checklist; other selected histories continue.
Provider content-filter rejections are preserved, not bypassed.

`quality.json` retains per-page and whole-Wiki 1–5 scores for usefulness,
support, completeness, scope, qualifications and citations; semantic
many-to-many purpose matches with reasons; exact source/page-bound defects;
all-fact coverage including critical omissions and uncertainty; reversed-order
disagreement; and history-macro dimension deltas. Stable-ID Jaccard in the campaign
is only an inventory diagnostic, never semantic accuracy. Semantic directional
precision/recall are judge-proposed purpose matches, still requiring adjudication.

Every page, score, quote and fact ID is validated. Complete serialized
requests must pass configured context budgets. Nothing is silently truncated.
A separately revision-bound page summary capturing main points is only the
documented backup if real context limits require a new, consistently evaluated
treatment; this harness does not automatically substitute summaries.

An independent LLM judgment is **not** human adjudication. Results always retain
`qualityQualified: false` until independent review and the design's live quality,
latency, readiness and answer gates are satisfied. There is no automatic
promotion or default model change.

## Evidence and validation

- `seeds.json`: complete construction, source inventory, tree hashes,
  cold-reopen probe, preparation timing and checkpoint/configuration identity.
- `evaluation.json`: private questions/references and pinned official templates,
  separate from construction.
- `campaign.json`: complete/not-attempted/failed/censored trial statuses,
  successful paired readiness deltas and stable-ID inventory overlap.
- Per trial: `benchmark.json`, `assessments.jsonl`, `model-calls.jsonl`, `snapshot.json`,
  `builds.json`, independent mutable `store`.
- Per command: owned watchdog/admission/termination artifacts, sanitized
  `provider-attempts.json`, result and excluded warm-ups where applicable.

Private `model-calls.jsonl` captures complete generative messages/schemas,
available serialized-request inspection, and raw responses before JSON or
evidence-contract validation. Rejected outputs and repair attempts therefore
remain inspectable. Warm-up completions use `warmup-model-calls.jsonl`, not the
measured tape.
Blind checklist/quality requests and raw responses, including rejected output,
are retained separately in private `judge-calls.jsonl`.

Logical timings include scheduler waits and validation/repair. Provider attempt
spans and build sub-stages can overlap: do not sum them into stage wall time.
Do not estimate a population readiness p95 from only five histories.

Structural tests use synthetic sources and injected models, **not quality or
latency evidence**:

```powershell
pnpm run ci:node --test .\tools\memory-maintenance-qualification\quality-wiki-admission.test.mjs
Push-Location .\packages\memory\service
pnpm run jest-esm --runInBand --testPathPattern='(wikiAdmissionExperiment|wikiAdmission|wikiContribution|informationalWiki|viewSynthesisStructural)[.]spec[.]js'
Pop-Location
```

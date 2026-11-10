# Informational-view campaign contract v1

Local P3 contract/scorecard tooling for original, FreshWiki and QMSum Product
construction packets. Quality evaluation matrices accept only `execution: "live"`
arms. Offline injected outputs are excluded from memory-approach evaluation;
deterministic tests remain regression checks, not quality evidence.
This tooling does not execute ingestion, synthesis, acquisition,
publication, maintenance or a model judge. It does not import or call the frozen
fixture loader, alter the pilot, read evaluator assets implicitly or interpret
keyword overlap as truth.

## Integration APIs

Import from `quality-view-campaign.mjs`:

- `validateConstructionPacket(packet) -> constructionHash`
- `validateCampaign(campaign, packet) -> campaignHash`
- `validateCampaignRun(run, campaign, packet) -> runHash`
- `campaignSchedule(run) -> slots`
- `validateIngestionMapping(mapping, packet) -> Map`
- `validateCampaignWitness(witness, bundle, mappingMap)`
- `validateCampaignOutputs(packet, campaign, run, outputs, mapping) -> runHash`
- `validateExampleRunArtifacts(packet, {receipt, saved, rendered, sourceMapping,
requestEvidence}) -> diagnosticReport` takes **exact UTF-8 file strings** from
  the example runner, including writer-appended newlines.
- `scoreCampaignArtifacts(packet, campaign, run, outputs, annotations, gold,
review, mapping) -> scorecard`
- `campaignRatio(numerator, denominator)` returns a null denominator/value when
  there are no targets. `campaignContract`, `coverageMetrics`, `telemetryKeys`
  are exported constants.

Identities reuse `quality-contract.mjs`: `sha256(text)` is the UTF-8 byte hash;
`identity(value)` hashes `JSON.stringify(value)`. Artifact hashes deliberately
use **identity of the exact string**, not a parsed/reformatted JSON object.
Property order matters for object identity. Freeze and retain exact packets,
campaign, run, mapping, gold, review, outputs and annotations; the scorecard
records each identity. Missing artifacts and usage are explicit `null`.

### Construction packet (adapter boundary)

Canonical project bundles may additionally carry
`project: {id, meetingIds}`. The ID must equal the project-brief bundle ID and
the meeting IDs must exactly match its ordered source IDs. A canonical project
is one campaign case even when its runner saves several successive revisions.
QMSum query variants remain separate evaluator records with `canonicalViewId`
joins; do not treat those questions as distinct projects or automatically turn
their reference answers into canonical-project gold.

```js
{
  schemaVersion: 1,
  purpose: "construction-only",
  dataset: "original", // or freshwiki / qmsum-product
  release: {
    repository: "original-authored",
    revision: "v1",
    files: [{ path: "sources.json", sha256: rawFileHash }],
    license: "MIT"
  },
  bundles: [{
    id: "project-alpha",
    kind: "projectBrief", // or wiki
    query: "Project Alpha",
    aliases: [],
    sources: [{
      id: "update-1", version: "dataset-v1", title: "Update",
      text: retainedText, sha256: sha256(retainedText),
      // Optional verified authoredAt, provenance object, coordinateMap array.
    }]
  }]
}
```

The schema rejects unknown construction fields; it cannot detect concealed
reference prose inside arbitrary text/provenance. The acquisition/integration
owner must enforce custody and permitted source provenance. Empty source
inventories represent availability shortfalls, not evidence. Coordinate maps
remain adapter metadata, never invented service locators.
Adapter releases may also retain a reviewed structured license:
`{id, terms, reviewed: true, underlying?: [{id, terms, reviewed: true}]}`.

### Campaign and separately frozen run

```js
const campaign = {
  schemaVersion: 1,
  contract: "informational-view-campaign-v1",
  id: "alpha-development",
  constructionHash: identity(packet),
  dataset: packet.dataset,
  phase: "development",
  seed: "selection-seed",
  exclusions: [],
  inventory: [
    {
      id: "project-alpha",
      clusters: {
        source: ["update-1"],
        topic: [],
        project: ["alpha"],
        meeting: [],
      },
    },
  ],
  thresholds: null,
};
const run = {
  schemaVersion: 1,
  campaignHash: identity(campaign),
  id: "run-1",
  startedAt: "2026-11-07T12:00:00Z",
  permissionRecordHash,
  caseIds: ["project-alpha"],
  generations: 2,
  arms: [
    {
      id: "built-in",
      execution: "live", // approved real-model execution only
      sourceCommit,
      patchHash,
      configurationHash,
      providerSettingsHash,
      promptHash,
      schemaHash,
      indexHash,
      eligibleSourcesHash,
      nodeVersion,
      provider,
      model,
      indexGeneration,
      configurationIdentity,
    },
  ],
  budget: { calls: 0, tokens: 0, cost: 0 },
};
```

Inventory is variable and must match every construction bundle. A run may
schedule a subset; every case/arm/positive generation yields one slot with
`id = JSON.stringify([armId, caseId, generation])`. Save this schedule **before**
execution. No delimiter collisions, quotas, fixed pilot generation count or
holdout access are introduced. Cluster identities are owner-assigned; use one
meeting cluster for all queries on that meeting and whole-project clusters for
evolving revisions. Separate datasets/phases require separate packets.

External development can expose descriptive scores with `thresholds: null`,
but never qualifies quality. External confirmation requires preregistration:

```js
thresholds: {
  status: "preregistered", registeredBy: "evaluation-owner",
  registeredAt: "2026-11-07T10:00:00Z", rubricHash, calibrationRecordHash,
  metrics: [{
    metric: "briefTypedAccuracy", direction: "minimum",
    value: explicitlyCalibratedThreshold, nonRegressionMargin: 0
  }]
}
```

Registration must precede `run.startedAt`; these declarations are hash-bound,
not a trusted timestamp service. Allowed metric names are `structural`,
`citations`, `supportedClaims`, `selectedQualification`,
`preservedQualification`, `wikiFullReference`, `wikiAccessibleReference`,
`briefQueryCoverage`, `briefTypedAccuracy`, `renderedDelivery`, `attemptSuccess`,
and `criticalErrors` (count, normally a maximum). No external pilot thresholds
are silently copied. Non-regression margins are retained declarations; this
scorecard does not infer comparable baseline differences or conduct blinded
comparisons. Offline injected arms are rejected during run validation and
scoring, including matrices that mix live and offline arms.

`validateExampleRunArtifacts` remains a separate structural/citation diagnostic
for runner artifacts. Its output is not an evaluation arm or semantic score.
Live runner artifacts also need actual provider request/usage capture and
independent reviewed annotations before they can support a quality scorecard.

### Actual ingestion join and evidence receipts

```js
const mapping = {
  schemaVersion: 1,
  constructionHash: identity(packet),
  records: [
    {
      caseId: "project-alpha",
      sourceId: "update-1",
      sourceVersion: "dataset-v1",
      corpusId: "owned-corpus",
      ingestedSourceId: "actual-source",
      revisionId: "actual-service-revision",
      contentHash: sha256(retainedText),
      retainedText,
    },
  ],
};
const witness = {
  sourceId: "update-1",
  sourceVersion: "dataset-v1",
  corpusId: "owned-corpus",
  ingestedSourceId: "actual-source",
  revisionId: "actual-service-revision",
  quote: exactOriginalQuote,
};
```

Dataset versions are never interpreted as memory revision IDs. Mappings may be
partial for failed ingestion, but every used gold/claim/evidence witness needs a
mapping. Identical meeting revisions may be shared by multiple query cases.

Capture selected passages and `getSourceContent({indexedLocator, ...})` receipts
against retained revisions:

```js
const passage = {
  corpusId,
  sourceId: actualSourceId,
  revisionId: actualRevisionId,
  locator: `indexed:${blockOrdinal}:${sha256(blockText)}:${start}-${end}`,
  excerpt: blockText.slice(start, end),
  blockText,
};
const row = {
  ...campaignSchedule(run)[0],
  status: "ok", // failed / missing, independently of targetDisposition
  stage: "complete",
  component: "informationalProject",
  reason: "Completed",
  targetDisposition: "admitted",
  targetViewId,
  saved: exactContentJsonString,
  rendered: exactRendererString,
  serializedRequest: exactRequestString,
  hashes: {
    savedHash: identity(exactContentJsonString),
    renderedHash: identity(exactRendererString),
    serializedRequestHash: identity(exactRequestString),
  },
  selectedEvidence: [passage],
  citationResolutions: [{ ...passage, resolvedText: exactResolvedExcerpt }],
  telemetry: { calls, tokens, reservations, latencyMs, cost },
};
const outputs = {
  schemaVersion: 1,
  runHash: identity(run),
  mappingHash: identity(mapping),
  records: [row],
};
```

`saved` may be the content JSON (`revision.content`) or the **exact complete
ViewVersion JSON**. Complete versions additionally bind corpus/view/revision
identity and a positive version number. Annotation hashes always bind the exact
retained string, never a reserialized content projection.
Save durable job/revision/lifecycle receipts in the runner separately.
Capture all citation resolutions, including selected source/version, exact
block hash and UTF-16 range. Construction coordinate maps do not replace them.
Offline validation verifies receipt consistency, not whether a service call
really happened; execution-owner provenance remains necessary.

Every scheduled slot requires a row, stage/component/reason and disposition.
Failed/missing artifacts may be null or retained partial strings, with exact
hashes. Telemetry has all five keys, each measured nonnegative value or `null`;
failed-call usage must not become zero. A retained request can earn selection
coverage even if rendering failed, while preservation and attempt gates fail.

### Gold and human annotation boundary

Adapter reference articles/answers/spans are **not** semantic gold. Under
evaluator custody, the owner converts accessible spans to explicit expectations
and independently reviews requirements, facts and actual revision witnesses:

```js
const gold = {
  schemaVersion: 1,
  constructionHash: identity(packet),
  cases: [
    {
      id: "project-alpha",
      expectations: [
        {
          id: "accountable-owner",
          metric: "briefTypedFact",
          requirement: "Accountable owner remains unassigned",
          critical: true,
          accessible: true,
          witnesses: [witness],
        },
      ],
    },
  ],
};
const review = {
  status: "approved-independent-human-review",
  constructionHash: identity(packet),
  goldHash: identity(gold),
  author: "expectation-author",
  reviewer: "independent-human",
  reviewedAt: "2026-11-07T11:00:00Z",
};
const annotation = {
  id: row.id,
  status: "approved-independent-human-review",
  author: "output-owner",
  reviewer: "independent-human",
  reviewedAt,
  goldHash: identity(gold),
  mappingHash: identity(mapping),
  hashes: row.hashes,
  allVerifiableClaimsReviewed: true,
  savedConsistent: true,
  claims: [
    {
      id: "claim-1",
      artifact: "rendered",
      quote: exactOutputQuote,
      supported: true,
      critical: true,
      errors: [],
      rationale: "Independently verified",
      witnesses: [witness],
    },
  ],
  expectations: [
    {
      id: "accountable-owner",
      selected: true,
      preserved: true,
      correct: true,
      requestQuote: exactSelectedQuote,
      outputQuote: exactOutputQuote,
      savedQuote: exactSavedQuote,
      rationale: "Independently verified",
      witnesses: gold.cases[0].expectations[0].witnesses,
    },
  ],
};
const annotations = {
  schemaVersion: 1,
  runHash: identity(run),
  goldHash: identity(gold),
  records: [annotation],
};
```

Review **every externally verifiable saved and rendered claim**, not just gold
targets or favorable sentences. The complete-review attestation is an explicit
human responsibility; software cannot prove semantic claim segmentation.
Each supported claim needs original witnesses; unsupported claims have a
rationale and error categories (`attribution`, `status`, `date`, `correction`,
`unknownState`, `citationRevision`). No string matching certifies support.
`correct` denotes reviewed factual correctness; `preserved` denotes rendered
delivery. Coverage counts correct preservation only. Exact quote matching
verifies identity, not truth.

Every gold expectation must receive a verdict on attempts with any retained
artifact. For request-only failed attempts, claims may be empty; `selected` may
be true but `preserved`/`correct` are false. No-artifact attempts have no
annotation. Empty gold lists expose unknown denominators, not perfect coverage.
Full wiki reference targets can be `accessible: false` with no witnesses and
false verdicts; those count in full-reference coverage but not accessible
coverage. Other targets require accessible retained-source witnesses.

FreshWiki bridge: independently define reference-topic targets and annotate
accessible-source answerability. QMSum bridge: convert inclusive-turn adapter
spans to witnesses, define query-summary targets separately from independently
reviewed typed owner/status/date/decision facts. Do not manufacture typed gold
from reference summaries or missing project metadata.

## Scorecard interpretation and delivery status

Wiki coverage has full-reference and accessible-evidence-conditioned
denominators. Brief query coverage and typed accuracy are independent. Selected
qualification versus correct rendered preservation diagnoses retrieval versus
synthesis omissions. Structural diagnostics check built-in construction,
wiki exact page/index/consolidation identity and brief role/details unions,
nullable owners/dates, independent project/incident/capacity states, and risk
questions only in risk details. Readable title/summary/body delivery is separate.

Original synthetic acceptance enforces 100% structural/citation validity across
**all attempts** and zero critical unsupported facts. This is not a model
quality claim. Readable title/summary/body delivery must also pass. External gates additionally require explicit thresholds; failures
cannot qualify. Supported-claim precision is conditional on annotated claims;
unknown-claim attempt counts and failure rates prevent concealing missing runs.
Unknown claim denominators block live quality qualification.
Telemetry includes known totals and unknown-attempt counts, never imputations.
Cluster summaries are descriptive, per arm; no confidence interval,
independence assumption or causal/blinded comparison is invented.

Implemented: pure campaign/run/mapping/artifact/review validation, stored-content
diagnostics, human-bound scorecards and safe offline CLI. Tested: identity/gold/
revision binding, full schedules/duplicates, critical errors, exact citations,
unknown telemetry/denominators, selection/rendering failures, typed unions,
threshold registration and owned-path protections.

Deferred to integration owners: P1 service receipt capture, P2 licensed
acquisition and independently reviewed dataset bridges, P4 lifecycle execution,
P5 approved live campaigns/quality review. No external assets or holdouts were
read and no quality results for unrun campaigns are claimed.

## Existing example-runner artifact bridge

The runner retains `saved.json` as an exact ViewVersion, `rendered.txt`,
`source-mapping.json` as an array, `request-evidence.json` as ViewBuildSnapshot
arrays, and `receipt.json`. Pass those five files as exact strings:

```js
const diagnostics = validateExampleRunArtifacts(packet, {
  receipt: exactReceiptFile,
  saved: exactSavedFile,
  rendered: exactRenderedFile,
  sourceMapping: exactSourceMappingFile,
  requestEvidence: exactSnapshotFile,
});
```

This validates receipt/bundle/file hashes, mapped dataset source versions and
actual ingestion revisions, snapshot target/pipeline identity, selected
passages against retained construction text, saved structural contracts and
readable delivery. Receipt hashes are SHA-256 of the **exact artifact file
bytes, including the final LF**; exact string identities are also reported.
Alternate pre-final-LF payload hashes are rejected. Whitespace is not trimmed
or reserialized for identity checks.
Source-mapping arrays convert to the canonical mapping shape without guessing
source versions, revision IDs or retained bytes.

The current service snapshot `input.contentHash` hashes the retained content
descriptor, not necessarily the construction text. The bridge preserves this
hash separately and does not fabricate a descriptor or assert it equals the
source byte hash. Snapshot passages bind actual source/revision IDs and exact
excerpts. Without retained original block/resolution receipts, service
citation-resolution verification, block-hash verification and descriptor-hash
verification remain explicitly **not retained**.

The bridge produces diagnostics only: `qualityBaseline: false`,
`productionQualityEligible: false`, `semanticQualityEvaluated: false`,
`serializedRequest: null` and all five campaign telemetry values `null`.
Measured receipt elapsed time is reported separately as `runnerElapsedMs`, not
provider latency. Injected counters are not model calls/tokens/cost. Snapshots
are never labeled wire prompts. Even a live example receipt remains ineligible
for production-quality scoring until approved production artifacts and review
are separately captured. The campaign scorer explicitly refuses a top-level
`requestEvidenceKind: "indexed-build-snapshot"` or example
`qualityBaseline: false` relabeled as a live arm. Offline campaign scorecards
remain permitted structural/human-review diagnostics, never model-quality
baselines.

The dedicated CLI accepts the runner's existing `.wiki-views-owned.json` marker
(`{schemaVersion: 1, owner: "wiki-views"}`); no new marker, copied artifact or
input rewrite is required. Only `--construction` is project-relative in this
command; the five runner artifacts and new report are root-relative.

```powershell
node tools\memory-maintenance-qualification\quality-view-campaign-cli.mjs validate-example `
  --root examples\viewExamples\.runs\my-owned-run `
  --construction examples\viewExamples\.data\construction.json `
  --receipt receipt.json --saved saved.json --rendered rendered.txt `
  --source-mapping source-mapping.json --request-evidence request-evidence.json `
  --out artifact-validation.json
```

## CLI and targeted validation

Create a new **project-local** owned root and ownership marker yourself. Keep
raw assets, gold and runs under evaluator filesystem custody, outside committed
source. CLI never initializes or cleans roots.

```powershell
node tools\memory-maintenance-qualification\quality-view-campaign-cli.mjs --help
node tools\memory-maintenance-qualification\quality-view-campaign-cli.mjs validate `
  --root .owned-view-run --construction construction.json --campaign campaign.json `
  --run run.json --outputs outputs.json --mapping mapping.json --out validation.json
node tools\memory-maintenance-qualification\quality-view-campaign-cli.mjs score `
  --root .owned-view-run --construction construction.json --campaign campaign.json `
  --run run.json --outputs outputs.json --mapping mapping.json `
  --gold gold.json --review review.json --annotations annotations.json --out scorecard.json

if (Test-Path $PROFILE) { . $PROFILE }
node --test tools\memory-maintenance-qualification\quality-view-campaign.test.mjs `
  tools\memory-maintenance-qualification\quality-view-campaign-cli.test.mjs
pnpm exec prettier --check tools\memory-maintenance-qualification\quality-view-campaign.mjs `
  tools\memory-maintenance-qualification\quality-view-campaign.test.mjs `
  tools\memory-maintenance-qualification\quality-view-campaign-cli.mjs `
  tools\memory-maintenance-qualification\quality-view-campaign-cli.test.mjs `
  tools\memory-maintenance-qualification\quality-view-campaign-README.md
```

`validate` checks identity/schedule/receipt shapes, not semantic quality; `score`
loads only explicitly named approved evaluator inputs. `--help` reads nothing.
All paths are relative to cwd/owned root; absolute paths, parent traversal,
symlinks/junctions, frozen fixture/holdout paths and credential filenames are
refused. Reports use exclusive creation and refuse overwrites.

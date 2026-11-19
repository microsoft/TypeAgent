# Informational-view campaign contracts v1 and v2

Local P3 contract/scorecard tooling for original, FreshWiki and QMSum Product
construction packets. Quality evaluation matrices accept only `execution: "live"`
arms. Offline injected outputs are excluded from memory-approach evaluation;
deterministic tests remain regression checks, not quality evidence.
The contract/scoring CLI never executes ingestion, synthesis, acquisition,
publication, maintenance or a model judge. The separate authorized executor below
uses the existing example runner; it is never invoked by validation/scoring.
Neither path imports or calls the frozen
fixture loader, alter the pilot, read evaluator assets implicitly or interpret
keyword overlap as truth.

## Isolated multi-arm execution (v2)

V1 remains readable and scoreable unchanged. Its ingestion mapping supports one
actual retained revision per case/source/version, so it must **not** be used to
join independently owned arm/generation stores. Use these explicit versions:

- Campaign: `schemaVersion: 2`, `contract: "informational-view-campaign-v2"`.
- Run, outputs, gold and annotations: `schemaVersion: 2`.
- Mapping: `schemaVersion: 2`, `contract: "informational-view-ingestion-v2"`.
  Every mapping record additionally has `attemptId`, exactly the scheduled slot
  ID. Actual evidence and reviewed output claims are scoped to that attempt.
- Gold witnesses contain only `{sourceId, sourceVersion, quote}`. This allows
  original-source gold to be reviewed before ingestion, without relabeling
  memory revision IDs between arms. Annotation expectation witnesses must match
  that gold exactly. Supported **output claims** still use actual corpus/source/
  revision witnesses; construction selection is joined through the attempt mapping.

Import `snapshotCampaignImplementation(productRoot)` and `executeCampaign(spec)`
from `quality-campaign-execution.mjs`. `productRoot` is an absolute `ts` directory
in a separately built, frozen checkout. The snapshot hashes source and compiled
runner, memory, client, conversation, AI-client, configuration and KnowPro files,
plus the source commit and tracked patch. Its `promptHash` and `schemaHash` define
those arm fields. Freeze transitive runtime settings in the existing run fields.
All arms must contain the compatible recorder/CLI integration; backporting that
integration must not silently change a historical arm's generation behavior.

From each configured checkout, the following performs **no inference** and emits
only non-secret provider/model names and identity hashes:

```powershell
node examples\viewExamples\dist\cli.js --runtime-identity
```

For Azure chat endpoints without an explicit `modelName`, the model identity is
the configured deployment label from the endpoint path. It is not independently
verified underlying model identity. Endpoint hosts and credentials are not
printed; the provider-settings hash still binds the complete endpoint setting.
An endpoint with neither an explicit model name nor an Azure deployment label
retains an unknown identity and cannot satisfy a frozen campaign declaration.

Use its `nodeVersion`, `configurationIdentity`, `configurationHash` and
`providerSettingsHash` in that arm. Each configured pool member must have the
declared provider/model; unknown or mixed bindings fail rather than inheriting a
label. The child checks the expected runtime **before dispatch**, and the
coordinator checks the retained runtime and implementation again afterward.
`arm.eligibleSourcesHash` is `identity(packet)`.

The execution specification contains:

| Field                       | Contract                                                                                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project`, `root`           | Project directory and existing project-relative owned campaign directory. The CLI uses its current directory as `project`.                                                              |
| `packet`, `campaign`, `run` | Frozen construction-only packet and matching v2 campaign/run. No gold or reviewer labels enter the runner.                                                                              |
| `bindings`                  | One `{id, productRoot, implementationHash: identity(snapshot), declaredArm}` per arm; `declaredArm` must exactly equal the frozen arm.                                                  |
| `timeoutMs`                 | Positive integer per-child timeout.                                                                                                                                                     |
| `requestBudget`             | Positive integer `inputTokens`, `outputTokens`, `safetyTokens`, `elapsedMs`, and `tokenizer: "utf8-bytes-v1"`. This is a conservative byte-based token reservation, not measured usage. |
| `authorization`             | Explicit non-secret owner approval described below.                                                                                                                                     |

Authorization is an attestation, not authentication. It contains `approved: true`,
`identity`, `approvedAt`, `campaignHash`, exact `caseIds`, `armIds`, `generations`,
`budget` (equal to `run.budget`), `bindingsHash`, `requestBudgetHash`, `timeoutMs`,
and a positive owner-approved conservative `maxCostPerCall`.
`run.permissionRecordHash` must equal `identity(authorization)`. Approval must
precede `run.startedAt`; hashes/timestamps are declarations, not a trusted clock.
The per-call monetary ceiling must be justified by the owner for the configured
providers and maximum request sizes. It is **not** a billing estimate or a price
verified by this tool.

The root requires the ownership marker described below. Execution is explicit:

```powershell
node tools\memory-maintenance-qualification\quality-campaign-execution.mjs --spec <project-relative-owned-spec.json>
```

The executor persists the complete schedule before starting the first child.
Every arm/case/generation gets a new example-local owned store. Calls, reserved
tokens (including safety reservation), and conservative per-call cost reservations
are bounded before dispatch and shared across successive children. Failure,
unknown accounting or exhaustion stops new slots; failed and unattempted slots
remain in the reconciled schedule. Partial artifacts survive.

`execution.json`, `outputs.json`, and `mapping.json` are durable results;
`partial-artifacts.json` preserves completed prefixes. Root files are never
replaced by another execution. Existing runner receipts remain diagnostics, not
quality evidence: the bridge additionally requires live non-injected execution,
exact admitted requests, exact saved/rendered bytes, original indexed block and
service citation-resolution receipts. Usage and billed cost remain unknown when
not actually measured.

Output rows can include `checkpointArtifacts`, contract
`memory-view-checkpoint-artifacts-v1`: the exact schedule string and one record
per checkpoint containing its scheduled fields plus exact `saved`, `rendered`,
and `evidence` strings or null. `hashes.checkpointArtifactsHash` binds this entire
object. Accepted prefixes are not reclassified if a later update/export fails.

## Reviewed measurements and release assessment

These are extensions of this campaign tooling, not a model judge or a separate
benchmark. Import `scoreCampaignMeasurements` and `scoreReviewedTopicSnapshot`
from `quality-campaign-measurements.mjs`; import `assessCampaignRelease`,
`scoreCampaignUsefulness`, and `validateSplitIsolation` from
`quality-campaign-release.mjs`.

The measurement rubric has `schemaVersion: 2`,
`contract: "informational-view-measurements-v2"`, `constructionHash`, `goldHash`,
and a complete `cases` inventory:

- `facts`: every gold expectation exactly once, with `id`, positive reviewer
  `importance`, `required`, and `answerable`. Only required answerable importance
  enters weighted coverage. Selected coverage and correct rendered preservation
  are separate; unavailable facts cannot be declared answerable.
- `ordering`: reviewed `{id, before, after, witnesses}` constraints between
  distinct gold fact IDs. Original-source witnesses justify the ordering.
  Omitted edges mean incomparable/tied items, not an invented total priority.
- `checkpoints`: every scheduled source-update sequence with `expectations`
  containing `{id, kind, requirement, witnesses}`. Kinds are `newFactUptake`,
  `staleFactRemoval`, `unaffectedFactPreservation`, and
  `protectedEditPreservation`. Future sources cannot witness an earlier update.

The matching measurement packet has the same version/contract, `outputsHash`,
`rubricHash`, and one reviewed record per scheduled slot:

- `hashes` equals the exact output artifact hashes.
- `ordering` labels bind each constraint ID to `before`/`after` rendered spans
  `{start, end, quote}`, or null for missing output. Exact offsets establish
  delivery order, not semantic correspondence; reviewers own that judgment.
- `allCaveatsReviewed: true` and `caveats` with `id`, exact `span`, `relevant`,
  `redundant`, and `rationale`.
- `checkpoints` bind exact captured `sequence`, terminal `status`, `stage`,
  `saved`, `rendered`, and `hashes: {saved: identity(saved), rendered: identity(rendered)}`;
  absent artifacts have null hashes. Every checkpoint needs
  `allVerifiableClaimsReviewed: true`, `claims`, and every expectation's
  `{id, satisfied, rationale, span}` verdict. Supported claims require original
  actual-revision witnesses; preservation/uptake verdicts require rendered spans.
  Stale removal remains an explicit reviewed semantic verdict, not a substring
  test. The final accepted checkpoint must equal the delivered artifacts.

Rubric review and each record's `review` use
`{status: "approved-independent-human-review", artifactHash, author, reviewer,
reviewedAt, adjudicated: true, adjudicationRecordHash}`. Author/reviewer must
differ. `artifactHash` binds the rubric, or the whole record **excluding** its
`review` property. Reviews are externally supplied human attestations; test
fixtures and model-generated labels do not establish independent review.

The scorecard first recomputes existing structural/citation/all-claim scoring.
It then reports weighted coverage, ordering, caveat relevance/non-redundancy,
maintenance metrics and every checkpoint's supported claims/critical errors.
It also separates construction/repair attempts, provider failures, completion
failures, first-pass checkpoints, terminal failures and unattempted checkpoints.
Empty denominators and missing telemetry are unknown, never perfect/zero.

Topic evaluation remains separate from summary usefulness: pass actual `nodes`,
`curation.concepts/memberIds`, `curation.deferred/nodeId`, and a complete
`hierarchy` edge inventory `{id, child, parent}`. Existing adjudicated topic
annotations supply admission/group labels; add a complete hierarchy verdict
inventory with `acceptable` and `rationale`. Review binds `{snapshot, annotations}`.
The scorer reuses existing admission/pair scoring for membership, false merges/
splits and separately reports hierarchy acceptability. It rejects duplicate or
unknown membership, incomplete admission/deferral and selectively reviewed edges.

Offline CLI additions use the existing owned-root and exclusive-output rules:

- `score-measurements`: all `score` flags plus `--rubric`, `--rubric-review`,
  `--measurements`.
- `assess-release`: those flags plus `--registration`, `--registry`,
  `--confirmation`, `--rollback`, `--blinded`, `--usefulness-review`.
  Explicit JSON null files for unavailable latter evidence produce a
  **not-qualified** assessment; they do not fabricate success.

Release registration is `contract: "memory-view-release-v1"`,
`status: "preregistered"`, `registeredAt`, `registeredBy`, `campaignHash`,
`runHash`, `rubricHash`, `splitRegistryHash`, `baseline`, `candidate`,
`maxCostPerCall`, `usefulnessMinimum`, `analysis`, and `metrics`.
`analysis` freezes `clusterKind`, `minClusters` (at least two), integer `seed`,
`resamples` (at least 100), and `confidence` between zero and one. Metrics contain
`metric`, `direction` (`minimum`/`maximum`), `threshold` and
`nonRegressionMargin`; supported-claim precision and both weighted coverage
gates are mandatory. Whole-run identity freezes cases, generations, budgets and
arms before execution. Provider/model/settings/index/evidence identities must
match across the comparison; identical treatments do not establish improvement.

The split registry, contract `memory-view-split-registry-v1`, contains
`development` and `confirmation` inventories with `id`, source content
`sourceHashes`, and all four cluster arrays. Source content, source-family,
topic, project, meeting and case overlap across splits is rejected. The chosen
analysis unit must partition cases without overlap through another cluster kind.
Repeated generations are averaged within clusters before paired bootstrap
intervals; unknown pairs and insufficient independent clusters cannot qualify.
No protected contents are needed to maintain this metadata registry.

Blinded usefulness, contract `memory-view-blinded-usefulness-v2`, binds
`outputsHash`, `armsHiddenFromReviewers: true`, complete `assignments` and
`judgments`. Pair IDs are `JSON.stringify([caseId, generation])`. Assignments
contain `first`/`second` exact rendered-string hashes; judgments contain
`verdict: "first" | "second" | "tie"` and a rationale. Identical artifacts must
tie. Keep assignments/arm identities away from reviewers; blinding is a human
custody responsibility and the separate independent review binds the packet.

Confirmation needs `status: "custodian-approved-untouched-confirmation"`,
`registrationHash`, `runHash`, and a custodian distinct from the registering
owner. Rollback needs `status: "tested-compatible"`, `recipeHash`,
`compatibilityTestRecordHash`, `qualificationRecordHash`, and true protections:
`allSuppliedCitationIds`, `finalFactualRejection`, `publicationProof`,
`legacyServing`, `acceptedRevisionSurvivesFailure`.

Release assessment rejects missing evidence, failures/critical claims at any
checkpoint, missing dispatch/reservation accounting, exceeded registered
budgets, failed precision/coverage/usefulness/non-regression gates, confirmation
leakage and rollback that disables factual protections. Original protocol
fixtures cannot qualify production quality. A passing result means only
**qualified for an owner rollout decision**; no publication, deployment,
automatic rollback, credential provisioning or protected-data access occurs.

## Exploratory AI review

`quality-ai-review.mjs` provides a separate development-only review contract.
Pass the service's canonical `informationalAuditFields` inventory, original
sources, selected indexed evidence, and `citationFragments` copied from the exact
captured synthesis request's `fragments` array (including IDs, source IDs,
revision IDs and text). The v4 helper requires each captured fragment to match
the indexed evidence and original source bytes. Never infer aliases from
selected-evidence order: maintenance exports can accumulate historical duplicates
that are absent from the actual synthesis request. Host metadata is excluded from
source-claim scoring; factual typed states and authored relationships remain
eligible. Production `f0`/`f1` aliases resolve through explicit source bindings,
while rubric facts and prohibited inferences have separate ID namespaces.
Required facts need exact original witnesses. A prohibited inference can simply
be absent: no disclaimer is required. The validator rejects incomplete
inventories, unknown authorities/references and empty fact rubrics.

These are fallible AI opinions, not independently reviewed gold. Keep production
failures, checker/report failures, rejected checkpoints and unattempted suffixes
separate from review metrics. Compare factual results only over declared
comparable artifacts; surviving-field totals are not paired quality scores.
This helper cannot satisfy independent-review, confirmation or release gates.

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

### Exact multi-call request capture

Existing v1 rows remain supported. An output row may additionally carry:

```js
requestCapture: {
  contract: "memory-request-capture-v1",
  manifest: exactRequestCallsJsonFileString,
  requests: [
    { file: "calls/000001/request.json", body: exactAdmittedBodyString }
  ],
  // Required for any call declaring a completion result.
  results: [
    { file: "calls/000001/result.json", body: exactCompletionResultString }
  ],
}
```

The manifest must name the row's case, contract/schema version and
`requestEvidenceKind: "admitted-dispatch-body"`. Every call has a unique ID and
body file, checkpoint, operation, SHA-256 body hash, outcome and nullable measured
usage. Every named body must be supplied exactly once and match its raw SHA-256.
Bodies must be individual JSON objects without authentication headers.
The output and annotation hashes additionally require
`requestCaptureHash: identity(row.requestCapture)`, binding exact manifest and
body strings. The legacy `serializedRequest` remains one actual admitted
construction/repair body from this manifest, never concatenated requests.
Calls may additionally declare `result: {file, hash}`. Every declared completion
result must be supplied exactly once and match its raw SHA-256. A successful
model completion remains untrusted output, not proof of artifact acceptance;
the checkpoint and saved-revision receipts determine that separate outcome.
Rows labeled `ok` cannot contain unfinished captured dispatches. Partial captures
may describe failed/missing attempts but cannot be promoted to successful output.

Selection checks use original fragments in allowlisted informational construction
and contract-repair operations only, not audit prompts or rejected-output prose.
Provider JSON escaping is decoded from Chat Completions messages or Responses
input before matching original fragment text. Unknown construction envelopes fail
explicitly rather than silently receiving selection credit.

This extension supplies capture evidence, not an execution coordinator, semantic
judge or complete token/cost ledger. Arm, generation, provider, prompt/schema and
settings identities remain bound by the frozen campaign run. A returned dispatch
can be an HTTP error; unavailable completion usage and failed-call cost remain
unknown. Legacy indexed-build snapshots remain nonqualifying diagnostics.

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

The authorized v2 executor supplies service receipts and lifecycle accounting;
the measurement/release extensions supply reviewed metric and decision contracts.
Still required from integration/evaluation owners: licensed approved assets,
independently reviewed gold/labels, protected confirmation custody, calibrated
preregistration, explicit model budgets and actual approved live comparisons.
Engineering tests do not supply those assets or establish prompt improvement.

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

# Wiki and project-brief dataset preparation

These **pure adapters and offline preparation commands** do not download data,
crawl references, make model requests, run a factual judge, load frozen fixtures,
or read evaluator holdout files. The separate, explicitly approved acquisition
command below fetches only exactly pinned primary dataset assets. Tests use
original inline fixtures and injected HTTP responses, not public corpus samples.
The existing quality CLI, frozen pilot and example package are unchanged.

## Pure APIs and packet identity

```javascript
prepareFreshWiki(assets, plan);
prepareQMSum(assets, plan);
// assets: [{ path: "relative/pinned/file", bytes: Uint8Array }]
// result: { construction, evaluator, availability, manifest }
```

Both functions verify exact raw asset bytes against pins before parsing. They
are synchronous and have no filesystem/network dependencies. A new external
inventory is not sent through the immutable 24-case pilot validator.

Construction is exactly:

```javascript
{
    schemaVersion: 1,
    purpose: "construction-only",
    dataset: "freshwiki" /* or "qmsum-product" */,
    release: {
        repository, revision, files: [{ path, sha256 }], license
    },
    bundles: [{
        id, kind: "wiki" /* or "projectBrief" */, query, aliases: [],
        sources: [{
            id, version, title, text, sha256,
            // Optional verified authoredAt; provenance and coordinateMap.
        }]
    }]
}
```

`release.revision` must be a full lowercase 40-hex repository revision, never
`main`. Asset paths are normalized to slash-separated repository-relative
identities; filesystem commands use native Windows paths. Absolute paths,
traversal, empty path segments and alternate data streams are rejected.
`release.files[].sha256` hashes raw asset bytes. `source.sha256` hashes the
retained **UTF-8 bytes**, not JSON quoting or an object identity. UTF-8 decoding
is fatal on malformed bytes; a retained BOM and CRLF are preserved. Text with
unpaired UTF-16 surrogates is rejected, not silently replaced.

`manifest` includes `schemaVersion`, `dataset`, `release`, `custody`, `cases`,
`planHash`, `constructionHash`, `evaluatorHash`, `availabilityHash`. Object hashes
use the existing `identity`: SHA256 of `JSON.stringify(object)`, key-order
sensitive. These hashes bind packet objects, not pretty-printed disk files.
Cases have stable IDs, whole-topic/meeting `clusterId`, dataset paths/raw hashes,
and development/confirmation split. QMSum also retains `officialSplit` and
`recordIndex`. Repeated queries are not independent meetings. This preparation
manifest is not the separate campaign/scoring contract.

Pass **only `result.construction`** to generators. The other three objects are
preparation/evaluator custody artifacts, never generator fields.

## Plan shared fields

```javascript
{
    schemaVersion: 1,
    dataset: "freshwiki", // or "qmsum-product"
    custody: "development", // pure API also accepts "confirmation-evaluator"
    release: {
        repository: "https://publisher.example/repository",
        revision: "<full pinned 40-hex revision>",
        files: [{ path: "json/topic.json", sha256: "<raw-byte SHA256>" }],
        license: { id: "<license>", terms: "<reviewed terms or terms URL>", reviewed: true }
    },
    selection: [{ path: "json/topic.json", recordIndex: 0, split: "development" }]
}
```

Selection must be explicit and nonempty, with no duplicate path/position.
Confirmation requires `custody: "confirmation-evaluator"` and
`split: "confirmation"`. The pure API can be invoked by an evaluator over
their authorized assets; **this CLI refuses confirmation custody**. No frozen
holdout export/import is implemented.

Terms review is an explicit caller attestation, not legal clearance inferred
from a repository license. QMSum additionally requires
`release.license.underlying: [{id, terms, reviewed: true}]` for the underlying
meeting corpus terms, such as AMI. FreshWiki supporting snapshots each need
their own reviewed license/terms. Unknown/missing pins, versions, terms,
selection, schema conventions and malformed records fail explicitly.

## FreshWiki

Each selected file is one JSON article (`recordIndex: 0`) with `title`, `url`,
`summary`, `content[]`; sections have `section_title`, `section_content[]`;
sentences have `sentence` and `refs`. The title is retrieval intent. Summary,
section prose and references are evaluator-only.

Supporting sources are explicit plan entries, never web-search substitutions:

```javascript
sources: [
  {
    id: "source-1",
    url: "https://source.example/document",
    availability: "available",
    path: "snapshots/source-1.txt",
    sha256: "<raw hash matching release.files>",
    version: "snapshot-v1",
    title: "Supporting document",
    license: {
      id: "<source license>",
      terms: "<reviewed source terms>",
      reviewed: true,
    },
    // Optional authoredAt: ISO timestamp with explicit timezone,
    // and required authoredAtEvidencePath: a pinned metadata asset.
  },
];
```

An unavailable source needs `id`, `url`, `availability`, `reason`, not invented
text. States are `dead-url`, `paywall`, `denied-access`, `unresolved`,
`not-acquired`. Reference diagnostics additionally include `empty-refs`,
`malformed-refs`, `malformed-ref`, `opaque-ref`, and `available`.
Availability rows bind case, section, sentence and reference position when
present, with URL/reason/resolved source ID as applicable.

**No reference schema is guessed.** Without `referenceSchema`, nonempty opaque
references (including URL-looking strings and objects) remain `opaque-ref`.
Known string-array schemas require caller-verified, pinned schema evidence:

```javascript
referenceSchema: {
    format: "url-string-array", // or "id-string-array"
    evidenceVerified: true,
    evidencePath: "schema-evidence.txt",
    evidenceSha256: "<matching release.files raw hash>"
    // idToUrl: { "reference-id": "https://source.example/document" }
    // Required only for id-string-array, from verified pinned schema evidence.
}
```

The adapter verifies evidence custody/hash and the declared representation,
not the semantics of arbitrary evidence prose. The preparation owner must
verify this declaration against the pinned publisher schema. Object-shaped refs
or another schema are unsupported rather than guessed. No corpus or schema was
downloaded to implement these tests.

Only matched, explicitly available supporting snapshots enter construction.
The target article URL and any selected article asset are prohibited as
supporting sources. An evidence-empty article remains in the inventory with
`no-available-evidence`, not a silently successful or omitted attempt.

Identical retained content is deduplicated per topic, using the first matched
source identity and retaining all distinct snapshot provenance, versions and
terms. Copies are not independent corroboration. Every snapshot keeps its raw
hash; the canonical source hash binds retained text.

FreshWiki `coordinateMap` is an identity UTF-16 interval:
`{coordinate:{kind:"source",start:0,end:text.length},retainedStart:0,retainedEnd:text.length}`.
No line-ending or Unicode normalization is performed.

`authoredAt` is absent without pinned supplied metadata. Chronology is
`unknown` or `verified-source-metadata`; temporal confounds remain `unknown` or
`not-assessed`. Acquisition time is not source time. These adapters do not claim
historical validity of current snapshots.

Evaluator cases are `{id,reference:{title,url,summary,content},references}`.
Accessible-evidence-conditioned claim coverage requires independent annotation;
the adapter does not turn reference sentences into verified expected facts.

## QMSum Product

Selected paths must be exactly `data/Product/jsonl/train.jsonl` or
`data/Product/jsonl/val.jsonl`. Development retains official train, confirmation
retains official validation, and test remains unused. Empty internal JSONL
records are rejected. The local CLI reads development only.

`prepareQMSum` / `prepare-qmsum` produces **one canonical project brief per
verified AMI scenario series**, not one brief per dataset question. Pin the
original named meeting JSON files as well as the training JSONL. Each selected
record additionally declares its `meetingIdentityPath`:

```javascript
selection: [{
    path: "data/Product/jsonl/train.jsonl",
    recordIndex: 0,
    split: "development",
    meetingIdentityPath: "data/Product/train/ES2002a.json"
}],
projectGrouping: {
    kind: "ami-scenario-series",
    evidenceVerified: true,
    evidencePath: "project-order.txt",
    evidenceSha256: "<matching pinned raw hash>"
}
```

The preparation owner must verify the AMI series and relative a/b/c/d scenario
order against original metadata before attesting the evidence. The adapter
checks the evidence pin, official split, named original identity and exact
complete serialized transcript match. Missing evidence, unassigned records,
mismatched originals and duplicate meeting identities fail; common words such
as "remote control" never establish shared project identity.

Project IDs such as `qmsum-ami-es2002` and meeting source IDs such as
`qmsum-ami-es2002a` remain stable across release revisions, selected record
positions and query changes. Sources are ordered by the verified scenario
suffix. Each bundle includes
`project: {id, meetingIds: [<ordered source IDs>]}` and a project-level query.
All original query references remain evaluator-only with `canonicalViewId`
joins; the manifest separates project cases from `queryVariants`. Reference
answers are not canonical-project gold or independent project counts.

`prepareQMSumQueries` / the explicit `prepare-qmsum-queries` command retains
the earlier query-variant evaluation behavior. Its IDs derive from release
revision, official split, record position, query family and query position.
Do not put those variants in a canonical-project gallery or count them as
independent projects.

The plan additionally requires:

```javascript
spanConvention: {
    kind: "zero-based-inclusive", evidenceVerified: true,
    evidencePath: "span-convention-evidence.txt",
    evidenceSha256: "<matching pinned raw hash>"
}
```

The owner must verify the pinned upstream convention before attesting
`evidenceVerified`; tests attest only their original fixture convention, not
an uninspected public corpus. Missing evidence or another convention fails.

Every ordered `meeting_transcripts[]` speaker/content turn is retained:
`[index] speaker\ncontent\n\n`. There is no token cap, gold-span-only selection,
calendar inference or inferred project identity.
The query-variant adapter does not group meetings: its neutral title has
`titleOrigin: "adapter-context"` and `chronology: "unknown"`. Canonical source
titles instead expose verified meeting identity and relative scenario order;
provenance retains the original identity file/hash and grouping evidence.
Neither path supplies `authoredAt` from undocumented date-like record fields
or converts relative sequence into wall-clock timestamps.

In explicit query-variant mode, each query creates a bundle containing the **same complete
meeting source**, with the real query as retrieval intent. Answers, topic labels
and relevant span labels never enter construction.

Exported helpers:

- `serializeQMSumTranscript(turns)` returns `{text,coordinateMap,turnMap}`.
- Coordinate entries are
  `{coordinate:{kind:"turn",turn,field:"speaker"|"content",start:0,end:field.length},retainedStart,retainedEnd}`.
  Offsets are half-open UTF-16 code units, not bytes or code points. Inserted
  headers/separators have no original field coordinates.
- `turnMap` entries are `{turn,start,end}`, spanning the inserted header,
  speaker and content, excluding that turn's trailing two newlines.
- `mapQMSumSpans(spans,source,turnMap)` maps **every** zero-based inclusive
  `[first,last]` turn interval, accepting exact nonnegative decimal strings or
  integers. It rejects fractional/reversed/out-of-bounds intervals. The final
  turn is included. CRLF, non-ASCII and surrogate-pair content remain exact.

Evaluator cases are
`{id,answer,queryFamily,topics,witnesses,relevantTextSpan?}`. Witnesses contain
`sourceId`, `version`, `sha256`, half-open retained `start/end`, exact `quote`,
and specific-query `turnSpan:{first,last,convention:"zero-based-inclusive"}`.
General-query witnesses cover the whole transcript. These dataset coordinate
maps are **not memory-service citation locators**.

The evaluator must join dataset source/version/hash to actual ingestion
corpus/source/revision, independently review accessible expected facts and
qualifiers, and produce the separate campaign gold packet. Adapter reference
answers and mapped spans are not independent typed-state gold or an automatic
factual score.

## Explicit local CLI and acquisition boundary

Run from the selected project root in PowerShell:

```powershell
if (Test-Path $PROFILE) { . $PROFILE }
node tools\memory-maintenance-qualification\quality-view-data-cli.mjs --help
node tools\memory-maintenance-qualification\quality-view-data-cli.mjs prepare-freshwiki --input .\examples\viewExamples\.data\freshwiki-assets --plan .\freshwiki-plan.json --output .\examples\viewExamples\.data\freshwiki-prepared
node tools\memory-maintenance-qualification\quality-view-data-cli.mjs prepare-qmsum --input .\examples\viewExamples\.data\qmsum-assets --plan .\qmsum-plan.json --output .\examples\viewExamples\.data\qmsum-prepared
node tools\memory-maintenance-qualification\quality-view-data-cli.mjs prepare-qmsum-queries --input .\examples\viewExamples\.data\qmsum-assets --plan .\qmsum-plan.json --output .\examples\viewExamples\.data\qmsum-query-variants
```

Input must already have `.quality-view-data-owned.json`:
`{"schemaVersion":1,"purpose":"pinned-local-assets"}`. Pin relative asset paths
inside this input directory. The CLI reads only selected data and required
schema/snapshot/metadata assets, not all release inventory files. Unused
validation/test inventory hashes are retained without reading those files.
Official validation/test reads, frozen/evaluator/holdout/profile paths,
symlinks/junctions, traversal, overlapping roots and existing output paths are
rejected. Both input and plan must be below the explicit project root.

Output must be a **new direct child** of project-local `.quality-view-data` or
the example's ignored `examples\viewExamples\.data` directory (preferred).
The CLI writes an ownership marker and `construction.json`,
`evaluator-only.json`, `availability.json`, `manifest.json`. It never overwrites
an existing run. Failed validation creates no output; failed writes clean up
only the directory this invocation created.
`runPreparation(options, {projectRoot})` returns
`{output,bundles,constructionHash,manifestHash}`; the CLI prints that receipt.
Both receipt hashes use object identity, not on-disk file bytes.

Keep raw assets and outputs outside Git, using owner-configured local Git
exclusions or an already ignored project-local area. The CLI does not edit
`.gitignore` or repository configuration. Filesystem custody/access controls
must be applied by the owner: separate output files are **not access control**.
Transfer only `construction.json` to implementation/generation workers.
Cleanup is explicitly targeted at the new run's ownership-marked directory;
no production/profile directory discovery or broad cleanup is implemented.

### Separately approved pinned acquisition

**No acquisition was run while implementing or testing this command.** The
preparation APIs above never invoke it automatically. There is no crawler,
publisher-source copying, search replacement, login/access-control bypass,
credential flow, implicit authorization, live generation or publication.

From `ts`, the explicit command is:

```powershell
node tools\memory-maintenance-qualification\quality-view-data-cli.mjs acquire-pinned-assets --manifest .\acquisition-request.json --authorization .\acquisition-approval.json --output .\examples\viewExamples\.data\freshwiki-assets
```

The request JSON must list every exact URL, repository revision, relative
destination path, independently pinned raw hash, byte ceiling and reviewed
terms:

```javascript
{
    schemaVersion: 1,
    purpose: "pinned-dataset-acquisition",
    dataset: "freshwiki", // or "qmsum-product"
    release: {
        repository: "https://huggingface.co/datasets/EchoShao8899/FreshWiki",
        revision: "<full lowercase 40-hex revision>",
        license: { id: "<license>", terms: "<reviewed terms>", reviewed: true },
        files: [{
            path: "json/<selected-topic>.json",
            url: "https://huggingface.co/datasets/EchoShao8899/FreshWiki/resolve/<same-revision>/json/<selected-topic>.json",
            sha256: "<independently verified raw-byte hash>",
            maxBytes: 1048576,
            license: { id: "<asset terms>", terms: "<reviewed terms>", reviewed: true }
        }]
    }
}
```

For QMSum the repository must be `https://github.com/Yale-LILY/QMSum` and URLs
must be exactly
`https://raw.githubusercontent.com/Yale-LILY/QMSum/<revision>/<path>`.
Underlying meeting terms are mandatory in the release license as above.

Supported paths are deliberately bounded:

- FreshWiki: selected `json/<topic>.json`, `topic_list.csv`, `README.md`.
- QMSum Product: `data/Product/jsonl/train.jsonl`, named
  `data/Product/train/(ES|IS|TS)<four digits><a|b|c|d>.json` identity assets,
  `README.md`, `LICENSE`. Individual `all`, validation and test copies remain
  forbidden.
- FreshWiki may use one HTTP 307 hop to its same-publisher `api/resolve-cache`
  path for the exact pinned repository revision and asset. Changed hosts,
  revisions/assets, credentials, fragments and additional redirects are refused;
  raw SHA-256 and byte ceilings are still verified on the final response.
- No validation/test, arbitrary source publishers, archived mirrors, bulk
  repository cloning, recursive links or replacement URLs.
- Between 1 and 16 files, each with an explicit limit of at most 64 MiB,
  with a combined maximum envelope of 128 MiB.

The separate non-secret approval JSON must be:

```javascript
{
    approved: true,
    identity: "<non-secret approving owner/record identity>",
    scope: "dataset-acquisition",
    datasetAcquisition: true,
    sourceTermsApproved: true,
    requestHash: "<identity(exact acquisition-request object)>"
}
```

`validateAcquisitionManifest(request)` returns that key-order-sensitive object
hash; `authorizeAcquisition(approval,requestHash)` rejects absent approvals,
missing identity, wrong scope or a changed request. Approval is a custody
attestation, not an authentication token. Do not include secrets in either file.

`runAcquisition(options,{projectRoot,fetchAsset?})` is a separately invoked API.
The default HTTPS transport uses `redirect:"error"`, `credentials:"omit"` and a
30-second request/body abort signal. Only HTTP 200 with the exact requested
response URL is accepted. Redirects, access errors, network errors, oversized
responses and raw-hash mismatches fail closed, with no fallback or retry against
another URL. Files are written only after hash validation. Failure removes only
the new directory created by that invocation.

The destination must be a **new direct child** of the existing example's
`.data` directory. A successful run writes original bytes, the pinned-local
ownership marker and `acquisition-receipt.json` containing the exact request,
raw pins/terms, request hash and non-secret approval. The return/printed receipt
is `{output,files,requestHash}`. An existing destination is never overwritten.
Use that destination as the explicit `--input` for subsequent preparation;
copy the acquisition release pins into the preparation plan.
Preparation projects `release` down to repository/revision/path/raw-hash/terms,
and retains only permitted construction sources, never article references or
QMSum answers/gold.

**Precise remaining blocks:** the owner must supply authentic pins and reviewed
terms before acquisition can run. Hosts that redirect to signed/CDN locations
(other than the one exact same-publisher immutable cache hop above), require authentication or
return non-200 access responses are blocked by this transport. Supporting
FreshWiki publisher snapshots must still be separately acquired under their
own permissions and provided locally; this command never copies their articles.
There is no confirmation/holdout acquisition command in this implementation.

## Validation

```powershell
if (Test-Path $PROFILE) { . $PROFILE }
node --test tools\memory-maintenance-qualification\quality-freshwiki.test.mjs tools\memory-maintenance-qualification\quality-qmsum.test.mjs tools\memory-maintenance-qualification\quality-view-data-cli.test.mjs
```

The existing root `test:memory-quality` wildcard includes all three new test
files without script changes. Fixtures and CLI test workspaces are original,
project-local and cleaned up. Passing these tests establishes preparation and
custody contracts only, not dataset/model quality.

# Wiki native-schema replay

Opt-in, component-only comparison of native `decision-1`, generative
`gpt-6-luna` with native-shaped answers, and the same Luna endpoint/messages
with typed choices only. The replay tool changes no product defaults, prose writers,
host reducers or memory stores. This tool does not recover a missing historical
dataset, qualify Wiki readiness or treat native agreement as correctness.

## Fresh live cohort when the archive is unavailable

The separate fresh driver creates **new** data rather than reconstructing
historical requests:

```powershell
if (Test-Path $PROFILE) { . $PROFILE }
$absoluteUtcDeadline = (Get-Date).ToUniversalTime().AddMinutes(90).ToString('o')
node tools\memory-maintenance-qualification\wiki-schema-fresh.mjs `
  --output $newPrivateDirectory --deadline $absoluteUtcDeadline --live
```

The parent directory must exist and the output directory must not. The driver
uses six complete public repository READMEs: conversation memory, storage, image
memory, memory MCP server, memory client and configuration. It records full source
text, revision and hashes, generates six drafts with the current production
informational Wiki synthesis adapter, then creates six new factored bounded
requests per allowed decision family. Purpose/editorial/consolidation rules come
from current production modules. These are experiment-owned contracts, not
captures from the missing historical adapter or an end-to-end memory evaluation.

Controlled variants include unchanged prose, a foreign summary, empty explanatory
prose, final-section deletion, a duplicate page and a distinct peer. Original
source evidence is never truncated. These variants are not automatically treated
as correctness labels. Native captures establish the observed answer-field
profiles; their choices and scores are never included in Luna caller messages.

A single 90-minute absolute window and 420-logical-call ceiling cover authoring,
native capture and replay together. With the current configured Wiki adapter,
the expected total is 375 calls: six authoring, six restricted completeness,
36 native profile captures and 327 replay calls. There are no reviewer calls or
outcome retries. Raw captures, reservations, immutable inventory/protocol, failure
receipts and results are saved privately outside source control. Source groups
overlap across the pilot and reserve, so the latter is additional diagnostic
coverage, not a source-disjoint holdout. The normal replay limitations below apply.

The configured service now defaults bounded Wiki decisions to strict choice-only
Luna answers; see [service behavior](../../packages/memory/service/README.md#bounded-wiki-decisions).
That host integration is separate from replay. Historical replay measurements
must not be presented as end-to-end validation or latency for the new integration.

## Input prerequisites

For historical replay, use recovered original caller requests and native
responses, not reconstructed prompts or model-authored replacements. For a fresh
cohort, use the separate mode above and preserve its explicitly new provenance.
The original experimental Wiki adapter and raw archives are not included here.
Do not copy raw user conversations or credentials into the repository. Use a
private local artifact directory.

An inventory JSON object has:

- `schemaVersion: 1`, `sourceRevision` (40-character original implementation
  commit), `driverHash` (original driver SHA-256).
- `packets`: deduplicated captured requests, at least six per family in one
  wrapper `cohort`. Families are `utility`, `admission`, `coverage`, `editorial`,
  `completeness`, `consolidation`. Open-ended authoring, topic curation and Sol
  ambiguity arbitration are not eligible.
- Each packet: unique `id`, `family`, `cohort`, `sourceGroups`, `requestJson`,
  `requestHash`, `nativeAnswers`, `origin`, and optional `labels`.
- `requestJson` is the unchanged serialized `DecisionRequest`, containing only
  `state` and `questions`. Preserve state strings, question/criterion ordering,
  aliases and complete evidence/pages. `requestHash` hashes these UTF-8 bytes.
- `nativeAnswers` is the archived full typed answer map, not a choice-only
  downstream projection. Confidence presence is frozen per question from it.
- `origin` has `file` (absolute or relative to the inventory), `sha256` (file byte
  hash), `recordId`, `requestPointer`, `answersPointer` (RFC 6901 JSON pointers).
  Pointers select the original request object or serialized string and the native
  answer map. Byte hashes and pointer equality are checked before any dispatch.
- Optional `labels[questionId]`: `choice`, boolean `critical`, `provenance`, and
  `kind`: `deterministic-control`, `human-adjudicated` or `model-review`.
  Model review remains a signal, never human gold.

Source-overlap groups must include every known shared passage/subject/revision
family. The importer is responsible for faithful operation classification,
grouping, original driver/commit provenance and full evidence. Hash verification
proves identity with the supplied archives, not their authenticity or source
completeness. The runner does not infer operation families from source prose.
Non-choice requests must be separately inventoried; this version rejects them.

## Offline validation and freezing

From the TypeScript workspace in PowerShell, with the user's profile loaded:

```powershell
if (Test-Path $PROFILE) { . $PROFILE }
node --test tools\memory-maintenance-qualification\wiki-schema-replay.test.mjs
$inventoryHash = (Get-FileHash $inventory -Algorithm SHA256).Hash.ToLowerInvariant()
node tools\memory-maintenance-qualification\wiki-schema-replay.mjs `
  --mode prepare --inventory $inventory --inventory-hash $inventoryHash `
  --seed wiki-schema-v1 --output $newProtocolDirectory
```

`$inventory` names the recovered private inventory; `$newProtocolDirectory` must
not already exist. Preparation validates all archive hashes and native answers,
but never initializes model endpoints or dispatches inference. It freezes 24
pilot packets, 12 confirmation packets and both output-schema hashes. Each family
includes the shortest and longest input plus two seeded hash-ranked packets.
Confirmation selects two remaining seeded packets per family. Selection never
uses correctness or prior disagreements. Overlapping pilot/confirmation source
groups label confirmation `additional-diagnostic`, not a source-disjoint holdout.

## Explicitly approved live execution

After review of the frozen protocol, use its printed byte hash:

```powershell
node tools\memory-maintenance-qualification\wiki-schema-replay.mjs `
  --mode run --inventory $inventory --inventory-hash $inventoryHash `
  --protocol $protocol --protocol-hash $protocolHash `
  --output $newRunDirectory --live --max-calls 360 --deadline $absoluteUtcDeadline
```

An explicit future UTC deadline must be no more than 90 minutes away. The cap is
at most 360 logical calls; the fixed schedule uses 327: three preflight, 216 pilot
and 108 confirmation calls. Arm position is rotated across three fresh repeats,
with seeded initial rotation and alternating direction. Concurrency is one.
No blinded reviewer calls or automatic outcome retries are made by this version.

Models use existing configuration only. No login or credential provisioning is
performed. Native Azure must resolve to `decision-1`; Luna must support
inspectable strict JSON-schema Chat Completions or Responses transport. The SDK
Chat Completions path needs explicit `response_format: { type: "json_object" }`
to emit the supplied strict schema; the runner sets and verifies this opt-in.
Configure a common provider request-constraint `outputTokens` allowance adequate
for the largest full response. The current SDK forbids completion-setting token
limits. The runner records any actual wire cap separately; when none is emitted,
the admission allowance is **not** described as a hard generation cap.
Effective temperature is explicitly one, not an unsupported determinism claim.
Actual successful chat request/response bodies and model/usage metadata are
retained without headers, keys or endpoint configuration. Pool deployment
identity may be unavailable; model IDs do not prove physical deployment parity.

A protocol is single-use: an exclusive adjacent `.execution.json` receipt
prevents restart after interruption and therefore prevents silently resetting
its budget/deadline. Never delete that receipt to retry. New authorization and
a newly reviewed protocol location are required for another campaign.
Output must name a new directory and cannot overwrite previous evidence.

## Outputs and interpretation

The private run directory contains frozen inputs/schedule, implementation
hashes, effective binding, inspected wires, pre-dispatch request reservations,
raw/typed results, explicit failures and a final scorecard. It includes:

- All-attempt and valid-pair packet/question counts; invalid packets cannot vanish
  from denominators. Preflight outcomes are separate from scored calls.
- Family-specific choice transitions, pair agreement and 3/3 repeatability.
- Component all-attempt/valid latency, valid-pair ratios and label provenance.
- Raw GPT distributions/confidence as generated self-reports, not calibrated
  native probabilities. No normalization, zero filling, argmax forcing or repair.

SDK-native validation enforces probability sums within `1e-6` of one in addition
to strict shape/choice checks. The choice-only arm never fabricates native scores.
Historical native answers establish the contract only; all native comparison
outcomes are fresh calls. They are never exposed to the Luna messages.

Preflight failure stops before scored dispatch. Provider/transport/wire failures
stop the run conservatively. Invalid scored model outputs are retained without
resampling. Deadline, cancellation and call-cap stops produce incomplete reports.
Internal SDK transport retries may occur; HTTP-attempt counts are explicitly
unavailable, not equated with logical-call counts. Exit 2 means incomplete
execution; exit 1 means setup/input/persistence failure. A complete diagnostic
can include invalid outputs and is **not qualification**.

Host-consequence replay is explicitly unavailable without recovered experimental
reducers and saved host context. Source-first quality adjudication, calibrated
scores, population confidence intervals and whole-Wiki integration/qualification
remain separate work. The runner always reports `candidateQualified: false`
and `productionActivated: false`; it never promotes a treatment.

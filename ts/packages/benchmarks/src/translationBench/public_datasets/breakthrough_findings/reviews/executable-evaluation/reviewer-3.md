# Reviewer 3: executable constraint evaluation

## Verdict: REJECT

This is useful benchmark repair, not a benchmark-backed TypeAgent breakthrough. The proposed evaluator has not been implemented. There is no frozen stub, field-level constraint manifest, paired output, blinded adjudication, or measured gain. Changing an oracle also cannot improve TypeAgent behavior by itself. It can only make later product experiments more trustworthy.

## What the evidence supports

The source and result hashes recorded in `cross-dataset-analysis.json` match the current files. The 1,000-row DroidCall run establishes a real scoring problem:

- TypeAgent pass rate is 56.5% to 62.3% across eight configurations. The adjusted DroidCall exact score is 56.2% to 58.4%, while adjusted soft accuracy is 88.17% to 88.95%.
- The 525 rows with at least one gold string absent from the request pass at 36.57% to 48.38%. The other 475 pass at 76.42% to 78.53%.
- All configurations fail the same 277 rows. That supports auditing the shared prompt, contracts, gold, and scorer. It does not isolate the scorer as the cause.
- The existing MIME presence override changes released exact accuracy by only 0.3 to 0.8 percentage points. This is a measured scorer correction, but it is far below a large product gain.

The raw rows contain clear label and contract defects. `droidcall-train-1047` expects a natural-language date despite an ISO 8601 contract. `droidcall-train-1187` contradicts the documented `EXTRA_SKIP_UI` default. `droidcall-train-1204` invents a contact URI and phone number. The untouched test split has the same problem: `droidcall-test-150` expects `"this Friday"` in an ISO field, `droidcall-test-73` maps "gentle ringtone" to the opaque URI ending in `302`, and `droidcall-test-108` and `186` require Google even though the user does not choose an engine and the API default is Baidu.

These examples justify marking bad or ambiguous gold and separating semantic intent from provider representation. They do not show that doing so changes a TypeAgent decision or completes more tasks.

## Why the executable oracle is not specified yet

DroidCall supplies input contracts for 24 tools, but only nine tools declare returns. Those returns have only scalar string, optional string, or string-list shapes. It supplies no provider implementation or device state. Seal-Tools supplies per-row input schemas and symbolic response names such as `API_call_0`, but no output schemas, concrete outputs, or provider behavior.

A stub built from these artifacts has two choices today:

1. Check JSON shape and required fields. That adds little because seven configurations are 100% schema-valid and the eighth is 99.6% schema-valid.
2. Encode the expected values and side effects from gold. That is circular and would preserve the synthetic assumptions the proposal is meant to remove.

Runtime behavior also exposes errors that the five field labels do not settle. In `droidcall-test-70`, a file picker returns a list, but the next string parameter receives the whole `#0` result even though the request says "first file." In `droidcall-test-138` and `196`, a video URI is passed to an API that displays a contact URI. A type-only stub accepts the latter because both are strings. A realistic stub rejects it, but the dataset calls it correct. The evaluator therefore needs independently authored state, typed resource identities, and observable postconditions. None exists in the evidence.

The proposed classes are also properties of parameter instances, not schema fields. The same `body`, `query`, `date`, or URI field may be copied from the user, generated, derived, resolved from state, or under-specified in different rows. No classification rules, annotations, or agreement study are present. The current non-verbatim heuristic is not a substitute.

## Analysis defects

The aggregate arithmetic is mostly reproducible, but several labels and categories are unsafe to use as evidence for this proposal.

- `officialExactAccuracy` and `officialSoftAccuracy` are misnamed. `analyze.mjs` fills both ranges from `adjustedDroidCallScore`, which uses the TypeAgent MIME override when present.
- `run.models` is 8, but there are seven distinct model strings. The two Luna files are separate configurations of one model.
- `actionFamilies` assigns the whole row's pass bit to every expected action. It is not an action-level success rate. In `droidcall-train-1007`, `ACTION_SET_ALARM` matches exactly and only `ACTION_OPEN_DOCUMENT.mime_types` differs, yet both families receive a failure.
- `actionFamilyGrounding` assigns the whole row's non-verbatim flag to every action. Of 166 `get_contact_info` rows labeled non-verbatim, only 55 have a non-verbatim string in that action; 111 inherit the label from another action. All 19 non-verbatim `ACTION_IMAGE_CAPTURE` rows inherit it because that action has no parameters. The reported within-family gaps are therefore not field-level grounding effects.
- The current plurality bounds are correct: 123 ties produce 602 to 633 possible passes. This replaces the earlier file-order-dependent 611 estimate. The interval overlaps the best single configuration's 623 passes, so plurality voting supplies no measured gain.
- The released DroidCall grader indexes predictions by action name, so duplicate calls collapse to one prediction. This affects 67 of the 1,000 evaluated rows and 5 of the 46 multi-action test rows. An executed trace must preserve call identity.
- The Seal count of 28 dependency-bearing rows is defensible only as a semantic substring count. The converter marks 27 strict rows because it recognizes exact `API_call_N` values. The extra row, `sealtools-dev-difficult-207`, embeds `API_call_0 response` in strings and is genuinely dependent. The report should name these as 27 exact references plus one embedded reference, not treat `dependentRows` and `strictOrderRows` as comparable categories.
- The script is content-reproducible apart from `generatedAt`, which changes on every run. It is not byte-deterministic as currently described.

These defects do not erase the bad-gold finding. They do prevent using the action-family and voting numbers as causal support for an executable evaluator.

## Product effect and novelty

Provider simulators, provenance labels, constraint checks, and separate semantic adjudication are standard evaluation techniques. Their value here would be a sounder benchmark and better diagnosis. The current evidence gives no before-and-after TypeAgent result, no metric showing that the new oracle predicts real task completion better than exact gold, and no output-changing intervention selected by that oracle.

Even a large score increase after relabeling would be benchmark cleanup. It becomes a TypeAgent improvement only when the new evaluation leads to a concrete prompt, schema, compiler, dispatcher, or agent change that completes more held-out tasks under a gold-independent oracle.

## Smallest falsification experiment

Use 24 untouched rows: 12 DroidCall test rows and 12 Seal-Tools rows absent from the existing five-row fixtures. Sample parameter instances across all five proposed classes, with at least four runtime-resolved instances and four known ambiguous or bad-gold instances. Do not run the full benchmark.

Before generating predictions, freeze:

- provider input and output types, fixture state, and observable side effects;
- one constraint record per parameter instance, including its source of truth;
- the policy for generated text and ambiguous requests;
- two reviewers' blind classifications, with disagreements adjudicated before outputs are opened.

The stubs must not contain row IDs, gold literals, or mappings learned from expected actions. Run one fixed model and configuration once. Score the same outputs three ways: current exact gold, the frozen executable constraints, and blind task-completion adjudication. Require the constraint score to agree with adjudication on at least 22 of 24 rows and to explain every disagreement with exact gold. If it cannot, reject the evaluator even as benchmark infrastructure.

To test the stronger TypeAgent claim, use the constraint failures to make one predeclared output-changing TypeAgent change, then rerun only these 24 rows with the same model settings. Require at least three additional completed rows, a 12.5-point absolute gain, with no loss of user-specified constraints and no extra side effects. A score gain caused only by excluding bad gold, weakening equality, or teaching the stub dataset literals is scorer cleanup and fails the breakthrough claim. Passing this screen would justify a larger held-out study; it would not yet prove broad product impact.

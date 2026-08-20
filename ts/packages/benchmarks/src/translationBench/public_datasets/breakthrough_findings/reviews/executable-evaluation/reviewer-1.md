# Reviewer 1: executable evaluation

## Verdict: REJECT

The proposal identifies the right benchmark defect. It does not yet clear a breakthrough bar. The repository has no argument classification artifact, executable provider lane, semantic-fidelity rubric, adjudication result, or score produced by this evaluator. The current evidence can justify building the evaluator. It cannot show that optimizing it improves TypeAgent rather than relabeling existing outputs.

## What the evidence establishes

`evidence/cross-dataset-analysis.json` shows a large gap between literal and permissive scoring on the same 1,000 independent DroidCall training rows. Across eight runs, TypeAgent pass rate is 56.5% to 62.3%, while adjusted DroidCall soft accuracy is 88.17% to 88.95%. All 1,000 translations are schema-valid. The same report identifies 525 rows with a gold string absent from the utterance; those rows pass at 36.57% to 48.38%, compared with 76.42% to 78.53% for the other 475 rows. This is strong evidence that exact synthetic gold is a poor sole objective.

The row evidence explains why:

- `droidcall-train-1047` asks for "this Sunday afternoon." Gold preserves that phrase although the tool contract requires ISO 8601. The model emits an ISO timestamp and fails exact scoring.
- `droidcall-train-128` asks for a message about project visuals. Gold invents a full message body; the model writes a different faithful body and fails.
- `droidcall-train-1204` supplies neither `content://contacts/people/John` nor `555-112-2334`. Gold contains both. A correct result requires contact state, not text extraction.
- `droidcall-train-1435` maps "calm" to `content://media/internal/calm`, and `droidcall-train-1551` maps "harmonious melody" to `content://media/external/audio/media/701`. No committed provider catalog establishes either mapping.

The ten-row dependent probe exposes a second measurement hole. TypeAgent excludes all ten rows, the released DroidCall exact score is 10%, five translations emit `pendingRequestAction`, one emits typed result references, and one errors. Yet the artifact executes no action and observes no final state. This proves that the translation-only lane cannot evaluate dependent work. It gives no evidence that the proposed evaluator can.

## Why the breakthrough claim fails

### Magnitude is unknown

The reported 29.30 to 41.95 point gap for non-verbatim gold is not a recoverable gain. That bucket mixes user-authored values, generated prose, defaults, dates, resource IDs, and bad labels. The five proposed classes do not exist in the evidence as row-level annotations, so there is no count of eligible arguments, no class-specific baseline, and no measured executable score.

The cross-dataset label also overstates scope. The full accuracy study contains DroidCall training rows only, selected to exclude dependencies. Seal-Tools contributes corpus counts, not results under the proposed evaluator. The combined 37.08% dependency rate is dominated by DroidCall, which supplies 1,151 of 1,179 dependent rows. The ten-row probe uses one local model and DroidCall training data.

### Classification can become circular

The classes are not mechanically separable. The `1047` date can be called user-specified, contract-derived, or invalid gold. The `1204` phone number can be called provider-state lookup or invented gold. The `128` body is generated content, but the dataset supplies no unique faithful wording.

This ambiguity creates direct paths to gold laundering. A mock contact store can be populated with `555-112-2334`; a ringtone catalog can map "harmonious melody" to media ID 701; an adjudicator can mark any inconvenient expected value invalid. If those choices are made after reading gold or model failures, execution merely encodes the answer in a fixture and exclusion removes the remaining misses. "Provider accepted" is also too weak. A stub can accept any schema-valid call, and the current 1,000-row run is already 100% schema-valid. Acceptance does not prove the intended side effect occurred.

Invalid or ambiguous gold must remain in the coverage denominator and be reported as unscorable, not converted into a pass. Contract rules and provider state must come from an independently frozen source. Otherwise the new metric is less reproducible than exact match and easier to tune.

### Manual adjudication is a primary measurement component

Semantic fidelity for generated messages, search queries, relative dates, and inferred defaults requires judgment. The proposal gives no rubric, blinded procedure, second rater, agreement statistic, or appeal rule. An evaluator that sees system identity, gold, or provider outcome can favor fluent outputs and forgive the treatment's errors. Preclassification helps only if reviewers classify before seeing outputs and independently agree on the source of each value.

### Public benchmark leakage remains

The taxonomy was derived after inspecting public DroidCall gold, 1,000 DroidCall training outputs, and named failure examples. Both public datasets and their labels are available to model builders. A compiler, fixture catalog, or evaluator tuned on these rows can memorize their conventions while satisfying the stated categories. Holding back rows from a run is not a sealed test when their labels remain public. The evidence contains no private or newly authored holdout and no check for case-ID, gold-literal, or fixture leakage.

### A better score is not yet a better TypeAgent

This proposal changes evaluation, not runtime behavior. It could raise the reported score for the existing `1047` and `128` outputs without changing one generated action. That may correct the report, but it does not improve a user's result. The current artifacts contain no provider call, final-state assertion, user-visible outcome, latency or cost comparison, or TypeAgent change selected by the new objective.

The 1,000-row run also has no negative requests. An execution metric centered on provider acceptance can reward unnecessary or unsafe side effects unless it tests abstention, clarification, confirmation, and wrong-target mutations. A breakthrough claim needs evidence that the metric selects changes that increase completed intent on unseen tasks without increasing harmful execution.

## Smallest decisive experiment

Create 50 sealed multi-action tasks across at least two real TypeAgent agents with disposable provider accounts. Include ten tasks dominated by each proposed argument class, plus negative or clarification cases within those groups. Provider owners must freeze contracts, account state, and final-state assertions before evaluators see requests, outputs, or synthetic gold. Two reviewers must classify arguments and score semantic fidelity independently while blind to system identity; report agreement and every exclusion.

Prepare a fixed set of at least four TypeAgent variants containing actual schema, prompt, compiler, or execution changes. On a separate development set, select one variant by exact dataset score and one by the proposed evaluator. Run both once on the sealed tasks. The primary metric is correct final provider state with no unintended side effect. Provider acceptance and semantic fidelity are diagnostics; public-dataset exact score is compatibility only.

The claim passes this screen only if the executable-evaluation-selected variant beats the exact-selected variant by at least 10 tasks out of 50, does not regress negative or clarification behavior, and the evaluator's judgments reproduce with at least 0.8 inter-rater agreement. If the evaluator selects the same variant, only changes labels, or gains through fixtures and exclusions, it is benchmark repair rather than a TypeAgent breakthrough.

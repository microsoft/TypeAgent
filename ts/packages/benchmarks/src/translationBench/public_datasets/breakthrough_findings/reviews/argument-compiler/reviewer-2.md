# Reviewer 2: semantic argument compiler

## Verdict: REJECT

An app-owned semantic argument layer is sensible product architecture, but this evidence does not meet a breakthrough bar. It shows that parameter values are a common source of benchmark misses. It does not show that a compiler would correct those misses, generalize beyond this corpus, or improve the primary DroidCall score. There is no compiler treatment, paired comparison, or measured gain.

## What the evidence supports

The artifact hashes match the three source files and all eight result files named in `cross-dataset-analysis.json`. On the 1,000-row run:

- TypeAgent pass rate is 56.5% to 62.3%, while tool score is 94.9% to 98.0% and parameter score is 79.9% to 84.5%.
- `wrongValue` accounts for 75.34% to 87.32% of the supplemental diagnostic counts.
- The 525 rows with at least one non-verbatim gold string pass at 36.57% to 48.38%. The 475 other rows pass at 76.42% to 78.53%, a gap of 29.30 to 41.95 percentage points.
- Array-bearing rows pass at 17.29% to 30.83%, versus 57.21% to 63.74% for the reported non-array slice.
- Models fail the same 277 rows and all pass 470 rows.

That is good evidence for investigating argument contracts. It is only correlational evidence for this proposal. `wrongValue` is a leaf-level label from the supplemental TypeAgent scorer, not a diagnosis of wire-format conversion. The non-verbatim bucket mixes MIME literals, generated message bodies, search-query paraphrases, inferred defaults, contact identifiers, and dates. It does not control for action family, argument count, or label quality. Shared failures across models may come from the shared prompt, schema, scorer, or gold data just as readily as from the lack of a compiler.

## Benchmark validity and scope

The run is the first 1,000 independent multi-action DroidCall rows. All 1,000 are from the training split, they cover 14 action names, and they exclude all 1,151 dependent DroidCall rows. Those excluded rows are 42.92% of DroidCall's multi-action corpus. Seal-Tools contributes coverage counts only. There are no Seal-Tools model results or compiler results. Calling this cross-dataset performance evidence overstates what was measured.

The eight files represent only seven displayed model names because both Luna configurations are recorded as `azure/gpt-5.6-luna`. More important, every run uses the same translation and scoring path. A small cross-model spread therefore does not isolate an architectural ceiling.

The no-argument slice also sets a hard counterexample to the causal story. `ACTION_VIDEO_CAPTURE + INTENT_ACTION_VIDEO_CAMERA` fails 286 of 360 evaluations, or 79.44%, despite having no arguments to compile. Routing remains a material source of systematic failure.

## Is this scorer or dataset cleanup?

Much of the apparent opportunity is exactly that.

The primary DroidCall scorer already applies documented defaults, uses semantic comparison for nine catalog arguments, and gives `ACTION_OPEN_DOCUMENT.mime_types` presence-only credit. A compiler that fills defaults, rewrites paraphrases, or chooses exact MIME strings can improve the supplemental exact-value diagnostics without improving the official score. Official soft accuracy is already 88.17% to 88.95%, while official exact accuracy is 56.2% to 58.4%. The submission reports no counterfactual score for either metric.

Several rows expose gold-contract defects or hidden assumptions:

- `droidcall-train-1047` has gold start time `this Sunday afternoon`, although the API catalog requires ISO 8601. The model emits `2026-08-23T13:00:00-07:00` and receives a wrong-value diagnostic. A real wire compiler would move toward the model output and away from the gold.
- `droidcall-train-1149` asks to find resources without naming an engine. Gold requires `google`, while the catalog default is `baidu`. The model omits the engine. A gold-blind default compiler cannot recover the hidden label.
- `droidcall-train-1204` asks to dial John but supplies no phone number. Gold contains `555-112-2334`. Producing that value requires a runtime contact lookup or dataset memorization, not literal normalization.

These are valid reasons to separate user intent from provider calls in a real application. They are not evidence that a deterministic compiler can reproduce this benchmark's gold. A gain obtained by encoding these gold conventions would be dataset-specific postprocessing.

## Novelty and likely magnitude

Semantic slots followed by deterministic validation, defaulting, enum mapping, date parsing, entity lookup, and provider serialization are established semantic-parsing and adapter patterns. The proposal could still be a useful TypeAgent design, but novelty would require a general contract or synthesis method that works across independently authored apps. No such mechanism is specified or tested here.

Magnitude is unmeasured. The reported associations cannot establish an upper bound because many non-verbatim values are authored content that a compiler should preserve, and some high-frequency apparent mismatches are already neutralized by the official scorer. URI resolution also needs app state or provider access, which is outside a pure post-translation compiler.

## Smallest falsification experiment

Freeze one gold-blind semantic schema and deterministic compiler for three claimed high-volume families: alarm/timer defaults and dates, document MIME types, and search-engine enums. Run a paired A/B test on the same held-out DroidCall test utterances with two model families. Arm A emits the current provider arguments. Arm B emits semantic arguments and compiles them to provider calls. Score only the compiled provider calls with the pinned official DroidCall scorer, and separately report tool routing so the new schema cannot hide regressions.

Predeclare a breakthrough threshold of at least 10 percentage points absolute improvement in official exact row accuracy on eligible rows, replicated for both models, with no more than one point of routing loss. The compiler must not read gold labels or row IDs. Manually adjudicate every changed outcome whose gold violates the catalog contract. If the gain appears only in the supplemental scorer, comes from MIME/default handling already ignored by the official scorer, or requires row-specific mappings such as `555-112-2334`, this proposal is falsified as a breakthrough and reduces to scorer or dataset cleanup.

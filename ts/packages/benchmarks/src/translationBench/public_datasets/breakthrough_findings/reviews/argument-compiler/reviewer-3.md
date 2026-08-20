# Reviewer 3: semantic argument compiler

## Verdict: REJECT

This is a plausible application architecture, but the current evidence does not establish a breakthrough. It contains no compiler, intervention, ablation, provider execution, or before/after result. It shows that exact parameter values are a major source of benchmark failure. That observation does not show that deterministic lowering can recover those failures.

## Why the evidence is not causal

- Across the eight runs, TypeAgent pass rate is 56.5–62.3%, and 75.34–87.32% of diagnostic events are labeled `wrongValue`. The latter is a share of diagnostic events, not a share of rows that a compiler can fix.
- In the current `gpt-4.1-mini` result, 323 of 377 failed rows have only value diagnostics. This is an upper bound on the opportunity, not an effect estimate. Those rows mix wire encoding, semantic ambiguity, legitimate paraphrase, bad gold, and ordinary extraction errors.
- The array slice is weak (17.29–30.83% pass versus 57.21–63.74% for the non-array slice), but “has an array” is not a treatment or a compiler-error taxonomy. Array extraction, cardinality, ordering, and MIME spelling are conflated.
- Cross-model agreement is not causal evidence. The report has 277 all-model failures, but shared failures can come from the shared schema, scorer, or label. It also has 253 disagreements and an oracle pass rate of 72.3%. Nothing identifies which failures a deterministic compiler would change.

## The benchmark currently rewards gold imitation over provider correctness

The raw rows contain direct counterexamples to the proposed interpretation:

- `droidcall-train-1047`: the tool schema says `EXTRA_EVENT_BEGIN_TIME` is ISO 8601. The gold value is `"this Sunday afternoon"`. Every run emits an ISO timestamp and every run fails. A wire compiler that follows the schema would preserve the allegedly wrong output.
- `droidcall-train-1187`: the timer schema documents `EXTRA_SKIP_UI` defaulting to `true`; the gold answer contains `false` even though the user says nothing about UI. Runs that emit the documented default fail, while runs that omit the optional field pass.
- `droidcall-train-128`: the user asks for a message “about the project visuals,” while the gold invents a full sentence. All eight sensible paraphrases fail the row. This needs semantic adjudication, not MIME/enum/default lowering.
- `droidcall-train-1204`: the utterance contains neither the gold URI `content://contacts/people/John` nor the gold phone number `555-112-2334`. The row is marked independent because the gold has no explicit result reference, although dialing the fetched contact is semantically dependent. A post-translation compiler cannot derive that phone number without provider state or memorizing the label.

The aggregate pattern is consistent with these examples. In a raw comparison across the eight result files, frequent exact disagreements include alarm messages (620), web-search queries (499), message bodies (241), event start times (412), ringtones (403), contact URIs (310), and MIME fields (262 across open/get content). The first three are mostly semantic-generation or scoring questions. The latter categories may contain compiler work, but they have not been adjudicated.

The report itself finds 525/1,000 rows with at least one gold string absent from the utterance. For `gpt-4.1-mini`, those rows pass at 48.38% versus 77.68% when all gold strings are verbatim; for `gpt-5.4-nano`, the rates are 36.57% versus 78.53%. That is strong evidence of a gold-grounding confound, not evidence for the proposed mechanism.

## Validity, scope, novelty, and magnitude

- The only full evaluation is 1,000 DroidCall **training** rows selected to be independent. Seal-Tools contributes coverage counts, not compiler results. Calling this cross-dataset validation is premature.
- The run excludes the claimed hard compositional surface: 42.92% of DroidCall multi-action rows and 37.08% of combined multi-action rows are labeled dependent. Even that dependency count misses cases such as train-1204.
- There are eight run files but seven unique model identifiers; two are `azure/gpt-5.6-luna` configurations. The report now distinguishes the run IDs, but “eight models” overstates model diversity.
- There are no negative rows and no real provider calls. Schema validity is already 100%, so this benchmark cannot show that the compiler improves actual provider acceptance or behavior.
- A major zero-parameter action set (`ACTION_VIDEO_CAPTURE + INTENT_ACTION_VIDEO_CAMERA`) fails 286/360 evaluations (79.44%). An argument compiler cannot address that route/action ambiguity.
- MIME handling already demonstrates how much of this may be scorer cleanup: changing `ACTION_OPEN_DOCUMENT.mime_types` to presence-only raises exact accuracy by only 0.3–0.8 percentage points across the current files. The proposed compiler may cover more fields, but no measured gain exists.
- No workspace evidence establishes novelty over ordinary typed adapters, default application, enum canonicalization, date parsing, and execution-layer resolution. Renaming that collection an “argument compiler” does not make it a breakthrough.

## Is this merely scorer/dataset cleanup?

On the present evidence, largely yes. Natural-language dates scored against an ISO contract, undocumented invented strings, contradictory defaults, and semantically dependent rows labeled independent must be fixed or adjudicated before runtime architectural gains can be measured. A real app-owned lowering layer could still be useful, but that engineering hypothesis is not validated here.

## Smallest falsification experiment

Freeze a compiler derived only from tool/provider contracts—no DroidCall gold values or case IDs—then run one paired test on the 46 untouched DroidCall multi-action **test** rows (23 independent, 23 dependent) plus 46 seeded Seal-Tools rows containing the claimed field classes.

For each request, compare direct translation with semantic-IR-plus-compiler using the same model settings. Before revealing either output, classify every target field as (a) deterministic provider lowering, (b) provider-state resolution, (c) user-authored semantic content, or (d) ambiguous/bad gold. Score the final calls by provider-contract acceptance or a faithful executable stub and by blind semantic fidelity; report dataset exact match only as a secondary metric.

Falsify the breakthrough claim if the compiler does not recover at least half of the independently adjudicated lowering failures and deliver at least a 10-point absolute end-to-end success gain on **each** dataset without reducing routing or semantic fidelity. This paired test is small, isolates the mechanism, includes unseen and dependent cases, and prevents scorer relaxation or memorized gold literals from being counted as a compiler win.

# Reviewer 2: executable, constraint-based evaluation

## Verdict: REJECT

This is benchmark repair, not a demonstrated TypeAgent breakthrough. The evidence shows that literal synthetic gold is often a poor proxy for task success. It does not contain an executable evaluator, field annotations, provider fixtures, a TypeAgent treatment, or a measured before-and-after result. Reclassifying an unchanged output as correct can improve a benchmark score, but it cannot improve the user's outcome.

## What the evidence supports

The recorded hashes match the current DroidCall sources, Seal-Tools source, eight DroidCall result files, and the ten-row dependent probe.

- On the 1,000 independent DroidCall training rows, adjusted exact accuracy is 56.2% to 58.4%, while soft accuracy is 88.17% to 88.95%. TypeAgent pass rate is 56.5% to 62.3%.
- The 525 rows with at least one non-verbatim gold string pass much less often than the other 475 rows. This is useful evidence of a gold-grounding confound, not a measured gain from the proposed evaluator.
- The ten-row dependent probe executes no provider. TypeAgent excludes all ten rows, five outputs contain `pendingRequestAction`, one contains `$result`, and one translation errors. A provider-stub result cannot be inferred from this translation-only artifact.
- Full Seal-Tools results exist outside `cross-dataset-analysis.json`. After excluding 28 reference-bearing rows and 67 audited data-quality rows, TypeAgent pass rate on the remaining 605 rows is already 85.79% to 93.22%, although exact pass is 60.33% to 67.60%. The primary case-insensitive Tool F1 is 97.04% to 98.31%, and Parameter F1 is 86.35% to 89.70%. This large exact-versus-tolerant gap again shows scorer sensitivity. It does not show better execution.

The premise that the benchmark only uses exact matching is also too broad. `runner.ts:66-90` already defines per-field `normalized`, `optionalNormalized`, `exists`, `nonempty`, and `ignore` modes plus accepted values. DroidCall's pinned scorer applies documented defaults and semantic comparison, and its adjusted contract treats document MIME values as presence-only (`officialDroidCallGrader.py:102-130`, `177-216`). The proposal extends existing constraint scoring and adds execution. It does not replace a purely exact evaluator.

## The proposed classes are not a contract

The five labels overlap and do not specify pass predicates.

- In `droidcall-train-1047`, "this Sunday afternoon" is user-specified text, a date that can be deterministically derived only after freezing clock and timezone context, and gold that violates the stated ISO 8601 contract.
- In `droidcall-train-1204`, the phone number may be runtime-resolved or invented gold. The supplied tool set has no contact lookup that can produce it.
- In `droidcall-train-128`, the message body is generated, but the request still constrains its meaning. The class does not define which paraphrases preserve intent.
- In `droidcall-train-1435` and `1551`, a ringtone URI is runtime state only if an independently sourced catalog maps the user's description to that URI. Copying the gold mapping into a stub launders the label through execution.

A usable contract needs a mutually exclusive decision rule, provenance for every constraint and fixture value, a frozen clock and locale, explicit final-state assertions, and a rule for cancellation and provider failure. "Provider accepted the call" is inadequate because all 1,000 DroidCall translations are schema-valid. The evaluator must prove the requested side effect and reject extra or wrong-target effects.

The public datasets cannot supply that contract by themselves. DroidCall declares return shapes for only 9 of 24 catalog tools, and its TypeAgent adapter drops those return declarations. Seal-Tools provides input schemas and opaque `API_call_N` labels, but no output schemas, provider implementations, or result values. Stub authors therefore have to invent missing behavior. Freezing invented behavior after studying public gold and failures does not make it independent.

## Analysis defects

The aggregate evidence has several categorization problems that matter to this proposal.

1. `actionFamilyGrounding` classifies every action in a row using whether any sibling action has a non-verbatim gold string (`analyze.mjs:252-281`). In the 1,000 source rows, this contaminates 555 of 2,287 unique action-row pairs. For `search_location`, the report assigns 71 rows to non-verbatim, but only 18 have a non-verbatim value in that action; 53 are there because of a sibling action. With action-local classification, its whole-row pass rates are 0.69% versus 49.05%, not 11.80% versus 94.55%. For `get_contact_info`, the reported 166 versus 238 row split becomes 55 versus 349. Even the corrected figures remain whole-row outcomes, so they cannot identify field-level causality.
2. Seal dependency coverage reports 28 because `hasSealResultReference` matches any `API_call_N` substring. The converter's actual dependency contract requires an exact reference to another call's response (`toTypeAgentSchema.ts:223-257`) and finds 27 strict rows. `sealtools-dev-difficult-207` contains prose ending in `API_call_0 response`; it is not a data dependency. The strict combined count is 1,178/3,180, or 37.04%, rather than 1,179/3,180.
3. `canonicalJson` sorts every array (`analyze.mjs:114-127`), including parameter arrays where order may be meaningful. This merges distinct predictions in nine cases. The updated plurality result properly reports tie bounds of 60.2% to 63.3%, but its candidate identity still needs to preserve parameter-array order.
4. The report calls eight run configurations eight models. There are seven model IDs because the two Luna files are reasoning variants of the same model. This does not change the scores, but it overstates independent replication.

## Smallest falsification experiment

Use 20 rows, not a full rerun: ten untouched DroidCall test rows and ten Seal-Tools validation rows. Select four fields from each proposed class, while keeping rows with invalid or ambiguous gold in the denominator as unscorable rather than passing them.

Before looking at model outputs, two reviewers should independently assign each field through one mutually exclusive decision tree and record the source of every rule or fixture value. Provider owners should freeze deterministic stubs, state, clock, locale, and final-state assertions. Rows whose behavior cannot be derived from those sources stay unscorable. Then run one fixed model once and score the same outputs with the current scorer, the proposed evaluator, and blinded human adjudication of the requested final state.

Falsify the evaluator if it improves agreement with blind adjudication by less than 10 percentage points, has inter-rater agreement below 0.8, or accepts any wrong-target or extra side effect. Reusing the same outputs keeps this a cheap evaluator test with no additional model comparison.

Passing that screen would validate a better measurement method only. A TypeAgent breakthrough still requires a specified runtime treatment and a paired run against the frozen evaluator. The treatment must improve correct final-state completion by at least 10 percentage points on unseen tasks without increasing unsafe actions, model calls, or clarification failures. No such treatment or result exists here.

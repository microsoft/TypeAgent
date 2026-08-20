# Reviewer 3: typed dataflow plan

## Verdict: REJECT

This is a credible product direction, but it does not meet a strict breakthrough bar. The evidence establishes that dependency-bearing tasks exist and that the current benchmark excludes them from its TypeAgent summary. It does not establish that a typed, path-addressable plan improves end-to-end task success, that it beats the existing result-reference machinery, or that the affected workload is large in actual TypeAgent use. The only committed dependent probe is translation-only and scores 0/10; there is no execution result or treatment comparison.

## The 37.08% denominator does not support the headline

`cross-dataset-analysis.json` pools 1,151 dependent DroidCall rows and 28 Seal-Tools rows over 3,180 multi-action rows to report 37.08% (`cross-dataset-analysis.json:18-36`). That number is not a valid cross-dataset coverage metric:

- It is a conditional prevalence among multi-action rows, not coverage and not total workload prevalence. Using the two full snapshots, the corresponding strict dependency share is 1,178 / 10,971 = 10.74%.
- The pooled estimate silently weights datasets by row count. DroidCall supplies 84.34% of the denominator and 97.71% of the strict dependent numerator. It is effectively a DroidCall statistic, not independent cross-dataset confirmation.
- The Seal numerator is off by one. The analysis uses a substring regex, `/API_call_\d+/`, at `analyze.mjs:318-319`, so it counts 28 rows. The dataset's canonical dependency conversion requires an exact reference that names an actual producer (`toTypeAgentSchema.ts:223-257`) and marks only 27 rows strict. The 28th row contains text such as `"API_call_0 response"` and remains `order: "any"`. The consistent pooled figure is therefore 1,178 / 3,180 = 37.04%.
- DroidCall's 1,151 rows come from any `#N` argument reference and are overwhelmingly training data: 1,128 train and 23 test. This demonstrates corpus shape, not held-out product demand.

The fair claim is narrow: dependency references occur in 42.92% of DroidCall's curated multi-action subset and 5.42% (27/498) of Seal-Tools' multi-action subset. That supports investigation. It does not quantify user impact.

## Existing support already covers much of the proposed mechanism

The proposal is not starting from an absent capability:

- `MultipleAction` already exposes producer IDs, whole-result `$result` references, and pending requests (`multipleActionSchema.ts:18-57`).
- Validation deliberately accepts `{ "$result": string }` against every parameter type (`actionSchema/src/validate.ts:20-53`).
- Execution stores a producer's `resultValue`, substitutes it into a later action, and then walks the consumer's declared parameter type (`pendingActions.ts:155-212`, `pendingActions.ts:925-949`, and `actionHandlers.ts:837-858`).
- The DroidCall official grader already maps named `$result` references back to the dataset's `#N` notation (`droidCallGrader.ts:140-166`, `droidCallGrader.ts:181-204`).

A first-class contract could still fix real gaps, but those gaps must be named precisely. `ResultEntityId` is only `string`; producer output is `unknown`; `$result` bypasses translation-time type checking; whole-value replacement has no structured path grammar; duplicate, missing, forward, and cyclic references are not rejected as a graph. More seriously, `pendingResultEntityId` is copied into an internal action but never read by the pending translation path: `translatePendingRequestAction` retranslates only the natural-language string with global history (`translateRequest.ts:1340-1354`). The declared edge does not select or inject its producer value. Repository-wide, only Player's `getFavorites` currently sets `resultValue` (`agents/player/src/client.ts:1607-1630`).

Those facts make typed dataflow plausible as hardening and completing an existing feature. They also prevent claiming that the architecture itself is the breakthrough. The incremental value over existing whole-result chaining is unmeasured.

## Current benchmark evidence cannot measure the proposed product behavior

Both public lanes stop at translation. The runner imports and calls `translateRequest` (`runner.ts:43-59`, `runner.ts:2673-2688`); it never executes the generated actions or observes provider outputs and final side effects. The supplemental graders then explicitly remove every dependency row: DroidCall at `DroidCall/eval/typeAgentGrader.ts:65-83` and Seal-Tools at `Seal-Tools/eval/typeAgentGrader.ts:67-92`. The official graders compare predicted calls with gold calls, not execution.

The committed `droidcall-dependent-10` checkpoint is useful negative evidence, not success evidence. All 10 rows fail the current translation score, one errors, and six finalized outputs contain a result or pending construct. The trajectories show the model naturally asking for paths such as `emilyContact.phoneNumber` and `selected_files[0]`, while the runtime treats the entire `$result` string as one ID. One row emits valid-looking fan-in with two whole-result references. But there is no `results-*.json`, no execution-backed outcome, and no `dependentProbe` section in `cross-dataset-analysis.json`. We therefore do not know whether the current runtime, the proposed typed plan, both, or neither completes any task.

An execution-backed public lane would be valuable benchmark infrastructure because the present scorer turns `pendingRequestAction` into a wrong provider action and cannot observe deferred retranslation. That lane is necessary to evaluate the product feature; building the lane alone is benchmark work. The product claim begins only when app contracts declare result shapes, real agents return conforming values, the dispatcher enforces the graph, and final consumer effects improve.

## Magnitude and breakthrough status

No measured success exists. There is no baseline execution rate, proposed execution rate, path-resolution rate, final-side-effect score, supported-agent count, latency/cost delta, or independent-task regression check. The public datasets are synthetic external tool-use corpora, and the repository currently has one concrete `resultValue` producer. A large product improvement cannot be inferred from excluded-row prevalence.

At this stage the strongest defensible result is: "TypeAgent has a partially implemented dependency protocol, public benchmarks expose a substantial unmeasured slice in one dataset, and an execution lane can test whether a typed contract closes it." That is a good next experiment, not a breakthrough.

## Smallest falsification experiment

Use the existing 10-row dependent DroidCall probe. Add deterministic in-memory executors for only the tools those rows call, with declared scalar, object, list, and list-item result schemas. Replay the same model/config in two arms:

1. Current `resultEntityId` / `$result` / pending-request behavior.
2. The smallest typed plan prototype with validated producer IDs and paths, including whole value, object field, array index, and two-producer fan-in.

Score execution, not translated call text: graph validation, all actions completed, and exact final consumer arguments after substitution. Add 10 matched independent multi-action controls to detect routing regressions. Predeclare the screen as falsified unless the typed arm completes at least 8/10 dependent tasks, beats the current arm by at least 4 tasks, has zero silent wrong-value executions, and loses no control tasks. Passing this screen only justifies running the full 1,178-row strict dependent lane with at least two models; it does not by itself prove breakthrough magnitude.

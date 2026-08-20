# Typed dataflow review

## Verdict: REJECT

This is a credible product problem and a useful experiment, but it does not meet a breakthrough bar yet. The evidence proves that the benchmark cannot score an important class of requests. It does not prove that a new typed dataflow contract fixes those requests, improves real TypeAgent task completion, or is needed instead of repairing and extending the existing mechanism.

## Evidence

### The 37.08% figure is not a product coverage denominator

The arithmetic is correct for the pooled multi-action files: 1,179 dependent rows out of 3,180 multi-action rows (`cross-dataset-analysis.json:18-36`). It is a conditional dataset statistic, not estimated user impact.

- Against all rows in the two snapshots, the same count is 1,179 of 10,971, or 10.75%.
- DroidCall supplies 84.34% of the pooled multi-action denominator and 97.63% of its dependent rows. Pooling therefore mostly restates DroidCall's 42.92%, while Seal-Tools is 5.62% among multi-action rows and 4% among all rows.
- Neither dataset is a sample of TypeAgent production traffic. DroidCall models Android intent calls. Seal-Tools contains synthetic cross-domain APIs. Their row counts cannot be used as traffic weights.
- The label is syntactic. DroidCall calls a row dependent when any string contains `#N` (`DroidCall/droidCallParser.ts:129-149`). Of its 1,151 labeled rows, 92 contain at least one embedded prose reference such as `"Phone: #0, Email: #1"`; 1,059 use only whole-value references. These are different runtime operations. A typed path selector does not by itself solve string interpolation.
- Seal-Tools uses two definitions. The coverage report counts any serialized `API_call_N`, producing 28 rows, while ordering is set only for a parameter exactly equal to `API_call_N`, producing 27 (`Seal-Tools/toTypeAgentSchema.ts:223-257,288-292`). `sealtools-dev-difficult-207` is counted as dependent but remains `order: "any"` because its values are `"API_call_0 response"`.

The number establishes benchmark prevalence only if it is reported as "37.08% of these pooled multi-action rows contain source placeholder syntax." It does not establish 37.08% product coverage or opportunity.

### Existing support is real, narrow, and partly nonfunctional

TypeAgent already exposes most of the proposed control flow. `MultipleAction` has producer IDs, whole-result references, and deferred requests (`multipleActionSchema.ts:18-57,91-137`). The default dispatcher configuration enables result and pending support. The runtime stores concrete values and substitutes `{ "$result": "id" }` before validating the consumer parameter (`pendingActions.ts:174-211,925-949`; `actionHandlers.ts:837-858`).

That does not amount to a typed dataflow contract:

- `ResultEntityId` is only a `string`, despite the comment claiming a token grammar. The generated schema applies no pattern, uniqueness, producer-before-consumer, or cycle constraint.
- `ActionResultSuccess.resultValue` is `unknown` (`agentSdk/src/action.ts:226-236`). Schema validation accepts every `$result` object against every parameter type before execution (`actionSchema/src/validate.ts:20-53`). There is no producer output type to compare with a consumer input type.
- `$result` substitutes the entire value. It has no result path. Repository-wide TypeScript search finds one producer assigning `resultValue`, player `getFavorites` (`agents/player/src/client.ts:1618-1630`). Most agents cannot use this route.
- Deferred execution is broken as written. `toPendingActions()` explicitly skips every `pendingRequestAction` (`pendingActions.ts:1089-1093`), so the pending-action branch in `executeActions()` at `actionHandlers.ts:778-793` is unreachable through this queue. Even if queued, `translatePendingRequestAction()` ignores `pendingResultEntityId` and retranslates only the saved request with general history (`translateRequest.ts:1340-1354`).

The smallest first product change is to make the existing pending queue execute and prove it end to end. A new public plan contract may still be warranted, especially for output typing and path selection, but the current evidence does not separate that need from defects and missing producer adoption in the existing design.

### The measured runs do not measure the proposal

The eight-model, 1,000-row run explicitly selected independent DroidCall rows (`cross-dataset-analysis.json:39-44`; `DroidCall/README.md:56-63`). Both TypeAgent summaries remove dependency rows before aggregation (`DroidCall/eval/typeAgentGrader.ts:65-84`; `Seal-Tools/eval/typeAgentGrader.ts:67-93`). The generic runner calls `translateRequest()` and scores the returned action objects; it never calls `executeActions()` (`runner/runner.ts:2674-2744`).

The existing 10-row dependent checkpoint is diagnostic, not success evidence. It has 0 passing rows. Five translations emitted a `pendingRequestAction`, one emitted `$result`, and none executed a producer or consumer. The current grader counts a pending action as the wrong tool, so the 0% result cannot distinguish a capable plan from a broken one.

The public rows also lack executable output fixtures. Both adapters publish tool input schemas only (`DroidCall/toTypeAgentSchema.ts:94-129`; `Seal-Tools/toTypeAgentSchema.ts:114-136`). DroidCall's raw catalog describes returns for 9 of 24 tools, limited to string and string-list shapes, but the adapter drops them. Seal-Tools supplies response labels such as `API_call_0`, not output schemas or values. These datasets do not provide evidence for path-addressable object results.

### This is product work, but no product improvement has been measured

Making this contract real would change the agent SDK result contract, action-schema validation, translation prompt, dispatcher scheduling and failure behavior, and every producer agent expected to publish typed results. The execution-backed benchmark is only the measurement layer. That scope could produce a large improvement, but today there is no dependent-task completion rate, no baseline against the repaired current mechanism, no latency or extra-model-call cost, and no result for partial failure, cancellation, or invalid paths.

## Smallest falsification experiment

Use the existing 10 dependent DroidCall case IDs and deterministic in-process tool handlers. Give each producer a fixture result and score the concrete downstream invocation values, not the translated placeholders.

1. Fix only the skipped `pendingRequestAction` queue behavior and add the minimum `resultValue` fixtures needed to run the 10 cases. This is the current-contract baseline.
2. Run one fixed model three times on the same cases through translation and `executeActions()`.
3. Prototype typed result paths only for failures that the repaired baseline cannot express. Include at least one scalar, list, embedded-string, fan-in, object-field, and array-index dependency. The last two can be small synthetic cases because neither public dataset defines them.
4. Record exact end-to-end task success, unresolved references, wrong-type writes, action count, model calls, and latency.

Falsify the proposal if the repaired current mechanism completes at least 8 of the 10 public cases, or if typed paths do not add at least two successful cases without regressing independent multi-action controls. Passing this small test would justify a broader benchmark. It would not yet prove a large product improvement; that requires a representative product-task sample and a measured completion-rate gain.

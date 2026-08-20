# Reviewer 2: typed dataflow plan

## Verdict: REJECT

This is a credible product direction, but it does not clear a breakthrough bar yet. The evidence proves that the current benchmark avoids dependency-bearing requests. It does not prove that a typed, path-addressable plan fixes them, that the public datasets can measure execution without invented semantics, or that users would see a large improvement. There is no completed dependent run, execution result, treatment implementation, or paired gain.

## The 37.08% denominator is not a product-coverage estimate

`cross-dataset-analysis.json` computes 1,179 dependent rows over 3,180 multi-action rows. That arithmetic is correct for its inputs. The interpretation is not.

- The pool mixes DroidCall train and test with Seal-Tools validation, without weighting or a common sampling frame. DroidCall contributes 1,151 of the 1,179 claimed dependent rows, or 97.63%, so the result mostly restates DroidCall's composition.
- The component rates disagree sharply: 42.92% for DroidCall and 5.62% for Seal-Tools. Their pooled rate has no defensible meaning for TypeAgent traffic.
- On held-out data, DroidCall has 23 dependent rows among 46 multi-action test rows. Seal-Tools has 27 strict-order rows among 498 multi-action validation rows. The comparable held-out figure is therefore 50/544, or 9.19%, not 37.08%.
- Even 9.19% is corpus prevalence, not product prevalence. Neither dataset was sampled from TypeAgent requests, and both have synthetic task construction and narrow tool catalogs.
- The Seal count is internally inconsistent. `toExpectedActions` marks a dependency only when a parameter is exactly `API_call_N`, producing 27 strict rows. `analyze.mjs` uses an unanchored regex over serialized gold and reports 28. `sealtools-dev-difficult-207` contains the literal string `"API_call_0 response"`, so the coverage script calls it dependent while the converter calls it parallel.

The defensible statement is narrower: these corpora contain a nontrivial dependency slice, and the current TypeAgent supplemental graders exclude it. Calling 37.08% "combined multi-action coverage" overstates both representativeness and precision.

## Existing support is real but does not already solve the problem

The dispatcher already exposes most of the proposed vocabulary. Multiple actions are enabled by default with result and pending support in `context/session.ts:437-440`. `multipleActionSchema.ts:18-57` defines `resultEntityId`, `pendingResultEntityId`, and `pendingRequests`. `pendingActions.ts:925-938` substitutes a whole `{ "$result": "id" }` value after a producer runs, and `actionHandlers.ts:837-858` registers an action's `resultEntity` and `resultValue`.

That is a narrow, incomplete dataflow mechanism, not a typed plan contract:

- `ResultEntityId` is just `string`. The comment promises `^[A-Za-z0-9_]+$`, but the generated schema uses an unconstrained string. There is no validation for duplicate IDs, missing producers, forward references, cycles, or type compatibility.
- `validate.ts:20-53` accepts `{ "$result": string }` against every expected type. The reference is deliberately untyped until execution. `ActionResultSuccess.resultValue` is `unknown` in `agentSdk/src/action.ts:226-236`, and the repository has no action implementation that assigns `resultValue`.
- Lookup is by the complete ID. There is no path grammar or projection. The dependent probe already produced `selected_files[0]`; the resolver would look for that exact ID and fail because the producer registered `selected_files`.
- The normal execution queue drops every `pendingRequestAction` in `pendingActions.ts:1089-1093`, before the branch in `actionHandlers.ts:776-793` can translate it. Even if that branch were reached, `translatePendingRequestAction` never reads `pendingResultEntityId`; it retranslates the natural-language request using conversation history.
- A pending request can name only one dependency. DroidCall cases such as `droidcall-train-1` require fan-in from two prior outputs. Direct references can represent two IDs syntactically, but an array-producing result becomes a nested array rather than a typed splice or projection.
- The only test found for the new reference shape verifies that it bypasses schema validation. There is no dispatcher execution test for producer-to-consumer value flow, pending retranslation, failure, or cancellation.

So the existing machinery does not refute the need. It does reduce novelty. The breakthrough would have to be the precise output contract, graph validation, path semantics, and reliable execution, not the idea of naming a prior result.

## What the benchmark evidence actually measures

The exclusion claim is supported. `DroidCall/eval/typeAgentGrader.ts:70-82` removes every row containing `#N`; `Seal-Tools/eval/typeAgentGrader.ts:72-91` removes every row matching `API_call_N`. The completed 1,000-row, eight-run experiment explicitly selected independent DroidCall rows and contains no dependent rows. `cross-dataset-analysis.json` records `dependentProbe: null`.

The remaining dependent artifact is an incomplete ten-row, one-model checkpoint from DroidCall train. It has 0/10 TypeAgent passes, one translation error, five rows finalized with `pendingRequestAction`, and one row containing a direct `$result` reference. This is useful failure evidence, but it is not a treatment result. The runner calls `translateRequest` only at `runner.ts:2675-2688`; it never calls `executeActions`.

The official DroidCall grader can normalize direct `$result` IDs back to `#N`, but that still scores a translated plan. Seal's grader does not supply equivalent reference normalization. Neither dataset declares output schemas or runnable tool implementations. An execution lane must therefore invent typed fixture outputs and decide what opaque tokens such as `#0` mean. For example, `droidcall-train-23` asks for the first selected file but its gold only says `#0`, even though `ACTION_GET_CONTENT` says it returns a list. A path-aware system needs semantics the gold does not contain.

## Product scope and likely magnitude

This need not be benchmark-only work. A first-class output schema in the agent SDK, a validated plan IR, typed path selection, and an executor that passes concrete results between real app agents would be product architecture. It could unlock requests that TypeAgent cannot complete safely today.

The current submission establishes none of the product effect. There is no real agent producing typed values, no real multi-agent workflow, no end-to-end completion metric, and no latency or failure analysis. A fixture-only public lane would validate the executor and scorer, but it would still be benchmark infrastructure. It becomes a large product improvement only after at least one real workflow adopts the contract and shows a substantial increase in successful user-visible completion without extra or repeated side effects.

## Smallest falsification experiment

Build one thin vertical slice before designing the general contract. Select 20 held-out cases, ten DroidCall test rows and ten Seal-Tools validation rows, stratified across whole-value use, string interpolation, array fan-in, path selection, and a two-hop dependency. Give their tool stubs explicit output schemas and deterministic fixture results. Do not expose gold placeholders or row IDs to the model.

Run a paired A/B through the real dispatcher and `executeActions` with the same model settings:

- Arm A uses today's `resultEntityId`, `$result`, and pending-request contract.
- Arm B adds the smallest typed output plus JSON Pointer reference needed by those cases, with graph and type validation before the first side effect.

Score the executed call trace, not the translated JSON. A row passes only if every intended action executes once, in dependency order, with the expected concrete downstream values and no extra action. Record plan-valid rate, execution pass rate, retranslation count, latency, and failures before versus after the first side effect.

Predeclare the breakthrough gate as at least 80% end-to-end pass and at least 25 percentage points absolute over Arm A, with no side-effect duplication. Then repeat the winning slice on one real TypeAgent agent pair. If the typed arm misses that gate, only improves placeholder-shaped translation scores, or needs row-specific fixture semantics to interpret `#0` and `API_call_0`, the proposal is falsified as a breakthrough. It remains worthwhile benchmark and executor cleanup.

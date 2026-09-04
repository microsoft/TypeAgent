# Seal-Tools grader vs this report's grader

How the original Seal-Tools benchmark scores tool calls, how this repo's
translation-bench grader scores them, and the parameter-matching change we made.

## The Seal-Tools grader

Source: [`fairyshine/Seal-Tools@ce753ecd`](https://github.com/fairyshine/Seal-Tools/blob/ce753ecd60ed08dd376984035de531ab8421f1c6/LLM_Evaluation/src/llm_tools/evaluation/calculate.py),
function `calculate_score_ToolLearning`.

It reports **corpus-level micro metrics** — there is no per-example pass/fail:

- **Format accuracy (`AMOUNT`)** — the share of rows whose prediction parsed
  (`predict[0] != -1`).
- **API P/R/F1** — a predicted API is correct when its name matches any gold
  API (first name match wins, greedy). `P_api = correct / predicted`,
  `R_api = correct / gold`.
- **Param P/R/F1** — for a routed API, a predicted parameter is correct when its
  **name is in the gold API's parameters** and `str(value) == str(gold value)`.
  `P_param = correct / predicted params`, `R_param = correct / gold params`.

Consequences of that design:

- An **extra** predicted parameter (name not in gold) only lowers precision. It
  never fails the row.
- A **missing** gold parameter only lowers recall.
- Values compare as strings via `str(...)`, case-sensitive.
- The score is an aggregate over the whole set; a single row is never marked
  "failed".

### Pass/fail vs. averaged score

Seal-Tools does **not** grade a row as pass or fail. It pools the counts across
every row — `gold`, `predicted`, and `correct` for both APIs and parameters —
and computes one precision/recall/F1 at the end (micro-averaging). So a row with
one wrong parameter does not "fail"; it just contributes, say, 5 correct out of
6 gold parameters to the totals and nudges the corpus number down a little.

This report is the opposite: each case is a binary PASS or FAIL, and the
headline is the pass rate.

### What `P`, `R`, `_api`, and `_param` mean

- **`P` = precision** = `correct / predicted` — of what the model produced, how
  much was right. Extra or wrong output lowers precision.
- **`R` = recall** = `correct / gold` — of what was expected, how much the model
  produced. Missing output lowers recall.
- **`F1`** = the harmonic mean of `P` and `R` — one balanced number.
- **`_api`** measures over tool/API calls; **`_param`** measures over the
  parameters inside the matched calls.

Rule of thumb: extra or wrong output hurts **precision**; missing output hurts
**recall**.

## The Seal-Tools score we report

For this test the primary score is a faithful port of
`calculate_score_ToolLearning` (`scoreSealToolsOfficial` in
`eval/sealToolsGrader.ts`): corpus-level format accuracy plus micro-averaged
tool and parameter precision, recall, and F1, using the same greedy first-match
routing and the same `str(...)`-style value compare.

The model is prompted with TypeAgent's `{ actionName, parameters }` envelope,
not Seal's `[{ api, parameters, responses }]` envelope. A protocol adapter
therefore extracts raw TypeAgent actions before the pinned Seal counters run.
TypeAgent schema validation does not decide whether a raw prediction is scored.

**The one deviation:** string comparison is **case-insensitive**. API names,
parameter names, and every nested string value are folded to lower case before
they are compared. Everything else matches Seal exactly, including the guard
that only reports P/R/F1 when `correct * predicted * gold > 0`.

The report shows two tables:

- **Seal-Tools metrics (case-insensitive strings)** — the primary score for this
  test (the deviation above).
- **Official Seal-Tools metrics (case-sensitive)** — the creator's exact
  case-sensitive score, kept for reference.

The TypeAgent pass/fail numbers described below are supplemental.

## This report's grader

This harness scores each case as a **binary pass** plus aggregate rates. A case
soft-passes when every gold action is routed to a chosen action and its
parameters match; on top of that the report shows exact pass, schema-valid rate,
tool/param scores, FNR/FPR, and deterministic diagnostic counts.

Because it is per-case, a single wrong or extra field can flip a case to FAIL —
stricter than Seal-Tools, where the same field only nudges precision.

## What we changed

For the default `exact` parameter mode, an **extra chosen field that is not in
gold is now optional** and no longer fails the case:

- A field the model adds that gold never asked for is ignored (this matches
  Seal-Tools, where an extra parameter only lowers precision).
- **Gold fields stay required**: each must be present in the chosen action and
  match, using normalized equality. String values compare as normalized strings
  (the intent behind Seal-Tools' `str(...)` compare).
- Explicit `exists` / `nonempty` field modes still require presence, so
  deliberately-required fields keep their guarantee.

Before, the `exact` rule also failed the case on **any** extra chosen field.
That is what failed `sealtools-dev-difficult-201`.

We did not loosen the other direction: a **missing gold field still fails** the
case (and still counts as `missingRequiredParameter`). Otherwise a chosen action
with empty parameters would pass against a multi-parameter gold, which is not a
correct translation.

Both the pass/fail path (`parametersMatch`) and the diagnostic counts
(`diagnoseParametersWithScoreSpec`) in
`ts/packages/benchmarks/src/translationBench/runner/runner.ts` were updated
together, so an extra chosen field no longer fires `extraneousParameter`.

Net effect: our per-case pass now matches Seal-Tools' precision behavior — extra
parameters do not fail a case — while keeping gold parameters required.

## Example — `sealtools-dev-difficult-201`

The case has three gold actions, each with two parameters:

1. `getCloudSlaInfo { service_name: "AWS", service_type: "compute" }`
2. `backupData { source_path: "/home/user/data", destination_path: "/cloud_backup/data" }`
3. `updateShipmentDetails { shipment_id: "ZzRpnklbRL", new_details: "..." }`

The model matched everything but added one extra field to the first action:
`getCloudSlaInfo { service_name: "AWS", region: "us-east-1", service_type: "compute" }`.

### How Seal-Tools scores it

- APIs: `gold = 3`, `predicted = 3`, `correct = 3` → `P_api = 3/3 = 1.00`,
  `R_api = 3/3 = 1.00`, `F1_api = 1.00`.
- Params: `gold = 6`, `predicted = 7` (the extra `region`), `correct = 6`
  (`region` is not in gold, so it is not correct) →
  `P_param = 6/7 = 0.857`, `R_param = 6/6 = 1.00`, `F1_param = 0.923`.

So Seal-Tools barely dings this row — the extra field pulls parameter precision
from 1.00 to 0.857 and nothing else.

### How this report scores it

- **Before:** FAIL — the whole case scored 0 toward pass rate because `region`
  was extraneous. One optional field flipped a `6/6`-correct row to a hard 0.
- **After:** PASS — `region` is optional (present only on the chosen side);
  `service_name` and `service_type` match on both sides, and actions 2 and 3
  match exactly.

The new rule brings our binary pass in line with the Seal-Tools signal: a row
that is `0.923` param-F1 for Seal should not be a hard 0 for us.

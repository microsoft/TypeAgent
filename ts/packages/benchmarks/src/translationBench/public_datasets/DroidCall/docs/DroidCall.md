# DroidCall data analysis

The full DroidCall dataset has 10,271 rows and 14,325 gold calls. Single-tool requests account for 73.89% of rows. The other 26.11% are multi-call requests; 42.92% of those pass a prior result into a later call.

Source: [mllmTeam/DroidCall](https://huggingface.co/datasets/mllmTeam/DroidCall), revision `42563ae614280d2891d57f1e7057c4bc50dd27bd`. The local snapshot has 8 files (43.67 MiB). It includes every file listed by the HuggingFace repository at that revision.

## Classification

The analysis reads the structured `answers` in `DroidCall_train.jsonl` and `DroidCall_test.jsonl`. The buckets are mutually exclusive:

- Single tool: exactly one gold call.
- Multi-call, nested: at least two calls and an argument contains a `#N` result reference. The reference can be the whole value or part of a larger string, and it can occur inside an array or object.
- Multi-call, without nesting: at least two calls and no argument contains a result reference.

## Full dataset

10,271 rows contain 14,325 calls. 2,682 rows (26.11%) have more than one call. Of those multi-call rows, 42.92% pass a prior result into a later call.

| Shape                       |  Rows | Share of rows |
| --------------------------- | ----: | ------------: |
| Single tool                 | 7,589 |        73.89% |
| Multi-call, nested          | 1,151 |        11.21% |
| Multi-call, without nesting | 1,531 |        14.91% |

Rows by call count: 1: 7,589, 2: 1,523, 3: 965, 4: 177, 5: 15, 6: 2.

## Training split

10,071 rows contain 14,053 calls. 2,636 rows (26.17%) have more than one call. Of those multi-call rows, 42.79% pass a prior result into a later call.

| Shape                       |  Rows | Share of rows |
| --------------------------- | ----: | ------------: |
| Single tool                 | 7,435 |        73.83% |
| Multi-call, nested          | 1,128 |        11.20% |
| Multi-call, without nesting | 1,508 |        14.97% |

Rows by call count: 1: 7,435, 2: 1,499, 3: 947, 4: 173, 5: 15, 6: 2.

## Test split

200 rows contain 272 calls. 46 rows (23.00%) have more than one call. Of those multi-call rows, 50.00% pass a prior result into a later call.

| Shape                       | Rows | Share of rows |
| --------------------------- | ---: | ------------: |
| Single tool                 |  154 |        77.00% |
| Multi-call, nested          |   23 |        11.50% |
| Multi-call, without nesting |   23 |        11.50% |

Rows by call count: 1: 154, 2: 24, 3: 18, 4: 4.

## Parser reuse and validation

DroidCall's assistant output uses Python-like function calls. `parseDroidCallCode()` handles the assignment and call syntax, then delegates strings, numbers, booleans, nulls, arrays, and objects to Seal-Tools' existing `parsePythonLiteral()`. This keeps one literal parser for both datasets.

The code-format file covers the 10,071 training rows. Parsed calls exactly match the canonical structured answers for 10,069 rows (99.98%). There are 0 parse failures and 2 source mismatches. The two mismatches are source anomalies: one gold function name is a sentence-like value that is not a valid function identifier, and one gold argument key starts with a space that the code syntax cannot preserve.

## Multi-action TypeAgent suite

`droid-call-multi-action.jsonl` contains every row with at least two gold
calls. The converter keeps the source order, so train rows come before test
rows. IDs use `droidcall-{split}-{source index}` and remain stable when the
dataset is regenerated.

| Converted shape        |  Rows |
| ---------------------- | ----: |
| Nested, strict order   | 1,151 |
| Independent, any order | 1,531 |
| Total                  | 2,682 |

Each converted row keeps its own source tool catalog. The eight source type
forms map to TypeAgent JSON Schema types. DroidCall's two dictionary arguments
are both `contact_info`; their documented `email`, `phone`, `name`, `company`,
and `address` fields become optional strings because TypeAgent requires closed
object schemas.

## Scoring

The primary grader matches DroidCall's upstream `result_checker.py` at commit
`3f7ba458bee480a86c602edff6cc7ec9cfd555db`. It reports soft accuracy and exact
row accuracy. The contract checks every argument in the API catalog, applies
documented defaults, trims and lowercases strings, treats lists as unordered,
and uses BERTScore 0.3.13 with a threshold of 0.85 for semantic fields.
Transformers is pinned to 4.48.1 because BERTScore 0.3.13 is incompatible with
Transformers 5.

The grader converts TypeAgent result references back to DroidCall's `#N`
notation before comparison. A persistent Python worker keeps the BERT model in
memory across models. The old Seal-style tool and parameter F1 scores remain
in the output as secondary diagnostics and are labeled as such.

TypeAgent pass/fail remains supplemental. It excludes result-dependent rows
because `#N` values describe runtime dependencies rather than literal final
parameters.

## Grader contract audit

The converted corpus contains 6,736 calls across 2,682 rows. All calls resolve
to one of the 24 APIs in `annotated_api.jsonl`. The upstream scorer covers 47
catalog arguments: 25 required, 22 optional, and 9 marked for semantic
comparison.

The source data has a few defects that the official scorer inherits:

- 7 gold arguments are not present in the API catalog, so the scorer ignores
  them.
- 2 gold calls omit a required catalog argument. The scorer always marks that
  argument wrong.
- 1 result reference points to its own call instead of an earlier call.
- 488 rows repeat a tool name. The upstream scorer keeps only the last
  prediction for each name and compares it with every gold call of that name.

The corpus has 1,724 result-reference values. Of those, 92 embed `#N` inside a
larger string. It also has 1,709 gold uses of semantic arguments and 3,229
explicit optional arguments.

## 30-row model run and score audit

The run on 2026-08-19 used the first 30 converted rows. The slice contains 15
nested rows and 15 independent rows. All eight model specs used the same
dataset, raw-response restoration, and grader.

| Model spec                | Official soft accuracy | Official exact accuracy | Seal parameter F1 |
| ------------------------- | ---------------------: | ----------------------: | ----------------: |
| `azure/gpt-4.1`           |                  76.9% |                   36.7% |             53.5% |
| `azure/gpt-4.1-mini`      |                  73.9% |                   33.3% |             53.8% |
| `azure/gpt-5.4-nano`      |                  70.6% |                   33.3% |             55.1% |
| `azure/gpt-5.6-sol`       |                  75.4% |                   33.3% |             56.7% |
| `azure/gpt-5.6-terra`     |                  73.5% |                   33.3% |             56.0% |
| `azure/gpt-5.6-luna#none` |                  78.6% |                   36.7% |             56.6% |
| `azure/gpt-5.6-luna#low`  |                  76.2% |                   36.7% |             56.0% |
| `azure/gpt-4o`            |                  81.4% |                   40.0% |             54.1% |

The 53.5% to 56.7% parameter F1 range was low mainly because it applied the
Seal counting contract to DroidCall. Six sampled rows repeat tool names, but
the Seal-compatible grader matched every prediction to the first same-named
gold call. Correct one-to-one matching raises the diagnostic by about 6 to 7
points. Converting TypeAgent result references to `#N` adds another 5 to 7
points. Nested rows scored 43.6% to 49.7% before those adjustments, while
independent rows scored 64.6% to 71.8%. Only three gold parameters are null,
so null and default handling did not cause the low F1.

The official score also gives credit when optional arguments are jointly
omitted and uses semantic comparison for generated text. On this slice it
raises soft accuracy to 70.6% to 81.4%. Exact row accuracy remains 33.3% to
40.0%, so the models still make real parameter errors after the grader
contract is corrected.

Artifacts are under `output/droidcall/multi-action-30/`. The directory has one
checkpoint, JSON result, and HTML report per model, plus `trajectories.jsonl`
and `summary.json`. The five-row smoke run is under
`output/droidcall/multi-action-5/`.

## 1,000-row independent multi-action run

The completed run selected the first 1,000 `order: "any"` rows before applying
the row limit. It contains no strict-order rows and no result references, so it
excludes all 1,151 nested or dependent rows. Each model evaluated the same
1,000 cases and 2,400 gold calls.

| Model spec                | Official soft | Official exact | Tool F1 | Parameter F1 | Errors |
| ------------------------- | ------------: | -------------: | ------: | -----------: | -----: |
| `azure/gpt-4.1`           |         88.2% |          56.9% |   99.4% |        78.2% |      0 |
| `azure/gpt-4.1-mini`      |         88.7% |          57.7% |   99.3% |        78.9% |      0 |
| `azure/gpt-5.4-nano`      |         88.0% |          56.4% |   99.1% |        75.5% |      4 |
| `azure/gpt-5.6-sol`       |         88.5% |          57.5% |   97.7% |        76.8% |      0 |
| `azure/gpt-5.6-terra`     |         88.8% |          57.1% |   97.6% |        77.0% |      0 |
| `azure/gpt-5.6-luna#none` |         88.7% |          56.4% |   98.1% |        76.2% |      0 |
| `azure/gpt-5.6-luna#low`  |         88.2% |          55.8% |   98.0% |        76.2% |      0 |
| `azure/gpt-4o`            |         88.2% |          56.5% |   99.5% |        77.6% |      0 |

Official soft and exact accuracy use the pinned upstream DroidCall contract.
Tool and parameter F1 are case-insensitive Seal-compatible diagnostics. The
full run has eight 1,000-row result files, eight complete checkpoints, and
8,000 unique raw trajectory records under
`output/droidcall/multi-action-1000/`. A no-op rerun restored all checkpoints
and left the trajectory count unchanged.

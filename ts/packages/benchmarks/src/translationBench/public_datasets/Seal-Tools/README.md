# Seal-Tools → TypeAgent (`seal-tools-validation`)

Adapter that turns the public [`casey-martin/Seal-Tools`](https://huggingface.co/datasets/casey-martin/Seal-Tools)
dataset (NLPCC 2024, [arXiv:2405.08355](https://arxiv.org/abs/2405.08355)) into a
TypeAgent translation-bench dataset named **`seal-tools-validation`**.

## Files

- `get-dataset.ts` — downloads the HuggingFace **`validation`** split (700 rows)
  via the datasets-server rows API (JSON, no parquet reader) and caches it as
  `seal-tools-validation.hf.jsonl`.
- `pythonLiteral.ts` — tolerant parser for the Python `repr()` literals embedded
  in each row's conversation (`api_list = [...]`, and the gold call list).
- `toTypeAgentSchema.ts` — `toTypeAgentEvalRow()` casts one row into a
  self-contained TypeAgent **eval row**: the utterance plus **only that row's
  own `api_list` tools** (OpenAI function form) and the gold ordered actions.
- `typeAgentOverrides.ts` — audited corrections and exclusions used only by the
  supplemental TypeAgent score. Raw Seal gold remains unchanged.
- `index.ts` — entry point that runs download → convert → write JSONL.

## Mapping

Each Seal-Tools row → one eval row. The tools live **on the row**, so every case
keeps its exact candidate set instead of a shared global catalog.

| Seal-Tools (`conversations`)             | TypeAgent eval row                          |
| ---------------------------------------- | ------------------------------------------- |
| `human` → `api_list = [...]`             | `tools` — this row's candidate set only     |
| `human` → `task_instruction`             | `utterance`                                 |
| `gpt` → `[{api, parameters, responses}]` | ordered `expectedActions[]`                 |
| a param exactly reusing an `API_call_N`  | `order: "strict"` + literal Seal gold value |
| no data dependency                       | `order: "any"`                              |

Loose Seal-Tools types (`str`, `int`, `float`, `bool`, `list`, `dict`) map to
JSON-Schema types for the function tools.

The supplemental TypeAgent pass score filters every gold payload containing
`API_call_*`, including result-reference strings that do not set `order` to
`strict`. It also excludes audited source rows that cannot be answered from the
request. Rows with a clear source-gold error use an explicit corrected
`expectedActions` value. Each affected row records the reason in
`typeAgentScoring`.

## Build & run

From `ts/packages/benchmarks`:

```bash
pnpm run build
node dist/translationBench/public_datasets/Seal-Tools/index.js
```

Outputs land in this folder:

- `seal-tools-validation.jsonl` — one self-contained eval row per line (utterance
  - its own tools + gold actions). Committed via **Git LFS** (`.gitattributes`).
- `seal-tools-validation.hf.jsonl` — the raw HuggingFace download cache;
  **gitignored** and reused on the next run to skip re-downloading.

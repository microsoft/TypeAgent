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
- `index.ts` — entry point that runs download → convert → write JSONL.

## Mapping

Each Seal-Tools row → one eval row. The tools live **on the row**, so every case
keeps its exact candidate set instead of a shared global catalog.

| Seal-Tools (`conversations`) | TypeAgent eval row |
|---|---|
| `human` → `api_list = [...]` | `tools` — this row's candidate set only |
| `human` → `task_instruction` | `utterance` |
| `gpt` → `[{api, parameters, responses}]` | ordered `expectedActions[]` |
| a param reusing an earlier `API_call_N` | `order: "strict"` + `${stepK.result}` ref |
| no data dependency | `order: "any"` |

Loose Seal-Tools types (`str`, `int`, `float`, `bool`, `list`, `dict`) map to
JSON-Schema types for the function tools.

## Build & run

From `ts/packages/benchmarks`:

```bash
pnpm run build
node dist/translationBench/public_datasets/Seal-Tools/index.js
```

Outputs land in this folder:
- `seal-tools-validation.jsonl` — one self-contained eval row per line (utterance
  + its own tools + gold actions). Committed via **Git LFS** (`.gitattributes`).
- `seal-tools-validation.hf.jsonl` — the raw HuggingFace download cache;
  **gitignored** and reused on the next run to skip re-downloading.

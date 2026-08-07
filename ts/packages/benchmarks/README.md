# @typeagent/benchmarks

Action-translation eval for TypeAgent: pinned catalogs, model prices, and scoring harness.

## Catalog + action-parameters grader

Pinned `catalog.generated.json` and `action-parameters-grader.generated.json`. Regenerate with `pnpm run gen-catalog` (grader is incremental by default; pass `--force` for a full rebuild, `--model <name>` for LLM fallback). Tests: `pnpm run test:local`.

## Dataset synthesizer (part 3)

Simple-action dataset generation only (one expected action per positive/seed).

- Core: `src/translationBench/synthesizer/` — benchmark JSONL, source import, LLM labeler, quality verifier
- Default shape: `mode: "simple"` via `actionShape.ts` (multi reserved for a later PR)
- Seed example: `synthesizer/seed/`
- Unit tests: `test/translationBench.{benchmark,datasetGenerator,sourceBuilder}.spec.ts`

```bash
cd ts/packages/benchmarks && pnpm run build && pnpm run jest-esm --testPathPattern="translationBench\.(benchmark|datasetGenerator|sourceBuilder)"
```

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.

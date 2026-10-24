# @typeagent/benchmarks

Action-translation eval for TypeAgent: pinned catalogs, model prices, and scoring harness.

## Conversation-memory benchmarks

The [memory benchmark runbook](src/memoryBench/README.md) covers **BEAM and
LongMemEval**, offline tests, pinned inputs/protocols, live execution, progress
and resume. Both run from `pnpm --filter @typeagent/benchmarks memory-bench run
--dataset <beam|longmemeval>` and require no Python runtime.

BEAM supports BM25/content/event RAG and native content answering. LongMemEval
preserves the configured production factory, original session/time metadata,
native answers and official pinned judge prompts. Its `s-cleaned` and
evidence-only `oracle` variants are distinct experimental arms.

Use `pnpm --filter @typeagent/benchmarks memory-bench run --help` for dataset-aware
options and `pnpm --filter @typeagent/benchmarks test:memory` for offline tests.
Readiness/fault-injection and profiling remain in qualification tools; the
former LongMemEval tools are compatibility launchers, not a second evaluator.

## Catalog + action-parameters grader

Pinned `catalog.generated.json` and `action-parameters-grader.generated.json`. Code/script parameters use verify mode `llmAsAJudge` (not exact); synthesizer exclusions are derived from those fields. Regenerate with `pnpm run gen-catalog` (`--force` full rebuild). Tests: `pnpm run test:local`.

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

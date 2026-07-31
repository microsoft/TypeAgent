# @typeagent/benchmarks

Part 1 scaffold for the TypeAgent action-translation eval.

## What's in this PR

- Package layout + `core/paths` + minimal `core/types`
- `pnpm run gen-catalog` → `src/translationBench/catalog.generated.json`
- `pnpm run snapshot-prices` → `src/core/model-prices.generated.json` (OpenAI models only)

Later parts add the runner, datasets, and matrix CLI.

## Scripts

```bash
cd ts/packages/benchmarks
pnpm run build
pnpm run gen-catalog
pnpm run snapshot-prices
```

## License

MIT

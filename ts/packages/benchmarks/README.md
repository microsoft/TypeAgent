# @typeagent/benchmarks

Action-translation eval for TypeAgent: pinned catalogs, model prices, and scoring harness.

## Catalog + action-parameters grader

Checked-in artifacts:

- `src/translationBench/catalog.generated.json` — action schemas → parameter summaries + `paramSpec` trees
- `src/translationBench/action-parameters-grader.generated.json` — per-action create/verify policies for labeling and soft scoring

Regenerate (schema-only genCatalog; no full agent runtime):

```bash
cd ts/packages/benchmarks
pnpm run gen-catalog
# or grader only (incremental):
pnpm run gen-action-parameters-grader
# force full reclassify:
pnpm run gen-action-parameters-grader -- --force
# LLM fallback for fields without regex rules:
pnpm run gen-action-parameters-grader -- --model <configured-chat-model>
```

Notes:

- `genCatalog` expands `type-union` (e.g. moniker literals `| string`) instead of collapsing to `kind: "any"`.
- Grader classification is regex-first, then optional LLM; open free-text strings soft-default to `nonempty` (never random modes).
- Unit tests: `pnpm run test:local` (catalogGenerator specs).

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.

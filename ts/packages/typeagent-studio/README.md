# TypeAgent Studio

VS Code extension delivering the TypeAgent developer experience: agent authoring (J1), schema/grammar tuning (J2/J3), compare-and-replay regression detection (J4 — the headline), trace investigation (J5), live observation (J6).

**Skeleton only** at this point. See [docs/plans/vscode-devx/](../../docs/plans/vscode-devx/) for the five-phase plan; this package corresponds to the work tracked in [05-implementation-plan.md §1](../../docs/plans/vscode-devx/05-implementation-plan.md).

## Build

```pwsh
cd packages/typeagent-studio
pnpm run build
```

Produces `dist/extension.js`. Currently registers a single command `TypeAgent Studio: Hello (skeleton)` whose only job is to prove activation works end-to-end against `@typeagent/core`.

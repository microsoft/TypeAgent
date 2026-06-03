# TypeAgent Studio

VS Code extension delivering the TypeAgent developer experience: agent authoring (J1), schema/grammar tuning (J2/J3), compare-and-replay regression detection (J4 — the headline), trace investigation (J5), live observation (J6).

See [docs/plans/vscode-devx/](../../docs/plans/vscode-devx/) for the five-phase plan; this package corresponds to the work tracked in [05-implementation-plan.md §1](../../docs/plans/vscode-devx/05-implementation-plan.md).

## Build

```pwsh
cd packages/typeagent-studio
pnpm run build
```

Produces `dist/extension.js`.

## Local Test Loop

```pwsh
cd packages/typeagent-studio
pnpm run test:local
pnpm run build
```

## Commands

Current command palette surface:

- TypeAgent Studio: Hello (skeleton)
- TypeAgent Studio: Start onboarding session
- TypeAgent Studio: Ask TypeAgent about this...
- TypeAgent Studio: Install latest onboarding session to sandbox
- TypeAgent Studio: Clear onboarding session
- TypeAgent Studio: Run onboarding phase
- TypeAgent Studio: Advance onboarding phase
- TypeAgent Studio: Run remaining onboarding phases
- TypeAgent Studio: Show onboarding snapshot
- TypeAgent Studio: Restore onboarding phase
- TypeAgent Studio: Open onboarding summary
- TypeAgent Studio: Copy onboarding summary
- TypeAgent Studio: Save onboarding summary

## Settings

- `typeagentStudio.onboarding.openSummaryAfterBatchRun` (boolean, default `true`): Automatically opens onboarding summary after running remaining onboarding phases.

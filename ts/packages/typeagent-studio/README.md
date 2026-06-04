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
- TypeAgent Studio: Check packaging health gate
- TypeAgent Studio: Clear onboarding session
- TypeAgent Studio: Run onboarding phase
- TypeAgent Studio: Advance onboarding phase
- TypeAgent Studio: Run remaining onboarding phases
- TypeAgent Studio: Show onboarding snapshot
- TypeAgent Studio: Restore onboarding phase
- TypeAgent Studio: Rerun stale onboarding phases
- TypeAgent Studio: Open onboarding summary
- TypeAgent Studio: Copy onboarding summary
- TypeAgent Studio: Save onboarding summary
- TypeAgent Studio: Toggle auto-open summary after batch run
- TypeAgent Studio: Cycle install health gate policy
- TypeAgent Studio: Set install health gate policy

Install behavior for `Install latest onboarding session to sandbox`:

- Prefers explicit artifact paths emitted by onboarding `Scaffolder`/`Packaging` phase outputs.
- Falls back to onboarding workspace record at `~/.typeagent/onboarding/<agent>/scaffolder/scaffolded-to.txt`.
- Falls back to local workspace candidates under `packages/agents/<agentName>`.
- Loads the resolved local artifact path into the sandbox before marking the session installed.
- Runs the packaging health gate (F1.4) before install when artifact path maps to `packages/agents/<agent>`.
- Blocks on health errors by default, with an explicit "Install anyway" confirmation path.
- Offers a manual artifact picker fallback when auto-resolution cannot locate a local generated artifact.

Restore behavior for `Restore onboarding phase`:

- Marks downstream completed phases stale (per onboarding bridge semantics).
- Prompts to re-run stale downstream phases immediately for reconciliation.

Manual reconciliation behavior for `Rerun stale onboarding phases`:

- Lists currently stale phases and allows selecting one or many to rerun.
- Re-runs only the selected stale phases in order.

## Settings

- `typeagentStudio.onboarding.openSummaryAfterBatchRun` (boolean, default `true`): Automatically opens onboarding summary after running remaining onboarding phases.
- `typeagentStudio.onboarding.installHealthGatePolicy` (`enforce` | `warn`, default `enforce`): Controls install behavior when packaging health gate reports errors.

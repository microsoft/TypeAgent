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
- TypeAgent Studio: Resolve install artifact path
- TypeAgent Studio: Check packaging health gate
- TypeAgent Studio: Enforce packaging health gate
- TypeAgent Studio: Clear onboarding session
- TypeAgent Studio: Run onboarding phase
- TypeAgent Studio: Advance onboarding phase
- TypeAgent Studio: Run remaining onboarding phases
- TypeAgent Studio: Show onboarding snapshot
- TypeAgent Studio: Export onboarding artifact... (summary, health snapshot, settings snapshot, packaging health report, or diagnostics bundle; show / open / copy / save)
- TypeAgent Studio: Restore onboarding phase
- TypeAgent Studio: Rerun stale onboarding phases
- TypeAgent Studio: Toggle auto-open summary after batch run
- TypeAgent Studio: Cycle install health gate policy
- TypeAgent Studio: Set install health gate policy
- TypeAgent Studio: Start sandbox
- TypeAgent Studio: Stop sandbox
- TypeAgent Studio: Restart sandbox
- TypeAgent Studio: Refresh sandboxes
- TypeAgent Studio: Refresh corpora

## Sandboxes view

The **TypeAgent Studio** activity-bar container hosts a **Sandboxes** tree view
backed by the in-memory sandbox manager and event stream from
`@typeagent/core`:

- Top-level rows list running sandboxes (id, state, agent count); a placeholder
  row is shown when none are running.
- Expanding a sandbox lists its loaded agents with a per-agent health badge.
- The view title offers **Start sandbox** and **Refresh**; running sandbox rows
  offer inline **Restart** and **Stop**, and stopped rows offer inline **Start**.
- The tree refreshes automatically on sandbox lifecycle events
  (start/stop/restart, agent load/unload).

Tree structuring and labelling live in the vscode-free
`sandboxTreePresentation.ts` module so they can be unit-tested without the
editor host; `sandboxTreeProvider.ts` is a thin `TreeDataProvider` adapter.

## Corpora view

The same **TypeAgent Studio** container hosts a **Corpora** tree view backed by
the `FileCorpusService` federation from `@typeagent/core`:

- Top-level rows list agents that currently have a corpus view — derived from
  the union of agents loaded across running sandboxes; a placeholder row is
  shown when none are loaded.
- Expanding an agent groups its federated entries by source (in-repo, captures,
  external, feedback), each with an entry count; only sources with entries are
  shown.
- Expanding a source lists its entries by utterance, with a feedback badge when
  the entry has recorded feedback.
- The view title offers **Refresh**; the tree also refreshes automatically when
  sandbox agents are loaded or unloaded.

Grouping and labelling live in the vscode-free `corpusTreePresentation.ts`
module (unit-tested); `corpusTreeProvider.ts` is a thin `TreeDataProvider`
adapter.

Install behavior for `Install latest onboarding session to sandbox`:

- Prefers explicit artifact paths emitted by onboarding `Scaffolder`/`Packaging` phase outputs.
- Falls back to onboarding workspace record at `~/.typeagent/onboarding/<agent>/scaffolder/scaffolded-to.txt`.
- Falls back to local workspace candidates under `packages/agents/<agentName>`.
- Loads the resolved local artifact path into the sandbox before marking the session installed.
- Runs the packaging health gate (F1.4) before install when artifact path maps to `packages/agents/<agent>`.
- Blocks on health errors by default, with an explicit "Install anyway" confirmation path.
- Offers a manual artifact picker fallback when auto-resolution cannot locate a local generated artifact.

Troubleshooting behavior for `Resolve install artifact path`:

- Resolves the active session artifact path using the same logic as install.
- Offers quick actions to copy the path or reveal it in the OS file explorer.

Restore behavior for `Restore onboarding phase`:

- Marks downstream completed phases stale (per onboarding bridge semantics).
- Prompts to re-run stale downstream phases immediately for reconciliation.

Manual reconciliation behavior for `Rerun stale onboarding phases`:

- Lists currently stale phases and allows selecting one or many to rerun.
- Re-runs only the selected stale phases in order.

Export behavior for `Export onboarding artifact...`:

- Prompts for an artifact (onboarding summary, health snapshot, settings snapshot, packaging health report, or diagnostics bundle) and a destination (show / open / copy / save).
- `Show` displays a modal summary; `Open` opens Markdown in an editor tab; `Copy` writes Markdown to the clipboard; `Save` writes Markdown to disk using the artifact's configured default filename.
- The diagnostics bundle aggregates the onboarding summary, health snapshot, packaging health report, resolved install artifact path, and the active onboarding settings snapshot into a single Markdown document.
- Health and packaging artifacts fall back to an unavailable gate status when no active install artifact path can be resolved.

## Settings

- `typeagentStudio.onboarding.openSummaryAfterBatchRun` (boolean, default `true`): Automatically opens onboarding summary after running remaining onboarding phases.
- `typeagentStudio.onboarding.defaultSandboxId` (string, default `studio-default`): Default sandbox id used by install workflows.
- `typeagentStudio.onboarding.diagnosticsDefaultFileName` (string, default `onboarding-diagnostics.md`): Default filename suggested when saving diagnostics bundles.
- `typeagentStudio.onboarding.settingsSnapshotDefaultFileName` (string, default `onboarding-settings.md`): Default filename suggested when saving onboarding settings snapshots.
- `typeagentStudio.onboarding.packagingHealthReportDefaultFileName` (string, default `packaging-health-report.md`): Default filename suggested when saving packaging health reports.
- `typeagentStudio.onboarding.onboardingSummaryDefaultFileName` (string, default `onboarding-summary.md`): Default filename suggested when saving onboarding summaries.
- `typeagentStudio.onboarding.onboardingHealthSnapshotDefaultFileName` (string, default `onboarding-health-snapshot.md`): Default filename suggested when saving onboarding health snapshots.
- `typeagentStudio.onboarding.installHealthGatePolicy` (`enforce` | `warn`, default `enforce`): Controls install behavior when packaging health gate reports errors.

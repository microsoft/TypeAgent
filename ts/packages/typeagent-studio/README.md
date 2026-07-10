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
  offer inline **Restart**, **Stop**, and **Load agent**, stopped rows offer
  inline **Start**, and each agent row offers inline **Unload agent**.
- The tree refreshes automatically on sandbox lifecycle events
  (start/stop/restart, agent load/unload).

Loaded agents are resolved by a filesystem-backed loader
(`createRepoAgentLoader` in `@typeagent/core`) that reads the agent's source
under `packages/agents/<name>`, computes real SHA-256 content hashes for its
schema and grammar files, and derives the health badge from the same
`FileHealthService` rules used elsewhere (agents missing on disk report
`unknown` health and a `none` hash sentinel).

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
- Expanding a source lists its entries by utterance.
- The view title offers **Refresh**; the tree also refreshes automatically when
  sandbox agents are loaded or unloaded.

Grouping and labelling live in the vscode-free `corpusTreePresentation.ts`
module (unit-tested); `corpusTreeProvider.ts` is a thin `TreeDataProvider`
adapter.

## Replay & compare

Each agent row in the Corpora view offers **Replay corpus** (the rerun icon),
alongside **Open Impact Report** (the graph icon) which runs the same replay in
a webview (F4.1):

- The runtime replays that agent's federated corpus through the
  `replayCorpus()` engine from `@typeagent/core`, evaluating each utterance
  against versions A and B and producing an `ActionDelta` per row.
- Each row is classified as **equal**, **changed**, **new match**, or **lost
  match**; the run emits `replay.row`/`replay.summary` events that appear live
  in the Event Log, and a summary headline is shown when it finishes.
- When the run finds differences, the result offers a quick pick of the rows
  (icon, utterance, per-version cache state, and latency). The run is saved as
  the agent's **last run**, so the Impact Report re-renders it (with a **Last
  run** timestamp) when reopened.

The engine is deterministic and dependency-injected: corpus access and the
per-version action resolver are supplied by the caller. The default resolver
does an identity replay over each entry's captured `expectedAction` (an
all-equal baseline) until a real per-version build/dispatch is wired in. Row and
summary formatting lives in the vscode-free `replayPresentation.ts` module
(unit-tested); the engine lives in `@typeagent/core/replay`.

## Health status bar

A status-bar item summarizes agent health across running sandboxes:

- Aggregates the per-agent `health` of every agent loaded into a running
  sandbox into a single worst-case badge (error > warning > unknown > healthy).
- Shows a neutral "no agents" state when nothing is loaded, and colors the item
  with the editor's warning/error status-bar background for those levels.
- Updates automatically on sandbox lifecycle events; clicking it focuses the
  Sandboxes view.

The aggregation lives in the vscode-free `healthStatusPresentation.ts` module
(unit-tested); `studioStatusBar.ts` is a thin `StatusBarItem` adapter.

## Event Log view

The **TypeAgent Studio** container also hosts an **Event Log** view backed by
the structured event stream (`InProcessEventStream`) from `@typeagent/core`:

- Shows recent events newest-first (capped at 200), each summarized to a single
  line with a per-type icon, a UTC `HH:MM:SS` timestamp, and the agent when
  present; a tooltip carries the type, full timestamp, sandbox, and correlation
  ids.
- Seeds from the stream's ring buffer on activation and appends live as events
  are emitted.
- The view title offers **Refresh** and **Clear**.

Summarization lives in the vscode-free `eventLogPresentation.ts` module
(unit-tested); `eventLogTreeProvider.ts` is a thin `TreeDataProvider` adapter
that owns the bounded newest-first ring.

## Collisions view

The **TypeAgent Studio** container also hosts a **Collisions** view backed by
the `InProcessCollisionService` and `collision.detected` event stream from
`@typeagent/core`:

- Lists detected schema/grammar collisions newest-first (capped at 200), each
  labelled by kind (`overlap`/`shadow`/`ambiguity`) and a compact participant
  summary, with the detection point (`load`, `schema-edit`, `grammar-edit`,
  `replay`) as the description.
- Expanding a collision reveals its participants (agent action types with the
  contributing file and line) and any exemplar utterances that witness the
  overlap. Clicking a participant opens its grammar source (the authored
  `.agr` when present, otherwise the compiled `.ag.json`).
- Reported collisions also appear in the Event Log; the view title offers
  **Scan grammars for collisions**, **Refresh**, and **Clear**.

**Scan grammars for collisions** runs the real NFA overlap engine
(`grammar-tools-core`) over the compiled grammars (`*.ag.json`) of the agents
loaded across running sandboxes: it compiles each grammar, intersects every
cross-schema pair, and reports each detected overlap (with a witness utterance
and the contributing rule patterns) into the store. Each scan replaces the
prior `grammar-edit` collisions so the view tracks the current grammars.

Collisions are reported through `runtime.reportCollision(...)` and
`runtime.scanGrammarCollisions(...)` (the core service also provides
`fromDispatcher`/`fromGrammarTools` mappers). Row formatting lives in the
vscode-free `collisionsPresentation.ts` module (unit-tested);
`collisionsTreeProvider.ts` is a thin `TreeDataProvider` adapter; the
filesystem/NFA scan lives in `@typeagent/core/collisionScanner`.

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

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.

# AGENTS.md — `typeagent-studio` (VS Code extension)

For AI agents and developers working in this package.

## What this package is

`typeagent-studio` is the bespoke VS Code extension surface of TypeAgent Studio:
tree views (Sandboxes, Corpora, Event Log, Collisions), a health status bar,
commands, and (planned) webviews. It is a **thin client** of the `studio` agent
running in the agent-server — the rich VS Code view over a runtime it does not
own (the same relationship `coda` has with the `code` agent).

## Design principle you MUST preserve — thin client over the `studio` agent

> **This package renders and orchestrates UI; it does not own capability logic
> and it does not host the Studio runtime.** Capability logic lives in
> `@typeagent/core`; the runtime is instantiated **once, in the `studio` agent**
> (in the agent-server). This extension drives that agent's typed actions and
> renders the results — serving the human (this UI) while an AI agent (MCP) and a
> hybrid driver use the _same_ runtime. See
> [`DESIGN.md` §3.0 and §3.5](../../docs/plans/vscode-devx/DESIGN.md).

> **Migration in progress (Option B).** The extension historically built its own
> in-process runtime via `createStudioRuntime` (`@typeagent/core/runtime`). That
> is a **transitional bootstrap**. Do **not** add new in-process runtime/capability
> logic here; new capability goes into a `studio` agent action (over the
> agent-server, via the typed result/event channel), which this extension then
> renders.

When adding a feature here:

- Put the real work in `@typeagent/core` exposed as a `studio` agent action; keep
  this layer to presentation, command wiring, and VS Code glue. The view calls
  the agent over the agent-server and renders the typed result.
- Mirror the existing split: a **vscode-free presentation module**
  (`*Presentation.ts`, unit-tested with `node:test`) + a thin **`TreeDataProvider`
  / command** adapter. New views/commands should follow this.
- If a capability would only be reachable by clicking in the UI, that's a bug in
  the layering: it must be a `studio` agent action first (also reachable over
  MCP/CLI), and the UI renders it. See
  [`STUDIO-AGENT.md`](../../docs/plans/vscode-devx/STUDIO-AGENT.md).
- File-writing commands must be explicit/confirmed, never fire-on-selection
  (see the corpus seed action + its confirmation).

## Build, test, run

From `ts/`:

```bash
pnpm --filter typeagent-studio build        # esbuild bundles core into dist/extension.js
pnpm --filter typeagent-studio test:local   # tsx + node:test
cd packages/typeagent-studio && pnpm deploy:local   # package + install VSIX; then Reload Window
```

esbuild inlines `@typeagent/core`, so **core changes need a studio rebuild** to
appear in the extension. `npx tsc -b` reports pre-existing CJS/ESM (TS1479) and a
few unrelated errors — the package builds via esbuild, not tsc.

## Where the design lives

- [`DESIGN.md`](../../docs/plans/vscode-devx/DESIGN.md) §3.0 — headless-core / thin-presenter principle.
- [`USER-STORY.md`](../../docs/plans/vscode-devx/USER-STORY.md) — human / AI / hybrid interaction modes.
- [`STATUS.md`](../../docs/plans/vscode-devx/STATUS.md) — current state, known issues, next slices.

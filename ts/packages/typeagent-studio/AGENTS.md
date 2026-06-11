# AGENTS.md — `typeagent-studio` (VS Code extension)

For AI agents and developers working in this package.

## What this package is

`typeagent-studio` is the VS Code extension surface of TypeAgent Studio: tree
views (Sandboxes, Corpora, Event Log, Collisions), a health status bar,
commands, and (planned) webviews. It is a **thin presenter** over the
`@typeagent/core` engine.

## Design principle you MUST preserve — thin presenter over a headless core

> **This package renders and orchestrates UI; it does not own capability
> logic.** Capability logic belongs in `@typeagent/core`, returns a typed
> result, and is consumed identically by a human (this UI), an AI agent, and a
> human+AI hybrid. See [`DESIGN.md`](../../docs/plans/vscode-devx/DESIGN.md) §3.0.

When adding a feature here:

- Put the real work in `@typeagent/core` (or the shared runtime) as a typed
  primitive; keep this layer to presentation, command wiring, and VS Code glue.
- Mirror the existing split: a **vscode-free presentation module**
  (`*Presentation.ts`, unit-tested with `node:test`) + a thin **`TreeDataProvider`
  / command** adapter. New views/commands should follow this.
- If a capability would only be reachable by clicking in the UI, reconsider:
  it should also be invocable headlessly (the basis for the `studio` agent and
  CLI/MCP surfaces). See
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

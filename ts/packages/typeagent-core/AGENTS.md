# AGENTS.md — `@typeagent/core` (TypeAgent Studio engine)

For AI agents and developers working in this package.

## What this package is

`@typeagent/core` is the **VS Code-free engine library** behind TypeAgent
Studio: sandbox lifecycle, corpus federation, the structured event stream,
feedback, health rules, the collision scanner, the replay engine, and the
onboarding bridge. The `runtime/` module wires these primitives into the
context-agnostic Studio runtime (`createStudioRuntimeCore` → `StudioRuntime`)
via a host-supplied `StudioRuntimeContext`.

**Where the runtime instance lives:** the runtime runs **once per workspace, in a
standalone Studio service** — a host-agnostic library (this `runtime/` module) +
a small process entrypoint, launched by the `typeagent-studio` extension or a
`typeagent-studio serve` CLI. The extension, the `vscode-shell` canvas, an AI
orchestrator (MCP, via a thin `studio` agent), and the CLI are all **clients** of
that one runtime — they do not each build a runtime. (Earlier the runtime was
hosted inside the `studio` agent — "Option B"; P-1.6 moved it out: the agent now
hosts a registry + proxies to the service. The extension's in-process
construction survives **only** for onboarding commands.) See
[`DESIGN.md` §3.5](../../docs/plans/vscode-devx/DESIGN.md).

## Design principle you MUST preserve — headless core, thin presenters

> **Every capability here is a headless, typed primitive; the UI is a thin
> presenter over it.** Build each capability so it can serve three audiences
> from day one: a **human** (the VS Code UI), an **AI agent** (consuming the
> typed result as data), and a **human+AI hybrid** (agent proposes, human
> approves).

Practical rules when adding or changing a capability:

- Logic and orchestration live **here**, not in the extension. Keep this package
  free of any `vscode` dependency.
- Return a **typed, documented result** (not `void` + side effects the UI has to
  re-derive). The same result the UI renders is what an agent will consume.
- For any mutation, support a **`dryRun`** that returns the proposed diff/plan
  without applying it.
- Validate file-path inputs derived from agent/identifier names against path
  traversal (see `corpus/fileCorpusService.ts` `assertSafeAgentSegment`).

This is not aspirational — the agent-drivable and hybrid interaction modes
depend on it. Before implementing a surface as UI-only, stop and reconsider.

## Where the design lives

- [`../../docs/plans/vscode-devx/DESIGN.md`](../../docs/plans/vscode-devx/DESIGN.md) §3.0 — the principle, canonical.
- [`../../docs/plans/vscode-devx/USER-STORY.md`](../../docs/plans/vscode-devx/USER-STORY.md) — the three interaction modes.
- [`../../docs/plans/vscode-devx/STUDIO-AGENT.md`](../../docs/plans/vscode-devx/STUDIO-AGENT.md) — the agent surface this enables.
- [`../../docs/plans/vscode-devx/STATUS.md`](../../docs/plans/vscode-devx/STATUS.md) — current state, known issues, next slices.

## Build & test

From `ts/`:

```bash
pnpm --filter "@typeagent/core" build   # tsc -b
pnpm --filter "@typeagent/core" test    # jest against dist/test/*.spec.js (build first)
```

Tests run against compiled `dist/test/`, so **build before test**.

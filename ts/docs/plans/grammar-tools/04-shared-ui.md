# 04 - Shared UI (`grammar-tools-ui`)

Status: **Stub** - design pending.
Owner: TBD.
Depends on: ADR [0001 - shared UI tech](./decisions/0001-shared-ui-tech.md).
Blocks: 03 (debug panel), 05 (web app), 06 (shell panel).

Maps to PLAN: [Track D](./PLAN.md#track-d---shared-ui-parallel-after-adr-0001).
D.0 (scaffold + fixture backend) is a force multiplier - it lets D.1–D.5
proceed in parallel with Track A / B core work.

> Directory: `packages/grammarTools/ui`. Package name: `grammar-tools-ui`.

## TL;DR

Shared widget bundle (debug panel, completion preview, rule-trace table,
coverage view, diff view) hosted in any of: VS Code webview, Vite SPA,
shell BrowserWindow. Talks to `grammar-tools-core` through a
`GrammarBackend` abstraction so it does not care whether the backend is
in-process or behind RPC. A fixture backend lives alongside the
components so they can be developed and tested before real core lands.

## Scope

- **D.0** Scaffold the package with chosen UI tech and a fixture
  `GrammarBackend` exposing canned responses for every core service.
- Components (each independently shippable):
  - **D.1** `<completion-preview>` - input box, live results, highlight
    `matchedPrefixLength`.
  - **D.2** `<rule-trace>` - step list / table, slot env per step.
  - **D.3** `<grammar-picker>` - source selection (file / agent / live).
  - **D.4** `<coverage-view>` - per-rule heat list, drill into
    unmatched inputs. _Real data needs B.3._
  - **D.5** `<diff-view>` - side-by-side rule diff. _Real data needs
    B.4._
- A `<grammar-debug-panel>` host component composes D.1–D.3 (and
  optionally D.4 / D.5) into the standard debug layout.
- Build: Vite library mode producing an ESM bundle the hosts can load.
- `interface GrammarBackend` mirrors `grammar-tools-core` services 1:1.
  Hosts inject an implementation. Formal contract:
  [ADR 0005](./decisions/0005-shared-service-contract.md). The
  `traceMatch` return shape (one-shot vs streamed events) is an open
  sub-decision in ADR 0005 owned by Track D + B.2; pin it once the
  debug-panel UX is defined.

## Non-scope

- Editor surface (Monaco lives in chunk 05's web app; the VS Code
  extension uses VS Code's own editor).

## Open questions

- UI tech: Lit (recommended), React, or vanilla. See
  [ADR 0001](./decisions/0001-shared-ui-tech.md).
- Theming: pick up VS Code theme tokens in webview, browser defaults
  elsewhere?
- Is the same bundle used in all three hosts, or do we ship per-host
  entrypoints?

## Verification

- Storybook-style manual harness in the package.
- Snapshot tests for component rendering with fixture backends.

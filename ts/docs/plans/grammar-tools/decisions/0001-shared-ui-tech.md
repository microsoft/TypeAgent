# ADR 0001 - Shared UI tech

Status: **Open**.
Blocks: 04, and transitively 03 / 05 / 06.

## Context

The shared widget bundle in chunk 04 must embed cleanly in three hosts:
a VS Code webview, a Vite SPA in a browser, and a `BrowserWindow` inside
[`packages/shell`](../../../packages/shell). The repo currently has no
React or Lit dependency at the package level (Vite is already used by
shell, browser agent, and markdown agent;
[`packages/knowledgeVisualizer`](../../../packages/knowledgeVisualizer)
uses D3 with vanilla DOM;
[`packages/cacheExplorer`](../../../packages/cacheExplorer) is webpack +
vanilla DOM).

## Options

### A. Lit web components _(recommended)_

- Pros: tiny runtime, framework-free embedding, works identically in any
  host, no JSX toolchain needed, native shadow-DOM style isolation
  inside webviews.
- Cons: smaller component ecosystem than React, less familiar to some
  contributors.

### B. React + Vite

- Pros: large ecosystem, lots of pre-built components, familiar.
- Cons: introduces a new repo-wide dependency, framework runtime in
  every host, JSX adds toolchain complexity.

### C. Vanilla DOM (cacheExplorer style)

- Pros: zero new dependencies, matches existing tooling.
- Cons: more boilerplate, harder to share components across hosts
  cleanly.

## Decision

_Pending._

## Consequences

Locks the dependency stack of chunk 04 and influences how chunks 03, 05,
and 06 host the bundle.

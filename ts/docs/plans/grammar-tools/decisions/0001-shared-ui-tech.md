# ADR 0001 - Shared UI tech

Status: **Accepted (option A: Lit)** - 2026-05-05.
Blocks: 04, and transitively 03 / 05 / 06. Decision unblocks Track D.

## Context

The shared widget bundle in chunk 04 must embed cleanly in three hosts:
a VS Code webview, a Vite SPA in a browser, and a `BrowserWindow` inside
[`packages/shell`](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/shell). The repo currently has no
React or Lit dependency at the package level (Vite is already used by
shell, browser agent, and markdown agent;
[`packages/knowledgeVisualizer`](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/knowledgeVisualizer)
uses D3 with vanilla DOM;
[`packages/cacheExplorer`](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/cacheExplorer) is webpack +
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

## Decision process

Before picking a UI tech we need to know what the UI actually has to
do. The recommendation in [chunk 04](../04-shared-ui.md) (Lit) was made
in a vacuum and may be premature. Resolve in this order:

1. **Inventory the components.** From chunks 03 / 04 / 05 / 06, list
   every widget the shared bundle must ship: completion preview,
   rule-trace table, grammar picker, coverage view, diff view,
   anything else. For each, capture rough complexity (static text +
   list, interactive table, side-by-side comparison, graph, etc.) and
   any visualization needs.
2. **Survey existing visualization libraries in the repo** and decide
   whether any of them carry their weight here:
   - D3 (used in [`packages/knowledgeVisualizer`](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/knowledgeVisualizer))
     - good for graph / tree / coverage heat-map style views.
   - Vanilla DOM + small helpers
     ([`packages/cacheExplorer`](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/cacheExplorer)) -
     low-ceremony if components stay simple.
   - Vite-based tooling already in shell, browser agent, markdown
     agent.
     If a single existing approach covers the inventory, pick it; that
     may eliminate the Lit / React choice entirely.
3. **Re-evaluate options A / B / C** against the inventory plus the
   constraints below.

### Decision criteria

In order of priority:

1. **Works in all three hosts** (VS Code webview, browser, Electron
   `BrowserWindow`) without per-host forks.
2. **Minimal runtime weight** - the bundle ships in the shell at
   runtime; large frameworks have a real cost.
3. **Theming** - must accept VS Code theme tokens in the webview and
   degrade gracefully in the browser.
4. **Familiarity / contributor ergonomics** - tie-breaker only.

### Open question to fold in

Chunk 04 currently defers theming ("VS Code theme tokens in webview,
browser defaults elsewhere?"). That decision belongs here, not in
chunk 04, because it constrains the tech choice (e.g. Shadow DOM
style isolation in Lit interacts with VS Code theme CSS variables).

## Decision

**Option A: Lit web components.**

Rationale:

1. **Works in all three hosts with zero adapter code.** Custom elements
   are a web standard; hosts mount `<grammar-debug-panel>` as a tag.
   No per-host mount/destroy/update boilerplate.
2. **Shadow DOM gives style isolation for free.** VS Code webview
   styles cannot leak into component internals; CSS custom properties
   (`--vscode-*`) pierce shadow DOM for theming.
3. **~7 KB runtime.** Smallest option that still provides a reactive
   component model. Vanilla is 0 KB but lacks declarative re-render
   for D.1/D.2's frequent interactive updates.
4. **Repo precedent is "no framework."** Lit is the smallest step up
   from vanilla while still giving declarative templates, reactive
   properties, and scoped styles. React (~40 KB) is overkill for 6
   components and would be the first framework dependency in the repo.
5. **No JSX toolchain needed.** Tagged template literals (`html\`...\``);
   Vite handles the build with no additional plugins.
6. **Future graph viz stays independent.** If NFA/DFA visualization
   comes later, it can use D3 (already in the repo) or live in a
   separate package without forcing the rest of the UI into a
   different framework.

Theming: CSS custom properties following VS Code's `--vscode-*`
convention. A `theme-defaults.css` ships for browser/shell hosts.
See chunk 04 theming strategy section.

## Consequences

Locks the dependency stack of chunk 04 and influences how chunks 03,
05, and 06 host the bundle. Also locks the theming approach for the
shared widgets.

- `lit` added as a dependency of `grammar-tools-ui`.
- Components are custom elements registered with `@customElement()`.
- Vite library mode bundles the ESM output.
- No impact on `grammar-tools-core` (remains framework-free, no DOM).

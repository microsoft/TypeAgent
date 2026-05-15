<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=38d558c722a4c2edae23b4137a4b80410e85ebb904f3f0ce6ac79e3750cdf8f2 -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# grammar-tools-ui — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `grammar-tools-ui` package provides a set of Lit web components for grammar visualization, editing, and debugging. These components are designed to work with the `grammar-tools-core` package, offering a user interface for interacting with grammar data.

## What it does

The package includes several web components that facilitate various grammar-related tasks:

- `GtRuleList`: Displays a list of grammar rules.
- `GtSourceView`: Shows the source code of the grammar.
- `GtCompletionPanel`: Provides an interactive completion preview panel.
- `GtTraceTimeline`: Visualizes the trace of grammar matches.
- `GtCoverageHeatmap`: Displays a heatmap of grammar rule coverage.
- `GtDiffView`: Shows side-by-side grammar rule differences.
- `GtDebugPanel`: A composite debug panel that integrates multiple components for a comprehensive debugging experience.

These components interact with a `GrammarBackend` interface, which defines methods for loading grammars, previewing completions, tracing matches, computing coverage, and more.

## Setup

To set up the `grammar-tools-ui` package, ensure you have the following environment variables configured:

- `GRAMMAR_TOOLS_CORE_PATH`: Path to the `grammar-tools-core` package.

For detailed setup instructions, see the hand-written README.

## Key Files
The package is structured as follows:

- [src/index.ts](./src/index.ts): Exports the main components and types.
- [src/backend.ts](./src/backend.ts): Defines the `GrammarBackend` interface, which mirrors the `grammar-tools-core` service interface.
- [src/fixture/index.ts](./src/fixture/index.ts): Exports the `FixtureBackend` for development and testing.
- [src/gt-completion-panel.ts](./src/gt-completion-panel.ts): Implements the `GtCompletionPanel` component.
- [src/gt-coverage-heatmap.ts](./src/gt-coverage-heatmap.ts): Implements the `GtCoverageHeatmap` component.
- [src/gt-debug-panel.ts](./src/gt-debug-panel.ts): Implements the `GtDebugPanel` component.
- [src/gt-diff-view.ts](./src/gt-diff-view.ts): Implements the `GtDiffView` component.

### Component Details

- **GtRuleList**: Displays a list of grammar rules, allowing users to view and interact with individual rules.
- **GtSourceView**: Shows the source code of the grammar, providing a detailed view of the grammar's structure.
- **GtCompletionPanel**: Provides an interactive panel for previewing completions based on partial input, helping users understand how different inputs are parsed.
- **GtTraceTimeline**: Visualizes the trace of grammar matches, offering insights into how the grammar processes input.
- **GtCoverageHeatmap**: Displays a heatmap of grammar rule coverage, highlighting which rules are most frequently used.
- **GtDiffView**: Shows side-by-side differences between grammar rules, useful for comparing changes between versions.
- **GtDebugPanel**: Integrates multiple components into a single panel for comprehensive debugging, including grammar loading, completion preview, trace visualization, coverage analysis, and diff comparison.

## How to extend

To extend the `grammar-tools-ui` package, follow these steps:

1. **Add a new component**: Create a new TypeScript file in the `src/` directory and define your Lit component.
2. **Export the component**: Update [src/index.ts](./src/index.ts) to export your new component.
3. **Implement backend methods**: If your component requires new backend methods, update [src/backend.ts](./src/backend.ts) to include these methods.
4. **Test your component**: Ensure your component works correctly by writing tests and using the `FixtureBackend` for mock data.

For example, to add a new component for visualizing grammar errors:

```ts
// src/gt-error-view.ts
import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("gt-error-view")
export class GtErrorView extends LitElement {
  static override styles = css`
    /* Your styles here */
  `;

  @property({ type: Array })
  errors = [];

  override render() {
    return html`
      <div>${this.errors.map((error) => html`<p>${error.message}</p>`)}</div>
    `;
  }
}

// src/index.ts
export { GtErrorView } from "./gt-error-view.js";
```

By following these steps, you can extend the functionality of the `grammar-tools-ui` package to meet your specific needs.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)

### Dependencies

Workspace:

- grammar-tools-core

External: `lit`

### Used by

- [agr-language](../../../extensions/agr-language/README.md)

### Files of interest

`./src/fixture/index.ts`, `./src/index.ts`, `./src/backend.ts`, …and 11 more under `./src/`.

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T09:44:30.178Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter grammar-tools-ui docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

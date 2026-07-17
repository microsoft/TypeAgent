<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=75438531f6bf5dde7e67fecfb03277db21bf8a029f62107e177b04361311340d -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# grammar-tools-ui — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `grammar-tools-ui` package provides a collection of reusable Lit web components designed for grammar visualization, editing, and debugging. These components are tightly integrated with the `grammar-tools-core` package, enabling developers to create interactive user interfaces for working with grammar data. The package is used in other parts of the TypeAgent monorepo, such as the `agr-language` extension.

## What it does

This package offers a suite of web components that support various grammar-related tasks, including visualization, debugging, and editing. These components are designed to work with a `GrammarBackend` interface, which acts as a bridge to the `grammar-tools-core` service. The key components include:

- **`GtRuleList`**: Displays a list of grammar rules, allowing users to view and interact with individual rules.
- **`GtSourceView`**: Provides a detailed view of the grammar's source code, enabling users to explore its structure.
- **`GtCompletionPanel`**: An interactive panel for previewing completions based on partial input, helping users understand how different inputs are parsed.
- **`GtTraceTimeline`**: Visualizes the trace of grammar matches, offering insights into how the grammar processes input step by step.
- **`GtCoverageHeatmap`**: Displays a heatmap of grammar rule coverage, highlighting which rules are most frequently used.
- **`GtDiffView`**: Provides a side-by-side comparison of grammar rule differences, useful for analyzing changes between versions.
- **`GtDebugPanel`**: A composite panel that integrates multiple components, such as grammar loading, completion preview, trace visualization, coverage analysis, and diff comparison, into a single interface.

These components are designed to be modular and can be used individually or combined to create a comprehensive grammar debugging and visualization tool.

## Setup

To use the `grammar-tools-ui` package, ensure the following prerequisites are met:

1. **Install Dependencies**: This package depends on the `grammar-tools-core` package and the `lit` library. Ensure these dependencies are installed in your project.
2. **Environment Variables**: Set the `GRAMMAR_TOOLS_CORE_PATH` environment variable to the path of the `grammar-tools-core` package. This is required for the `GrammarBackend` interface to function correctly.
3. **Build the Package**: Use `pnpm` to install dependencies and build the package:
   ```bash
   pnpm install
   pnpm build
   ```
4. **Integration**: Import the required components into your project and use them as custom elements in your HTML or JavaScript/TypeScript files.

For additional setup details, refer to the hand-written README.

## Key Files

The `grammar-tools-ui` package is organized into several key files, each responsible for specific functionality:

- **[src/index.ts](./src/index.ts)**: The main entry point of the package, exporting all components and types.
- **[src/backend.ts](./src/backend.ts)**: Defines the `GrammarBackend` interface, which mirrors the `grammar-tools-core` service interface. This interface includes methods for loading grammars, previewing completions, tracing matches, computing coverage, and more.
- **src/fixture/index.ts**: Provides the `FixtureBackend`, a mock implementation of the `GrammarBackend` interface for development and testing purposes.
- **[src/gt-completion-panel.ts](./src/gt-completion-panel.ts)**: Implements the `GtCompletionPanel` component for interactive completion previews.
- **[src/gt-coverage-heatmap.ts](./src/gt-coverage-heatmap.ts)**: Implements the `GtCoverageHeatmap` component for visualizing grammar rule coverage.
- **[src/gt-debug-panel.ts](./src/gt-debug-panel.ts)**: Implements the `GtDebugPanel` component, which integrates multiple debugging tools into a single interface.
- **[src/gt-diff-view.ts](./src/gt-diff-view.ts)**: Implements the `GtDiffView` component for side-by-side grammar rule comparisons.
- **[src/gt-rule-list.ts](./src/gt-rule-list.ts)**: Implements the `GtRuleList` component for displaying and interacting with a list of grammar rules.
- **[src/gt-source-view.ts](./src/gt-source-view.ts)**: Implements the `GtSourceView` component for exploring grammar source code.
- **[src/gt-trace-timeline.ts](./src/gt-trace-timeline.ts)**: Implements the `GtTraceTimeline` component for visualizing the trace of grammar matches.

## How to extend

To extend the `grammar-tools-ui` package, you can add new components or enhance existing ones. Below are the steps to guide you through the process:

1. **Create a New Component**:

   - Add a new TypeScript file in the `src/` directory.
   - Use the Lit framework to define your custom element. For example:

     ```ts
     import { LitElement, html, css } from "lit";
     import { customElement, property } from "lit/decorators.js";

     @customElement("gt-new-component")
     export class GtNewComponent extends LitElement {
       static override styles = css`
         /* Add your styles here */
       `;

       @property({ type: String })
       title = "New Component";

       override render() {
         return html`<div>${this.title}</div>`;
       }
     }
     ```

2. **Export the Component**:

   - Update [src/index.ts](./src/index.ts) to export your new component:
     ```ts
     export { GtNewComponent } from "./gt-new-component.js";
     ```

3. **Update the Backend Interface**:

   - If your component requires new backend methods, add them to [src/backend.ts](./src/backend.ts). Ensure these methods align with the `grammar-tools-core` service interface.

4. **Test Your Component**:

   - Use the `FixtureBackend` from src/fixture/index.ts to mock backend data for development and testing.
   - Write unit tests for your component to ensure it behaves as expected.

5. **Integrate with Existing Components**:
   - If your new component interacts with existing components, update the relevant files to include your component. For example, you might add your component to the `GtDebugPanel` if it provides debugging functionality.

By following these steps, you can enhance the `grammar-tools-ui` package to support additional grammar-related features or customize it for your specific use case.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/index.js` _(not found on disk)_

### Dependencies

Workspace:

- grammar-tools-core

External: `lit`

### Used by

- [agr-language](../../../extensions/agr-language/README.md)

### Files of interest

`./src/index.ts`, `./src/backend.ts`, `./src/gt-completion-panel.ts`, …and 9 more under `./src/`.

---

_Auto-generated against commit `fbf54a8aff55bd1ef482ad8fbf2064bc3d38486c` on `2026-07-17T05:44:32.534Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter grammar-tools-ui docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

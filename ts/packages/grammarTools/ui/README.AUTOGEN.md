<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=84e8fd1edf330933c4fcfad9094e7ff5be4fd5296dca3679af614dae734d4a7b -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# grammar-tools-ui — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `grammar-tools-ui` package provides a set of Lit-based web components for grammar visualization, editing, and debugging. These components are designed to work in conjunction with the `grammar-tools-core` package, enabling developers to build interactive user interfaces for exploring and analyzing grammar data. The package is utilized in other parts of the TypeAgent monorepo, such as the `agr-language` extension.

## What it does

This package includes a collection of modular web components that facilitate various grammar-related tasks. These components interact with a `GrammarBackend` interface, which serves as a bridge to the `grammar-tools-core` service. Key components include:

- **`GtRuleList`**: Displays a list of grammar rules, allowing users to navigate and interact with individual rules.
- **`GtSourceView`**: Provides a detailed view of the grammar's source code, enabling users to explore its structure and origins.
- **`GtCompletionPanel`**: Offers an interactive interface for previewing completions based on partial input, helping users understand how inputs are parsed.
- **`GtTraceTimeline`**: Visualizes the trace of grammar matches, showing how the grammar processes input step by step.
- **`GtCoverageHeatmap`**: Displays a heatmap of grammar rule coverage, highlighting the frequency of rule usage.
- **`GtDiffView`**: Provides a side-by-side comparison of grammar rule differences, useful for analyzing changes between versions.
- **`GtDebugPanel`**: A composite panel that integrates multiple components, such as grammar loading, completion preview, trace visualization, coverage analysis, and diff comparison, into a single interface.

These components can be used individually or combined to create a comprehensive grammar debugging and visualization tool.

## Setup

To use the `grammar-tools-ui` package, follow these steps:

1. **Install Dependencies**: Ensure that the `grammar-tools-core` package and the `lit` library are installed in your project. Use `pnpm` to manage dependencies:

   ```bash
   pnpm install
   ```

2. **Environment Variables**: Set the `GRAMMAR_TOOLS_CORE_PATH` environment variable to the path of the `grammar-tools-core` package. This is necessary for the `GrammarBackend` interface to function properly.

3. **Build the Package**: After installing dependencies, build the package:

   ```bash
   pnpm build
   ```

4. **Integration**: Import the required components into your project and use them as custom elements in your HTML or TypeScript files. For example:
   ```html
   <script type="module" src="path-to-grammar-tools-ui/dist/index.js"></script>
   <gt-rule-list></gt-rule-list>
   ```

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

To extend the `grammar-tools-ui` package, you can add new components or enhance existing ones. Follow these steps to get started:

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

   - Use the `FixtureBackend` from `src/fixture/index.ts` to mock backend data for development and testing.
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

_Auto-generated against commit `38f6b8e5cb0688da34e930559899bb2ea7bb0aca` on `2026-07-21T01:16:36.018Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter grammar-tools-ui docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

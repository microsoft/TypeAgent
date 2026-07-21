<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=1be83159ea46c2db14e3a41e3531615413c65ce58efba9f2267e7c8ddaeb48f3 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# knowledgevisualizer — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The Knowledge Visualizer is an experimental TypeScript library designed to help developers browse and debug stored knowledge within the system. It provides a suite of visualization tools to represent hierarchical structures, word clouds, and other data forms, making it easier to understand and interact with the system's knowledge base. While primarily intended as a debugging tool, it also serves as a foundation for exploring and analyzing complex data relationships.

## What it does

The Knowledge Visualizer offers several visualization capabilities, each tied to specific actions that dynamically update the displayed data:

- **List Visualization**: Displays structured lists of data, updated via the `updateListVisualization` action.
- **Knowledge Graph Visualization**: Renders graph-based representations of the knowledge base, updated through the `updateKnowledgeVisualization` action.
- **Hierarchical Visualization**: Illustrates hierarchical relationships in the data, updated using the `updateKnowledgeHierarchyVisualization` action.
- **Word Cloud Visualization**: Generates word clouds from the data, updated via the `updateWordCloud` action.

These visualizations are updated in real-time using server-sent events (SSE), ensuring that the displayed data reflects the latest state of the system. The package integrates with the `agent-dispatcher` dependency to fetch and process the required data.

## Setup

To set up and run the Knowledge Visualizer tool:

1. Install all dependencies by running:

   ```sh
   pnpm install
   ```

2. Start the Knowledge Visualizer tool with:
   ```sh
   pnpm run kv
   ```

This will launch the development server and enable the visualization tool. For additional details, refer to the hand-written README.

## Key Files

The Knowledge Visualizer package is organized into several key components, each responsible for specific functionality:

### Route Handling

- **[route.ts](./src/route/route.ts)**: Configures middleware for the development server and handles server-sent events (SSE). It listens for data changes and triggers visualization updates by emitting events such as `updateListVisualization`, `updateKnowledgeVisualization`, `updateKnowledgeHierarchyVisualization`, and `updateWordCloud`.

### Visualization Notifier

- **[visualizationNotifier.ts](./src/route/visualizationNotifier.ts)**: Defines the `VisualizationNotifier` class, which manages updates to the visualizations. It includes methods for handling different types of data updates (e.g., lists, graphs, hierarchies, word clouds) and notifies the front-end components accordingly.

### Front-End Components

- **[site/index.ts](./src/site/index.ts)**: The entry point for the front-end application. It initializes visualization components, sets up event listeners for SSE, and dynamically updates the visualizations.
- **[collapsableContainer.ts](./src/site/collapsableContainer.ts)**: Implements a reusable container component with expand/collapse functionality, used to organize and display visualizations.
- **[visualizations](./src/site/visualizations/)**: Contains specific visualization components, such as:
  - **[wordCloud.ts](./src/site/visualizations/wordCloud.ts)**: Implements the word cloud visualization.
  - **[hierarchicalEdgeBundling.ts](./src/site/visualizations/hierarchicalEdgeBundling.ts)**: Implements the hierarchical edge bundling visualization.
  - **[tidyTree.ts](./src/site/visualizations/tidyTree.ts)**: Implements the tidy tree visualization.

### Static Assets

- **[index.html](./src/site/index.html)**: The main HTML file for the front-end application.
- **[styles.css](./src/site/styles.css)**: Contains CSS styles for the front-end components, including layout and visual design.

## How to extend

To extend the Knowledge Visualizer, you can add new visualizations, modify existing ones, or enhance the data handling logic. Here’s how to get started:

1. **Understand the Route Handling**:

   - Review [route.ts](./src/route/route.ts), which sets up middleware and SSE endpoints. If you need to handle new types of data updates, add event listeners here.

2. **Enhance the Visualization Notifier**:

   - Open [visualizationNotifier.ts](./src/route/visualizationNotifier.ts) to add new methods or modify existing ones for handling additional data types. This file is central to managing the flow of data updates to the front-end.

3. **Create New Visualization Components**:

   - Add new components in the [site/visualizations](./src/site/visualizations/) directory. Use existing components like [wordCloud.ts](./src/site/visualizations/wordCloud.ts) or [tidyTree.ts](./src/site/visualizations/tidyTree.ts) as templates. Ensure that your new components are designed to handle specific data types and provide interactive elements.

4. **Integrate the New Components**:

   - Update [index.ts](./src/site/index.ts) to include your new visualization components. Set up event listeners to handle updates for the new visualizations.

5. **Test Your Changes**:
   - Run the tool using `pnpm run kv` and verify that your new visualizations are correctly integrated. Ensure that they update dynamically in response to data changes.

By following these steps, you can extend the Knowledge Visualizer to support additional visualizations or improve its existing functionality. This will enhance its utility as a debugging tool and provide deeper insights into the stored knowledge.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./route` → `./dist/route/route.js` _(not found on disk)_

### Dependencies

Workspace:

- [agent-dispatcher](../../packages/dispatcher/dispatcher/README.md)

External: `chalk`, `d3`, `d3-cloud`, `debug`

### Files of interest

`./src/site/index.ts`, `./src/route/route.ts`, `./src/route/tsconfig.json`, …and 10 more under `./src/`.

---

_Auto-generated against commit `de9d1d44c33525463327199c8f244a24ddfdd874` on `2026-07-21T11:18:03.349Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter knowledgevisualizer docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

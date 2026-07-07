<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=3ebe7a3c0ec093b5c00292d47b5e836dd58e5cba3d8c093b6fc266df569f4592 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# knowledgevisualizer — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The Knowledge Visualizer is an experimental TypeScript library designed to assist developers in browsing and debugging stored knowledge within the system. Its primary purpose is to serve as a debugging tool, providing visual representations of hierarchical structures, word clouds, and other data forms. This enables developers to better understand and interact with the system's knowledge base.

## What it does

The Knowledge Visualizer provides a set of tools for visualizing and interacting with stored knowledge. It supports the following key functionalities:

- **List Visualization**: Displays a structured list of data, updated dynamically via the `updateListVisualization` action.
- **Knowledge Graph Visualization**: Renders a graph representation of the knowledge base, updated through the `updateKnowledgeVisualization` action.
- **Hierarchical Visualization**: Displays hierarchical relationships in the data, updated via the `updateKnowledgeHierarchyVisualization` action.
- **Word Cloud Visualization**: Generates a word cloud based on the data, updated using the `updateWordCloud` action.

These visualizations are dynamically updated in real-time using server-sent events (SSE), ensuring that the displayed data reflects the most current state of the system. The package integrates with the `agent-dispatcher` workspace dependency to fetch and process the required data.

## Setup

To run the Knowledge Visualizer tool, follow these steps:

1. Ensure that all dependencies are installed by running:

   ```sh
   pnpm install
   ```

2. Start the Knowledge Visualizer tool using the following command:
   ```sh
   pnpm run kv
   ```

This will launch the development server and enable the visualization tool. For additional setup details, refer to the hand-written README.

## Key Files

The Knowledge Visualizer package is organized into several key components:

### Route Handling

- **[route.ts](./src/route/route.ts)**: This file sets up the middleware for the development server and handles server-sent events (SSE). It listens for data changes and triggers the appropriate visualization updates by emitting events such as `updateListVisualization`, `updateKnowledgeVisualization`, `updateKnowledgeHierarchyVisualization`, and `updateWordCloud`.

### Visualization Notifier

- **[visualizationNotifier.ts](./src/route/visualizationNotifier.ts)**: This file defines the `VisualizationNotifier` class, which manages updates to the visualizations. It includes methods for handling different types of data updates, such as lists, knowledge graphs, hierarchies, and word clouds, and notifies the front-end components accordingly.

### Front-End Components

- **[site/index.ts](./src/site/index.ts)**: The entry point for the front-end application. It initializes the visualization components, sets up event listeners for SSE, and updates the visualizations dynamically.
- **[collapsableContainer.ts](./src/site/collapsableContainer.ts)**: Defines a reusable container component with expand/collapse functionality, used to organize and display visualizations.
- **[visualizations](./src/site/visualizations/)**: This directory contains specific visualization components, such as:
  - **[wordCloud.ts](./src/site/visualizations/wordCloud.ts)**: Implements the word cloud visualization.
  - **[hierarchicalEdgeBundling.ts](./src/site/visualizations/hierarchicalEdgeBundling.ts)**: Implements the hierarchical edge bundling visualization.
  - **[tidyTree.ts](./src/site/visualizations/tidyTree.ts)**: Implements the tidy tree visualization.

### Static Assets

- **[index.html](./src/site/index.html)**: The main HTML file for the front-end application.
- **[styles.css](./src/site/styles.css)**: Contains the CSS styles for the front-end components, including layout and visual design.

## How to extend

To extend the Knowledge Visualizer, you can add new visualizations, modify existing ones, or enhance the data handling logic. Here’s how to get started:

1. **Understand the Route Handling**:

   - Begin by reviewing [route.ts](./src/route/route.ts). This file sets up the middleware and SSE endpoints. If you need to handle new types of data updates, add new event listeners here.

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

_Auto-generated against commit `366aaf867a7e8e5d130b6c87a365516bab725269` on `2026-07-07T09:05:05.703Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter knowledgevisualizer docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

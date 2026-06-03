<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=cade8197f30cbdbfd9ddebf8b7f78caa0326902c850f8a040b6329e33fcc362a -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# knowledgevisualizer — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The Knowledge Visualizer is an experimental TypeScript library designed to help developers browse and debug stored knowledge within the system. It provides various visualization tools to represent hierarchical structures, word clouds, and other data forms, making it easier to understand and interact with the stored information.

## What it does

The Knowledge Visualizer package offers functionalities to display different types of knowledge stored within the system. It includes tools for hierarchical structures, word clouds, and other visual representations. The package listens for updates and dynamically refreshes the visualizations based on incoming data. Key actions include:

- `updateListVisualization`: Updates the list visualization.
- `updateKnowledgeVisualization`: Updates the knowledge graph visualization.
- `updateKnowledgeHierarchyVisualization`: Updates the hierarchical visualization.
- `updateWordCloud`: Updates the word cloud visualization.

These actions enable the tool to provide real-time updates, ensuring that the visualizations reflect the most current state of the data.

## Setup

To run the Knowledge Visualizer tool, use the following command:

```sh
pnpm run kv
```

This command will start the development server and enable the visualization tool. For detailed setup instructions, refer to the hand-written README.

## Key Files

The package is structured into several key components:

- **Route Handling**: The [route.ts](./src/route/route.ts) file sets up middleware for the development server and handles server-sent events (SSE) to update visualizations. It listens for changes in the data and triggers the appropriate visualization updates.
- **Visualization Notifier**: The [visualizationNotifier.ts](./src/route/visualizationNotifier.ts) file defines classes and types for managing updates to the visualizations. It includes methods for handling different types of data updates and notifying the front-end components.
- **Site Components**: The [site](./src/site/) directory contains various components for the front-end, including collapsable containers, icons, and specific visualizations like hierarchical edge bundling and word clouds. These components are responsible for rendering the visualizations and providing interactive elements.

## How to extend

To extend the Knowledge Visualizer, follow these steps:

1. **Start with the Route Handling**: Open [route.ts](./src/route/route.ts) to understand how the middleware and SSE endpoints are set up. This is where new event listeners can be added to handle additional types of data updates.
2. **Modify Visualization Notifier**: If you need to handle new types of data or update existing visualizations, modify [visualizationNotifier.ts](./src/route/visualizationNotifier.ts) to include new methods or update existing ones. This file is central to managing the data flow and ensuring that updates are correctly propagated to the front-end.
3. **Add New Visualizations**: Create new visualization components in the [site](./src/site/) directory. Follow the pattern used in existing components like [collapsableContainer.ts](./src/site/collapsableContainer.ts) and [wordCloud.ts](./src/site/visualizations/wordCloud.ts). These components should be designed to handle specific types of data and provide interactive elements for the user.
4. **Test Your Changes**: Ensure that your new visualizations are correctly integrated and update dynamically by running the tool with `pnpm run kv`. Verify that the visualizations respond to data updates and provide the intended functionality.

By following these steps, you can extend the functionality of the Knowledge Visualizer to include new types of visualizations or improve existing ones. This will enhance the tool's ability to serve as a debugging mechanism and provide valuable insights into the stored knowledge.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./route` → [./dist/route/route.js](./dist/route/route.js)

### Dependencies

Workspace:

- [agent-dispatcher](../../packages/dispatcher/dispatcher/README.md)

External: `chalk`, `d3`, `d3-cloud`, `debug`

### Files of interest

`./src/site/index.ts`, `./src/route/route.ts`, `./src/route/tsconfig.json`, …and 10 more under `./src/`.

---

_Auto-generated against commit `bc2dc7df084977bc3da24a9398fd3a08d55c3e7e` on `2026-05-29T04:54:39.509Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter knowledgevisualizer docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

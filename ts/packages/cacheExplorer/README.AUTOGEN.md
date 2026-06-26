<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=9790fd94e43f4fefee7254373c9963b0afad2f735fbe90b54dbe4f2d5c50cacf -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# agent-cache-explorer — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `agent-cache-explorer` package is a TypeScript library designed to explore the construction cache for TypeAgent requests. It provides a web interface to view and interact with cached data related to agent sessions and constructions, making it easier to manage and inspect the cache contents.

## What it does

The `agent-cache-explorer` package offers several capabilities:

- **Session Management**: It allows users to list all available sessions and view details about each session.
- **Cache Exploration**: Users can explore caches associated with specific sessions, including viewing the contents of individual cache files.
- **Web Interface**: The package includes a web interface that displays sessions, match sets, and constructions, providing a user-friendly way to navigate and inspect cached data.

The package integrates with `agent-cache` to manage cache data and `agent-dispatcher` to handle session-related operations. It uses `chalk` and `debug` for logging and debugging purposes.

## Setup

To set up the `agent-cache-explorer` package, follow these steps:

1. Ensure you have the necessary dependencies installed:

   - `agent-cache`
   - `agent-dispatcher`
   - `chalk`
   - `debug`

2. Configure the environment variables required by the package. Refer to the hand-written README for detailed instructions on setting up these variables.

3. Install the package dependencies using `pnpm`:
   ```sh
   pnpm install
   ```

For a complete setup guide, see the hand-written README.

## Key Files

The `agent-cache-explorer` package is organized into several key components:

- **Route Handling**: The [route.ts](./src/route/route.ts) file defines the API endpoints for interacting with sessions and caches. It includes middleware setup for handling HTTP requests related to session and cache data.
- **Web Interface**: The [index.html](./src/site/index.html) and [index.ts](./src/site/index.ts) files under the `site` directory provide the frontend interface for exploring cache data. The HTML file defines the structure and styling of the web page, while the TypeScript file handles dynamic interactions and data rendering.
- **Configuration**: The `tsconfig.json` files in both the `route` and `site` directories configure TypeScript compilation settings for their respective parts of the package.

### Route Handling

The [route.ts](./src/route/route.ts) file is responsible for setting up the middleware and defining the API endpoints. It includes routes for listing sessions, fetching caches for a specific session, and retrieving the contents of individual cache files. The middleware setup ensures that HTTP requests are properly handled and responses are returned in JSON format.

### Web Interface

The web interface consists of the [index.html](./src/site/index.html) and [index.ts](./src/site/index.ts) files. The HTML file provides the structure and styling for the web page, including elements for displaying sessions, match sets, and constructions. The TypeScript file handles dynamic interactions, such as populating session lists, rendering cache data, and managing user interactions.

### Configuration

The `tsconfig.json` files in the `route` and `site` directories configure TypeScript compilation settings. The `route` directory's `tsconfig.json` file sets up composite builds and output directories, while the `site` directory's `tsconfig.json` file configures module resolution and library settings for the web interface.

## How to extend

To extend the `agent-cache-explorer` package, follow these steps:

1. **Add New Routes**: To add new API endpoints, modify the [route.ts](./src/route/route.ts) file. Define new routes and their corresponding handlers to expose additional data or functionality.

2. **Enhance the Web Interface**: To enhance the frontend interface, update the [index.html](./src/site/index.html) and [index.ts](./src/site/index.ts) files. You can add new elements, modify existing ones, or implement new interactive features.

3. **Integrate with Other Packages**: If you need to integrate with other packages or services, ensure you have the necessary dependencies installed and update the relevant parts of the codebase to utilize these integrations.

4. **Testing**: After making changes, run tests to ensure everything works as expected. Add new tests if necessary to cover the new functionality.

By following these steps, you can effectively extend the capabilities of the `agent-cache-explorer` package.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./route` → [./dist/route/route.js](./dist/route/route.js)

### Dependencies

Workspace:

- [agent-cache](../../packages/cache/README.md)
- [agent-dispatcher](../../packages/dispatcher/dispatcher/README.md)

External: `chalk`, `debug`

### Files of interest

`./src/site/index.ts`, `./src/route/route.ts`, `./src/route/tsconfig.json`, …and 2 more under `./src/`.

---

_Auto-generated against commit `127a36a95a15e918be533d6eaaf08adebe9070d9` on `2026-06-26T03:01:52.873Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter agent-cache-explorer docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

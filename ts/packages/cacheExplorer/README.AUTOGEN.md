<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=f803bf8bb4184638330e893f4adee04df8a29b7fa57c64ac9a223ec349321407 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# agent-cache-explorer — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `agent-cache-explorer` package is a TypeScript library that provides tools for exploring the construction cache used in TypeAgent requests. It includes both a backend API and a web-based frontend interface, enabling users to inspect cached data related to agent sessions and constructions. This package is particularly useful for debugging and managing cached data in systems that rely on the `agent-cache` and `agent-dispatcher` packages.

## What it does

The `agent-cache-explorer` package offers the following capabilities:

- **Session Listing**: Provides an API to list all available sessions, allowing users to identify which sessions have cached data.
- **Cache Inspection**: Enables users to explore the cache associated with a specific session, including retrieving the contents of individual cache files.
- **Web Interface**: Includes a frontend interface for visualizing sessions, match sets, and constructions. This interface allows users to interact with cached data in a structured and user-friendly way.
- **Integration with Core Packages**: Leverages `agent-cache` for cache management and `agent-dispatcher` for session-related operations.

The backend API is implemented using middleware that handles HTTP requests for session and cache data. The frontend interface is built with HTML and TypeScript, providing a dynamic and interactive experience for users.

## Setup

To set up the `agent-cache-explorer` package, follow these steps:

1. **Install Dependencies**:
   Ensure the following dependencies are installed in your workspace:

   - `agent-cache`
   - `agent-dispatcher`
   - `chalk`
   - `debug`

2. **Install Package**:
   Use `pnpm` to install the package and its dependencies:

   ```sh
   pnpm install
   ```

3. **Environment Variables**:
   If the package requires any specific environment variables, refer to the hand-written README for detailed setup instructions.

Once these steps are complete, the package should be ready to use.

## Key Files

The `agent-cache-explorer` package is organized into several key components, each responsible for a specific aspect of its functionality:

### Route Handling

- **[route.ts](./src/route/route.ts)**: Defines the backend API endpoints for interacting with sessions and caches. Key routes include:

  - `/sessions`: Lists all available sessions.
  - `/session/:session/caches`: Retrieves the caches for a specific session.
  - `/session/:session/cache/:cache`: Fetches the contents of a specific cache file.

  The file also sets up middleware to handle HTTP requests and ensures responses are returned in JSON format.

- **[tsconfig.json](./src/route/tsconfig.json)**: Configures TypeScript compilation settings for the route-handling code. It specifies composite builds and output directories.

### Web Interface

- **[index.html](./src/site/index.html)**: Provides the structure and styling for the web interface. It includes elements for displaying sessions, match sets, and constructions, as well as interactive components for user input.
- **[index.ts](./src/site/index.ts)**: Implements the dynamic behavior of the web interface. It handles tasks such as populating session lists, rendering cache data, and managing user interactions.
- **[tsconfig.json](./src/site/tsconfig.json)**: Configures TypeScript compilation settings for the frontend code. It includes settings for module resolution, library support, and output directories.

### Configuration

The `tsconfig.json` files in the `route` and `site` directories ensure that the TypeScript code is compiled correctly for both the backend and frontend components. These configurations are tailored to the specific needs of each part of the package.

## How to extend

To extend the functionality of the `agent-cache-explorer` package, consider the following approaches:

1. **Add New API Endpoints**:

   - Modify the [route.ts](./src/route/route.ts) file to define new routes and their corresponding handlers.
   - For example, you could add an endpoint to delete specific cache files or provide additional metadata about sessions.

2. **Enhance the Web Interface**:

   - Update the [index.html](./src/site/index.html) and [index.ts](./src/site/index.ts) files to add new features or improve the user experience.
   - Examples include adding search functionality, filtering options, or visualizations for cache data.

3. **Integrate with Additional Packages**:

   - If you need to use data or functionality from other packages, add the necessary dependencies and update the relevant parts of the codebase to incorporate these integrations.

4. **Improve Logging and Debugging**:

   - Use the `debug` and `chalk` libraries to enhance logging and debugging capabilities. This can help with monitoring the system and identifying issues.

5. **Testing**:
   - After making changes, ensure that the package continues to function as expected by running existing tests and adding new ones if necessary. This is especially important for any new features or integrations.

By following these guidelines, you can effectively extend and customize the `agent-cache-explorer` package to meet your specific needs.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./route` → `./dist/route/route.js` _(not found on disk)_

### Dependencies

Workspace:

- [agent-cache](../../packages/cache/README.md)
- [agent-dispatcher](../../packages/dispatcher/dispatcher/README.md)

External: `chalk`, `debug`

### Files of interest

`./src/site/index.ts`, `./src/route/route.ts`, `./src/route/tsconfig.json`, …and 2 more under `./src/`.

---

_Auto-generated against commit `de9d1d44c33525463327199c8f244a24ddfdd874` on `2026-07-21T11:18:03.349Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter agent-cache-explorer docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=3725ce07d9888cad8fb3dfca00dda7d128d6e0f17016a510ba20d8a11273372f -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# montage-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The montage-agent package is a TypeAgent application agent designed to assist in creating photo montages. It facilitates collaborative work between the user and the agent to manage and organize images into montages.

## What it does

The montage-agent package provides a set of actions that allow users to create, modify, and manage photo montages. These actions include `createMontage`, `addPhotos`, `removePhotos`, `selectPhotos`, `setMontageViewMode`, and more. The agent interacts with various parts of the system, including image storage and processing, to perform these tasks. It also provides a web interface for users to interact with the montage creation process.

## Setup

To set up the montage-agent package, you need to configure several environment variables and ensure that certain dependencies are installed. The required environment variables include:

- `PORT`: The port number on which the server will run.
- `INDEX_CACHE_PATH`: The path to the image index cache.
- `ROOT_IMAGE_FOLDER`: The root folder where images are stored.

Additionally, you need to install the necessary dependencies using `pnpm install`. For detailed setup instructions, refer to the hand-written README.

## Key Files

The montage-agent package is organized into several key components:

- **Agent Manifest**: The [montageManifest.json](./src/agent/montageManifest.json) file defines the agent's schema and description.
- **Action Handler**: The [montageActionHandler.ts](./src/agent/montageActionHandler.ts) file contains the logic for executing actions related to montage creation and management.
- **Action Schema**: The [montageActionSchema.ts](./src/agent/montageActionSchema.ts) file defines the types and structure of actions that the agent can perform.
- **Route Handling**: The [route.ts](./src/route/route.ts) file sets up the Express server and handles HTTP requests.
- **Web Interface**: The [index.html](./src/site/index.html), [index.ts](./src/site/index.ts), and [styles.css](./src/site/styles.css) files provide the user interface for interacting with the montage agent.

## How to extend

To extend the montage-agent package, follow these steps:

1. **Add New Actions**: Define new actions in the [montageActionSchema.ts](./src/agent/montageActionSchema.ts) file. Ensure that the action types and parameters are clearly specified.
2. **Implement Action Logic**: Implement the logic for the new actions in the [montageActionHandler.ts](./src/agent/montageActionHandler.ts) file. Use the existing patterns for handling actions and interacting with other system components.
3. **Update Manifest**: Update the [montageManifest.json](./src/agent/montageManifest.json) file to include the new actions and their descriptions.
4. **Test**: Write tests to verify the functionality of the new actions. Ensure that the tests cover various scenarios and edge cases.
5. **Run the Server**: Start the server using the configured port and test the new actions through the web interface.

By following these steps, you can extend the capabilities of the montage-agent package to support additional features and functionalities.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/route/route.js](./dist/route/route.js)
- `./agent/manifest` → [./src/agent/montageManifest.json](./src/agent/montageManifest.json)
- `./agent/handlers` → [./dist/agent/montageActionHandler.js](./dist/agent/montageActionHandler.js)

### Dependencies

Workspace:

- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [@typeagent/common-utils](../../../packages/utils/commonUtils/README.md)
- [aiclient](../../../packages/aiclient/README.md)
- [image-memory](../../../packages/memory/image/README.md)
- [knowledge-processor](../../../packages/knowledgeProcessor/README.md)
- [knowpro](../../../packages/knowPro/README.md)
- [typeagent](../../../packages/typeagent/README.md)

External: `body-parser`, `d3`, `d3-cloud`, `debug`, `express`, `express-rate-limit`, `koffi`, `sharp`, `typechat`, `winreg`

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

- [./src/agent/montageManifest.json](./src/agent/montageManifest.json)
- [./src/agent/montageActionHandler.ts](./src/agent/montageActionHandler.ts)
- [./src/agent/montageActionSchema.ts](./src/agent/montageActionSchema.ts)
- [./src/site/index.ts](./src/site/index.ts)
- [./src/agent/tsconfig.json](./src/agent/tsconfig.json)
- [./src/route/route.ts](./src/route/route.ts)
- [./src/route/tsconfig.json](./src/route/tsconfig.json)
- [./src/site/index.html](./src/site/index.html)
- [./src/site/photo.ts](./src/site/photo.ts)
- [./src/site/styles.css](./src/site/styles.css)
- _…and 1 more under `./src/`._

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T10:06:08.874Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter montage-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=d0c0d9e8e2640b154ecc71d549a30917ee71a3e5dda0b3bd8b294bb9b677c9a6 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# montage-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The montage-agent package is a TypeAgent application agent designed to assist users in creating and managing photo montages. It enables collaborative workflows between users and the agent, facilitating tasks such as organizing, editing, and presenting images in a montage format.

## What it does

The montage-agent provides a range of actions to support the creation and management of photo montages. These actions include:

- **Montage Creation and Management**: Actions like `createMontage`, `deleteMontage`, and `listMontage` allow users to create new montages, remove existing ones, and view a list of available montages.
- **Photo Selection and Manipulation**: Actions such as `addPhotos`, `removePhotos`, `selectPhotos`, and `clearSelection` enable users to add images to a montage, remove them, or refine the selection of images.
- **Montage Presentation**: Actions like `startSlideShow` and `setMontageViewMode` allow users to control how montages are displayed, including starting a slideshow or changing the view mode.
- **Search and Filtering**: Actions like `setSearchParameters` and `showSearchParameters` help users filter and search for specific images to include in their montages.

The agent integrates with other system components, such as image storage, processing utilities, and knowledge processing modules, to perform these tasks. It also provides a web-based interface for users to interact with the montage creation process.

## Setup

To set up the montage-agent package, follow these steps:

1. **Install Dependencies**: Run `pnpm install` in the package directory to install all required dependencies.
2. **Configure Environment Variables**: Set the following environment variables:
   - `PORT`: The port number on which the server will run.
   - `INDEX_CACHE_PATH`: The file path to the image index cache.
   - `ROOT_IMAGE_FOLDER`: The root directory where images are stored.
3. **Start the Server**: Use the configured port to start the server and access the web interface for montage creation.

For additional details, refer to the hand-written README.

## Key Files

The montage-agent package is organized into several key files, each serving a specific purpose:

- **[montageManifest.json](./src/agent/montageManifest.json)**: Defines the agent's schema, description, and supported actions.
- **[montageActionHandler.ts](./src/agent/montageActionHandler.ts)**: Implements the logic for handling montage-related actions, such as creating montages, adding photos, and starting slideshows.
- **[montageActionSchema.ts](./src/agent/montageActionSchema.ts)**: Specifies the types and structure of actions, activities, and entities that the agent can process.
- **[route.ts](./src/route/route.ts)**: Sets up the Express server, handles HTTP requests, and enforces origin restrictions for security.
- **[originAllowlist.ts](./src/route/originAllowlist.ts)**: Implements an origin allowlist to restrict access to the server, ensuring only trusted sources can interact with it.
- **Web Interface**:
  - [index.html](./src/site/index.html): The main HTML file for the user interface.
  - [index.ts](./src/site/index.ts): The JavaScript logic for the web interface.
  - `styles.css`: The CSS file for styling the interface.

## How to extend

To extend the montage-agent package, follow these steps:

1. **Define New Actions**:
   - Add new action types to the [montageActionSchema.ts](./src/agent/montageActionSchema.ts) file. Clearly define the action name, parameters, and expected behavior.
2. **Implement Action Logic**:
   - Implement the logic for the new actions in the [montageActionHandler.ts](./src/agent/montageActionHandler.ts) file. Use existing patterns for consistency and ensure the new logic integrates with other system components.
3. **Update the Manifest**:
   - Add the new actions to the [montageManifest.json](./src/agent/montageManifest.json) file, including descriptions and schema references.
4. **Test the Changes**:
   - Write unit tests to verify the functionality of the new actions. Ensure the tests cover a variety of scenarios, including edge cases.
5. **Update the Web Interface** (if applicable):
   - Modify the [index.ts](./src/site/index.ts) and [index.html](./src/site/index.html) files to expose the new actions to users through the web interface.
6. **Run and Validate**:
   - Start the server and test the new functionality through the web interface or API endpoints.

By following these steps, you can extend the montage-agent package to support additional features and workflows.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/route/route.js` _(not found on disk)_
- `./agent/manifest` → [./src/agent/montageManifest.json](./src/agent/montageManifest.json)
- `./agent/handlers` → `./dist/agent/montageActionHandler.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [@typeagent/aiclient](../../../packages/aiclient/README.md)
- [@typeagent/common-utils](../../../packages/utils/commonUtils/README.md)
- [@typeagent/websocket-utils](../../../packages/utils/webSocketUtils/README.md)
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
- [./src/route/originAllowlist.ts](./src/route/originAllowlist.ts)
- [./src/route/route.ts](./src/route/route.ts)
- [./src/route/tsconfig.json](./src/route/tsconfig.json)
- [./src/site/index.html](./src/site/index.html)
- [./src/site/photo.ts](./src/site/photo.ts)
- _…and 2 more under `./src/`._

---

_Auto-generated against commit `88f04471002e27f82ae1ddf73a7ae8acdfe09b5d` on `2026-07-03T09:02:51.801Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter montage-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

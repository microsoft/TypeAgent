<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=d0c0d9e8e2640b154ecc71d549a30917ee71a3e5dda0b3bd8b294bb9b677c9a6 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# montage-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The montage-agent package is a TypeAgent application agent designed to assist users in creating and managing photo montages. It enables collaborative workflows between users and the agent, allowing for efficient organization and manipulation of images to produce montages.

## What it does

The montage-agent provides a range of actions to facilitate the creation and management of photo montages. These actions include:

- `createMontage`: Create a new montage.
- `addPhotos` and `removePhotos`: Add or remove photos from a montage.
- `selectPhotos`: Select specific photos for inclusion in a montage.
- `setMontageViewMode`: Adjust the view mode for the montage.
- `startSlideShow`: Begin a slideshow of the montage.
- `deleteMontage` and `deleteAllMontage`: Remove one or all montages.
- `listMontage`: Retrieve a list of available montages.
- `mergeMontage`: Combine multiple montages into one.

The agent integrates with other system components, such as image storage and processing utilities, to perform these tasks. It also provides a web-based interface for users to interact with the montage creation process.

## Setup

To set up the montage-agent package, follow these steps:

1. **Install Dependencies**: Run `pnpm install` in the package directory to install all required dependencies.
2. **Configure Environment Variables**: Set the following environment variables:
   - `PORT`: The port number on which the server will run.
   - `INDEX_CACHE_PATH`: The file path to the image index cache.
   - `ROOT_IMAGE_FOLDER`: The root directory where images are stored.
3. **Run the Server**: Start the server by specifying the configured port. For example:
   ```bash
   pnpm start --port=<PORT>
   ```
4. For additional setup details, refer to the hand-written README.

## Key Files

The montage-agent package is structured into several key files, each serving a specific purpose:

- **[montageManifest.json](./src/agent/montageManifest.json)**: Defines the agent's schema, description, and supported actions.
- **[montageActionHandler.ts](./src/agent/montageActionHandler.ts)**: Implements the logic for handling montage-related actions such as `createMontage`, `addPhotos`, and `removePhotos`.
- **[montageActionSchema.ts](./src/agent/montageActionSchema.ts)**: Specifies the types and structure of all actions, activities, and entities supported by the agent.
- **[route.ts](./src/route/route.ts)**: Configures the Express server, handles HTTP requests, and enforces origin allowlist rules for secure access.
- **[originAllowlist.ts](./src/route/originAllowlist.ts)**: Implements origin validation to restrict access to the montage view server.
- **Web Interface Files**:
  - [index.html](./src/site/index.html): The main HTML file for the user interface.
  - [index.ts](./src/site/index.ts): The entry point for the web interface's client-side logic.
  - [styles.css](./src/site/styles.css): Styles for the web interface.

## How to extend

To add new features or customize the montage-agent, follow these steps:

1. **Define New Actions**:

   - Add new action types to the [montageActionSchema.ts](./src/agent/montageActionSchema.ts) file. Clearly define the action name, parameters, and expected behavior.

2. **Implement Action Logic**:

   - Implement the functionality for the new actions in [montageActionHandler.ts](./src/agent/montageActionHandler.ts). Use existing action implementations as a reference for structure and best practices.

3. **Update the Agent Manifest**:

   - Add the new actions to the [montageManifest.json](./src/agent/montageManifest.json) file. Provide a clear description of the action and its purpose.

4. **Modify the Web Interface (if needed)**:

   - Update the web interface files ([index.html](./src/site/index.html), [index.ts](./src/site/index.ts), and [styles.css](./src/site/styles.css)) to support the new functionality. For example, you may need to add new buttons or input fields for user interaction.

5. **Test Your Changes**:

   - Write unit tests for the new actions and their implementations. Ensure that the tests cover a variety of scenarios, including edge cases.
   - Test the web interface to confirm that the new functionality works as expected.

6. **Run the Server**:
   - Start the server and verify that the new actions are correctly integrated and functional. Use the web interface or API calls to test the new features.

By following these steps, you can extend the montage-agent to support additional capabilities and tailor it to specific use cases.

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

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-05T09:01:32.154Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter montage-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

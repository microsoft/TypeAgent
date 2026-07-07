<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=d0c0d9e8e2640b154ecc71d549a30917ee71a3e5dda0b3bd8b294bb9b677c9a6 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# montage-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The montage-agent package is a TypeAgent application agent designed to assist users in creating and managing photo montages. It enables collaborative workflows between the user and the agent, providing tools to organize, edit, and display images in a montage format. The package includes both backend logic for handling montage-related actions and a web-based interface for user interaction.

## What it does

The montage-agent package supports a variety of actions related to photo montage creation and management. These include:

- **Montage Creation and Management**: Actions like `createMontage`, `deleteMontage`, and `listMontage` allow users to create new montages, remove existing ones, and view a list of available montages.
- **Photo Selection and Editing**: Actions such as `addPhotos`, `removePhotos`, `selectPhotos`, and `clearSelection` enable users to add, remove, and manage photos within a montage.
- **Montage Customization**: Actions like `setMontageViewMode` and `changeTitle` allow users to customize the appearance and metadata of their montages.
- **Advanced Features**: Additional actions like `mergeMontage`, `startSlideShow`, and `setSearchParameters` provide advanced functionality for combining montages, creating slideshows, and filtering images.

The agent integrates with other system components, such as image storage, processing libraries, and knowledge processors, to perform these tasks. It also includes a web interface for users to interact with the montage creation process, making it accessible and user-friendly.

## Setup

To set up the montage-agent package, follow these steps:

1. **Install Dependencies**: Run `pnpm install` in the package directory to install all required dependencies.
2. **Set Environment Variables**: Configure the following environment variables:
   - `PORT`: The port number on which the server will run.
   - `INDEX_CACHE_PATH`: The file path to the image index cache.
   - `ROOT_IMAGE_FOLDER`: The root directory where images are stored.
3. **Run the Server**: Start the server by specifying the port number as a command-line argument. For example:
   ```bash
   pnpm start --port=3000
   ```
4. For additional setup details, refer to the hand-written README.

## Key Files

The montage-agent package is organized into several key files, each serving a specific purpose:

- **[montageManifest.json](./src/agent/montageManifest.json)**: Defines the agent's metadata, including its description, schema, and supported actions.
- **[montageActionHandler.ts](./src/agent/montageActionHandler.ts)**: Implements the logic for handling montage-related actions, such as creating montages, adding photos, and managing view modes.
- **[montageActionSchema.ts](./src/agent/montageActionSchema.ts)**: Specifies the schema for the actions, activities, and entities supported by the agent. This file defines the structure and parameters for each action.
- **[route.ts](./src/route/route.ts)**: Sets up the Express server, handles HTTP requests, and enforces security measures like origin allowlists.
- **[originAllowlist.ts](./src/route/originAllowlist.ts)**: Implements an origin allowlist to restrict access to the server, ensuring only authorized requests are processed.
- **Web Interface Files**:
  - [index.html](./src/site/index.html): The main HTML file for the web interface.
  - [index.ts](./src/site/index.ts): The TypeScript file that powers the web interface's functionality.
  - `styles.css`: Provides styling for the web interface.

## How to extend

To extend the functionality of the montage-agent package, follow these steps:

1. **Define New Actions**:

   - Add new action types to the [montageActionSchema.ts](./src/agent/montageActionSchema.ts) file. Clearly define the action name, parameters, and expected behavior.

2. **Implement Action Logic**:

   - Implement the logic for the new actions in the [montageActionHandler.ts](./src/agent/montageActionHandler.ts) file. Use existing action implementations as a reference for structure and best practices.

3. **Update the Agent Manifest**:

   - Add the new actions to the [montageManifest.json](./src/agent/montageManifest.json) file. Include a description of each action to ensure they are properly documented.

4. **Modify the Web Interface (if needed)**:

   - Update the web interface files ([index.html](./src/site/index.html), [index.ts](./src/site/index.ts), and `styles.css`) to support the new actions. For example, you might add new buttons or input fields to trigger the actions.

5. **Test Your Changes**:

   - Write unit tests to validate the new actions. Ensure that the tests cover a variety of scenarios, including edge cases.
   - Test the web interface to confirm that the new functionality works as expected.

6. **Run and Verify**:
   - Start the server and test the new actions in a local environment. Use the web interface or API calls to verify the behavior of the new features.

By following these steps, you can enhance the montage-agent package to meet additional requirements or support new use cases.

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

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-06T09:20:03.630Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter montage-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

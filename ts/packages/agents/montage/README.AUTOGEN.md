<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=d0c0d9e8e2640b154ecc71d549a30917ee71a3e5dda0b3bd8b294bb9b677c9a6 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# montage-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `montage-agent` package is a TypeAgent application agent designed to assist users in creating and managing photo montages. It serves as a collaborative tool, enabling users to interact with the agent to organize, edit, and display collections of images. The agent integrates with other system components for image processing, storage, and user interaction through a web interface.

## What it does

The `montage-agent` provides a range of actions to facilitate the creation and management of photo montages. These actions include:

- **Montage Creation and Management**: Actions like `createMontage`, `deleteMontage`, and `listMontage` allow users to create new montages, delete existing ones, and view a list of available montages.
- **Photo Management**: Actions such as `addPhotos`, `removePhotos`, `selectPhotos`, and `clearSelection` enable users to add, remove, and manage photos within a montage.
- **Montage Customization**: Actions like `setMontageViewMode`, `changeTitle`, and `setSearchParameters` allow users to customize the appearance and behavior of their montages.
- **Interactive Features**: Actions such as `startSlideShow` and `showSearchParameters` provide interactive capabilities for users to engage with their montages.

The agent also includes a web-based interface for users to interact with the montage creation process. This interface allows users to view, edit, and manage their montages in a user-friendly environment.

## Setup

To set up the `montage-agent` package, follow these steps:

1. **Install Dependencies**: Run `pnpm install` in the package directory to install all required dependencies.
2. **Configure Environment Variables**: Set the following environment variables:
   - `PORT`: The port number on which the server will run.
   - `INDEX_CACHE_PATH`: The file path to the image index cache.
   - `ROOT_IMAGE_FOLDER`: The root directory where images are stored.
3. **Run the Server**: Start the server by providing the configured port as a command-line argument. For example:
   ```bash
   node dist/route/route.js <PORT>
   ```
4. For additional setup details, refer to the hand-written README.

## Key Files

The `montage-agent` package is structured into several key files, each serving a specific purpose:

- **[montageManifest.json](./src/agent/montageManifest.json)**: Defines the agent's metadata, including its description, emoji representation, and schema details.
- **[montageActionHandler.ts](./src/agent/montageActionHandler.ts)**: Implements the logic for handling montage-related actions, such as creating montages, adding photos, and managing montage views.
- **[montageActionSchema.ts](./src/agent/montageActionSchema.ts)**: Specifies the schema for the actions, activities, and entities that the agent can process. This includes type definitions for actions like `addPhotos`, `removePhotos`, and `setMontageViewMode`.
- **[route.ts](./src/route/route.ts)**: Sets up the Express server, handles HTTP requests, and enforces security measures such as origin allowlists.
- **[originAllowlist.ts](./src/route/originAllowlist.ts)**: Implements an origin allowlist to restrict access to the server, ensuring only authorized requests are processed.
- **Web Interface Files**:
  - [index.html](./src/site/index.html): The main HTML file for the web interface, providing the structure for user interaction.
  - [index.ts](./src/site/index.ts): Contains the client-side logic for the web interface.
  - [photo.ts](./src/site/photo.ts): Handles photo-related operations in the web interface.

## How to extend

To extend the functionality of the `montage-agent` package, follow these steps:

1. **Define New Actions**:

   - Add new action types to the [montageActionSchema.ts](./src/agent/montageActionSchema.ts) file. Clearly define the action name, parameters, and expected behavior.
   - For example, to add a new action for filtering photos, define a new type in the schema file with the required parameters.

2. **Implement Action Logic**:

   - Implement the logic for the new actions in the [montageActionHandler.ts](./src/agent/montageActionHandler.ts) file.
   - Follow the existing patterns for action handling, such as using helper functions like `createActionResult` or `createActionResultFromError`.

3. **Update the Agent Manifest**:

   - Add the new actions to the [montageManifest.json](./src/agent/montageManifest.json) file. Include a description of the action and its purpose.

4. **Modify the Web Interface (if needed)**:

   - Update the web interface files ([index.html](./src/site/index.html), [index.ts](./src/site/index.ts), etc.) to include UI elements or interactions for the new actions.

5. **Test Your Changes**:

   - Write unit tests to validate the new actions. Ensure that the tests cover various scenarios, including edge cases.
   - Run the server and test the new functionality through the web interface.

6. **Documentation**:
   - Update the hand-written README or other documentation to reflect the new features and provide usage instructions.

By following these steps, you can enhance the `montage-agent` package to support additional use cases and improve its functionality.

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

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-04T08:54:09.388Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter montage-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=b2f2e15566301b5dfdf51d22bc7b989acee4cda9b5b3602fc502f2ca2b92dc67 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# settings-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The settings agent is a sample TypeAgent application designed to demonstrate how a system settings agent could function on a Windows host. It showcases the use of structured schemas to interact with a language model, enabling the agent to process system settings actions and generate responses, including HTML-based response cards. This package is part of the TypeAgent monorepo and integrates with other components such as `@typeagent/agent-sdk`, `@typeagent/aiclient`, and `telemetry`.

## What it does

The settings agent is designed to handle actions related to system settings adjustments. It currently supports the following actions:

- **`dimBrightNessAction`**: Adjusts the screen brightness, either dimming or brightening it based on user input.
- **`adjustMultiMonitorLayoutAction`**: Modifies the layout of multiple monitors, such as rearranging their positions or changing display settings.

The agent processes these actions by interpreting user requests, executing the corresponding logic, and generating structured responses. These responses can include HTML display cards, which provide a visual representation of the changes or options available.

The agent leverages the following components from the TypeAgent ecosystem:

- **`@typeagent/agent-sdk`**: Provides the core framework for defining and handling actions.
- **`@typeagent/aiclient`**: Facilitates communication with the language model to interpret user intents.
- **`telemetry`**: Enables logging and monitoring of the agent's operations.

## Setup

To set up and run the settings agent, follow these steps:

1. **Install dependencies**: From the root of the monorepo, install all required dependencies by running:

   ```bash
   pnpm install
   ```

2. **Build the project**: Compile the TypeScript source files into JavaScript by running:

   ```bash
   pnpm build
   ```

3. **Run the agent**: Use the appropriate TypeAgent runtime or integration to execute the settings agent and test its functionality.

This package does not require any specific environment variables or external API keys. For additional configuration details, refer to the hand-written README.

## Key Files

The settings agent's implementation is organized into the following key files:

- **[settingsManifest.json](./src/settingsManifest.json)**: Defines the agent's metadata, including its description, emoji character, and schema details. This file serves as the entry point for the agent's configuration.

- **[settingsActionSchema.ts](./src/settingsActionSchema.ts)**: Specifies the schema for the actions the agent can handle. It defines the structure and parameters for actions such as `dimBrightNessAction` and `adjustMultiMonitorLayoutAction`.

- **[settingsCommandHandler.ts](./src/settingsCommandHandler.ts)**: Contains the core logic for handling actions. The `executeSettingsAction` function routes actions to the appropriate handler, while the `handleSettingsAction` function implements the specific logic for each action. For example, it uses helper functions like `createActionResult` and `createActionResultFromHtmlDisplayWithScript` to generate structured responses.

- **HTML templates**: The agent uses HTML files, such as `adjustMultiMonitorLayout.html`, to generate response cards. These files are located in the `settings/cards/` directory and are dynamically read by the handler.

## How to extend

To extend the settings agent, you can add new actions or modify existing ones. Follow these steps:

1. **Define new actions**:

   - Add new action types to the [settingsActionSchema.ts](./src/settingsActionSchema.ts) file.
   - Define the action's unique identifier (`id`), name (`actionName`), and required parameters.

   Example:

   ```ts
   export interface NewAction {
     id: "settings/newAction";
     actionName: "newAction";
     parameters: {
       originalRequest: string;
       additionalParam: string;
     };
   }
   ```

2. **Implement action handling**:

   - Update the [settingsCommandHandler.ts](./src/settingsCommandHandler.ts) file to include logic for the new action.
   - Add a case for the new action in the `handleSettingsAction` function. Use helper functions like `createActionResult` or `createActionResultFromHtmlDisplayWithScript` to generate responses.

   Example:

   ```ts
   case "newAction":
       const response = `Processed new action with param: ${action.parameters.additionalParam}`;
       result = createActionResult(response);
       break;
   ```

3. **Update the manifest**:

   - Add the new action to the `schema` section of the [settingsManifest.json](./src/settingsManifest.json) file to ensure it is recognized by the agent.

4. **Test your changes**:

   - Write unit tests to validate the new action's behavior. Ensure the agent processes the action correctly and generates the expected responses.
   - Use the TypeAgent testing framework or any other testing tools available in the monorepo.

By following these steps, you can expand the settings agent's capabilities to handle additional system settings or other related functionalities.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/settingsManifest.json](./src/settingsManifest.json)
- `./agent/handlers` → `./dist/settingsCommandHandler.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [@typeagent/aiclient](../../../packages/aiclient/README.md)
- [@typeagent/common-utils](../../../packages/utils/commonUtils/README.md)
- [agent-dispatcher](../../../packages/dispatcher/dispatcher/README.md)
- [chat-agent](../../../packages/agents/chat/README.md)
- [knowledge-processor](../../../packages/knowledgeProcessor/README.md)
- [telemetry](../../../packages/telemetry/README.md)
- [typeagent](../../../packages/typeagent/README.md)

External: `debug`, `typechat`

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/settingsActionSchema.ts`, `./src/settingsCommandHandler.ts`, `./src/settingsManifest.json`, …and 2 more under `./src/`.

### Agent surface

- Manifest: [./src/settingsManifest.json](./src/settingsManifest.json)
- Schema: [./src/settingsActionSchema.ts](./src/settingsActionSchema.ts)
- Handler: [./src/settingsCommandHandler.ts](./src/settingsCommandHandler.ts)

---

_Auto-generated against commit `44b34a9ac8794b6f90489ff7e55fe57283c34960` on `2026-07-11T08:34:41.338Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter settings-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

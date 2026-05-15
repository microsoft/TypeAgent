<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=8dc062ffea944bf7b96c649a3235aecbc4729909c446000a72fdcf260eac827a -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# settings-agent â€” AI-generated documentation

> ðŸ¤– **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h â€” see the staleness footer at the end of this file.

## Overview

The settings agent is a sample TypeAgent application designed to manipulate system settings on a Windows host. It demonstrates how to use schema to obtain structured responses from a language model and how to integrate response cards into agent responses.

## What it does

The settings agent accepts actions related to system settings adjustments. Specifically, it can handle actions such as `dimBrightNessAction` and `adjustMultiMonitorLayoutAction`. These actions allow the agent to dim or brighten the screen and adjust the layout of multiple monitors, respectively. The agent processes these actions and generates appropriate responses, which can include HTML display cards.

## Setup

To set up the settings agent, ensure you have the necessary dependencies installed. The package relies on several workspace dependencies, including `@typeagent/agent-sdk`, `@typeagent/common-utils`, `agent-dispatcher`, `aiclient`, `chat-agent`, `knowledge-processor`, `telemetry`, and `typeagent`. Additionally, it uses external dependencies such as `debug` and `typechat`.

For detailed setup instructions, including environment variables and any required API keys, refer to the hand-written README.

## Key Files
The settings agent's architecture consists of several key components:

- **Manifest**: The [settingsManifest.json](./src/settingsManifest.json) file defines the agent's description, emoji character, and schema details.
- **Schema**: The [settingsActionSchema.ts](./src/settingsActionSchema.ts) file outlines the structure of the actions the agent can handle, such as `DimBrightNessAction` and `AdjustMultiMonitorLayoutAction`.
- **Handler**: The [settingsCommandHandler.ts](./src/settingsCommandHandler.ts) file contains the logic for executing the actions defined in the schema. It includes functions to instantiate the agent and handle specific actions.

## How to extend

To extend the settings agent, follow these steps:

1. **Add new actions**: Define new actions in the [settingsActionSchema.ts](./src/settingsActionSchema.ts) file. Ensure each action has a unique identifier, name, and parameters.
2. **Implement action handling**: Update the [settingsCommandHandler.ts](./src/settingsCommandHandler.ts) file to include logic for handling the new actions. Add cases to the `handleSettingsAction` function to process the new actions and generate appropriate responses.
3. **Test your changes**: Run tests to verify that the new actions are handled correctly and produce the expected results. Ensure that the agent's responses are accurate and formatted as intended.

By following these steps, you can extend the functionality of the settings agent to handle additional system settings adjustments.

## Reference

> âš™ï¸ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` â†’ [./src/settingsManifest.json](./src/settingsManifest.json)
- `./agent/handlers` â†’ [./dist/settingsCommandHandler.js](./dist/settingsCommandHandler.js)

### Dependencies

Workspace:

- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [@typeagent/common-utils](../../../packages/utils/commonUtils/README.md)
- [agent-dispatcher](../../../packages/dispatcher/dispatcher/README.md)
- [aiclient](../../../packages/aiclient/README.md)
- [chat-agent](../../../packages/agents/chat/README.md)
- [knowledge-processor](../../../packages/knowledgeProcessor/README.md)
- [telemetry](../../../packages/telemetry/README.md)
- [typeagent](../../../packages/typeagent/README.md)

External: `debug`, `typechat`

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/settingsActionSchema.ts`, `./src/settingsCommandHandler.ts`, `./src/settingsManifest.json`, â€¦and 1 more under `./src/`.

### Agent surface

- Manifest: [./src/settingsManifest.json](./src/settingsManifest.json)
- Schema: [./src/settingsActionSchema.ts](./src/settingsActionSchema.ts)
- Handler: [./src/settingsCommandHandler.ts](./src/settingsCommandHandler.ts)

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T10:06:08.903Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter settings-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

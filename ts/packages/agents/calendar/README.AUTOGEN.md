<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=30ea2a1089d61cec4f70adf48a952acdf3ccab0f4d8bbc9d7fd7de7feb256cdb -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# calendar — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `calendar` package is a TypeAgent application agent designed to interact with the Outlook mail client using the Microsoft Graph API. It provides functionalities to manage calendar events, such as creating, updating, deleting, and finding events. This package includes the schema definition and implementation necessary for building a Calendar Agent that can handle structured prompting and leverage LLM capabilities.

## What it does

The calendar agent supports various actions related to calendar management. These actions include:

- `scheduleEvent`: Schedule a new event with specified details such as description, date, time, location, and participants.
- `findEvents`: Find events based on criteria like date, participant, or description.
- `addEvent`: Add a new event to the calendar.
- `removeEvent`: Remove an existing event from the calendar.
- `addParticipants`: Add participants to an existing event.
- `changeTime`: Change the time of an existing event.
- `changeDescription`: Change the description of an existing event.

The agent uses the Microsoft Graph API to interact with the user's calendar and relies on the `@microsoft/microsoft-graph-client` library for API communication. It also utilizes the `graph-utils` library for implementing various calendar actions.

## Setup

To set up the calendar agent, you need to configure the Microsoft Graph API access. Follow these steps:

1. Create a Microsoft Graph client application and demo tenant by following the Microsoft Graph quickstart example.
2. Update the following environment variables in the `.env` file with the credentials obtained from the Microsoft Graph client application:
   ```text
   MSGRAPH_APP_CLIENTID
   MSGRAPH_APP_CLIENTSECRET
   MSGRAPH_APP_TENANTID
   ```
3. Ensure you have the necessary dependencies installed by running `pnpm install`.

For detailed setup instructions, see [./README.md](./README.md).

## Architecture

The `calendar` package is structured as follows:

- **Manifest**: The agent's manifest is defined in [calendarManifest.json](./src/calendarManifest.json). This file describes the agent's integration with the Microsoft Graph's calendar and specifies the schema and grammar files.
- **Schema**: The schema definitions for the calendar actions are provided in [calendarActionsSchemaV1.ts](./src/calendarActionsSchemaV1.ts), [calendarActionsSchemaV2.ts](./src/calendarActionsSchemaV2.ts), and [calendarActionsSchemaV3.ts](./src/calendarActionsSchemaV3.ts). These files define the types and parameters for various calendar actions.
- **Grammar**: The grammar for parsing user requests is defined in [calendarSchema.agr](./src/calendarSchema.agr). This file contains patterns for user requests and maps them to corresponding actions.
- **Handlers**: The action handlers are implemented in [calendarActionHandlerV1.ts](./src/calendarActionHandlerV1.ts), [calendarActionHandlerV2.ts](./src/calendarActionHandlerV2.ts), and [calendarActionHandlerV3.ts](./src/calendarActionHandlerV3.ts). These files contain the logic for executing the calendar actions.

## How to extend

To extend the calendar agent, follow these steps:

1. **Add new actions**: Define new actions in the schema files (e.g., [calendarActionsSchemaV3.ts](./src/calendarActionsSchemaV3.ts)). Ensure you specify the action name and parameters.
2. **Update grammar**: Add new patterns for user requests in the grammar file [calendarSchema.agr](./src/calendarSchema.agr). Map these patterns to the new actions.
3. **Implement handlers**: Create or update the action handlers in the handler files (e.g., [calendarActionHandlerV3.ts](./src/calendarActionHandlerV3.ts)). Implement the logic for executing the new actions.
4. **Test**: Write tests to verify the new actions and handlers. Ensure the agent behaves as expected with the new functionalities.

Start by exploring the existing schema, grammar, and handler files to understand the current implementation. Then, follow the patterns to add your extensions.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/calendarManifest.json](./src/calendarManifest.json)
- `./agent/handlers` → [./dist/calendarActionHandlerV3.js](./dist/calendarActionHandlerV3.js)

### Dependencies

Workspace:

- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [action-grammar-compiler](../../../packages/actionGrammarCompiler/README.md)
- [graph-utils](../../../packages/agents/agentUtils/graphUtils/README.md)
- [typechat-utils](../../../packages/utils/typechatUtils/README.md)

External: `chalk`, `date-fns`, `debug`

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/calendarManifest.json`, `./src/calendarSchema.agr`, `./src/calendarActionHandlerV1.ts`, …and 10 more under `./src/`.

### Agent surface

- Manifest: [./src/calendarManifest.json](./src/calendarManifest.json)
- Grammar: [./src/calendarSchema.agr](./src/calendarSchema.agr)

---

_Auto-generated against commit `c52ef52d052f7bc93f52d2a76e7866fff8958079` on `2026-05-15T08:14:45.438Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter calendar docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

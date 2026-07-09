<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=8f079666fb865149f81c84a347251bd5f9883472773ff272c991fdfa7be2a688 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# calendar — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `calendar` package is a TypeAgent application agent designed to manage calendar events by interacting with the Microsoft Graph API. It enables users to perform operations such as creating, updating, deleting, and finding calendar events. The agent uses structured prompting and large language models (LLMs) to interpret user requests and execute corresponding actions. It integrates with the Outlook mail client and leverages the `@microsoft/microsoft-graph-client` library for API communication.

## What it does

The calendar agent provides a comprehensive set of actions to manage calendar events. These actions are grouped into two main categories:

### Event Management

- **`scheduleEvent`**: Schedule a new event with details such as description, date, time, location, and participants.
- **`addEvent`**: Add a new event to the calendar.
- **`removeEvent`**: Delete an existing event from the calendar.
- **`findEvents`**: Search for events based on criteria such as date, participant, or description.

### Event Modification

- **`addParticipants`**: Add participants to an existing event.
- **`changeTime`**: Update the time of an existing event.
- **`changeDescription`**: Modify the description of an existing event.

The agent uses the `graph-utils` library to implement these actions and relies on the `@microsoft/microsoft-graph-client` library for communication with the Microsoft Graph API. The agent also supports structured prompting through its schema and grammar definitions, enabling it to interpret natural language requests effectively.

### Example User Requests

The following are examples of user requests that the calendar agent can process:

- "Create a code review meeting tomorrow at 11:00am."
- "Add Alex and Megan to the meeting."
- "Set up a dim sum lunch meeting next Friday at noon."
- "Find all my meetings on Friday."

## Setup

To use the calendar agent, you need to configure access to the Microsoft Graph API. Follow these steps:

1. **Create a Microsoft Graph Client Application**:

   - Follow the Microsoft Graph quickstart guide at `https://developer.microsoft.com/en-us/graph/quick-start?state=option-typescript` to create a Graph client application and demo tenant.

2. **Set Environment Variables**:

   - Update the following environment variables in the `config.local.yaml` file (under the `msGraph` section) or in the legacy `.env` file with the credentials obtained from your Microsoft Graph client application:
     ```text
     MSGRAPH_APP_CLIENTID
     MSGRAPH_APP_CLIENTSECRET
     MSGRAPH_APP_TENANTID
     ```

3. **Install Dependencies**:

   - Run `pnpm install` to install the required dependencies.

4. **Fix Identity Cache Issues**:
   - If you encounter issues with the identity cache, clear it by running the following commands:
     ```text
     cd %localappdata%/.IdentityService
     del typeagent-tokencache*
     ```

For more details, refer to the hand-written README.

## Key Files

The `calendar` package is organized into several key files that define its functionality:

- **Manifest**:

  - [calendarManifest.json](./src/calendarManifest.json): Defines the agent's integration with the Microsoft Graph API, including references to the schema and grammar files.

- **Schema**:

  - [calendarActionsSchemaV1.ts](./src/calendarActionsSchemaV1.ts), [calendarActionsSchemaV2.ts](./src/calendarActionsSchemaV2.ts), [calendarActionsSchemaV3.ts](./src/calendarActionsSchemaV3.ts): Define the types and parameters for various calendar actions. These files evolve across versions to support new features and capabilities.

- **Grammar**:

  - [calendarSchema.agr](./src/calendarSchema.agr): Contains patterns for interpreting user requests and mapping them to corresponding actions. This file is essential for enabling natural language understanding.

- **Handlers**:

  - [calendarActionHandlerV1.ts](./src/calendarActionHandlerV1.ts), [calendarActionHandlerV2.ts](./src/calendarActionHandlerV2.ts), [calendarActionHandlerV3.ts](./src/calendarActionHandlerV3.ts): Implement the logic for executing calendar actions. Each version corresponds to a specific schema version.

- **Utilities**:
  - The package relies on utility libraries such as `graph-utils` and `typechat-utils` for tasks like date parsing, time zone handling, and API client creation.

## How to extend

To extend the functionality of the calendar agent, follow these steps:

1. **Define New Actions**:

   - Add new actions to the schema files (e.g., [calendarActionsSchemaV3.ts](./src/calendarActionsSchemaV3.ts)). Specify the action name, parameters, and expected behavior.

2. **Update Grammar**:

   - Extend the grammar file [calendarSchema.agr](./src/calendarSchema.agr) with new patterns to interpret user requests. Map these patterns to the newly defined actions.

3. **Implement Handlers**:

   - Add or update action handlers in the appropriate handler file (e.g., [calendarActionHandlerV3.ts](./src/calendarActionHandlerV3.ts)). Implement the logic for executing the new actions.

4. **Test Your Changes**:

   - Write tests to verify the new actions and handlers. Ensure the agent behaves as expected with the added functionality.

5. **Update the Manifest**:
   - If necessary, update the [calendarManifest.json](./src/calendarManifest.json) file to include references to new schema or grammar files.

By following these steps, you can extend the calendar agent to support additional use cases or integrate with other systems. Start by reviewing the existing schema, grammar, and handler files to understand the current implementation patterns.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/calendarManifest.json](./src/calendarManifest.json)
- `./agent/handlers` → `./dist/calendarActionHandlerV3.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/action-grammar-compiler](../../../packages/actionGrammarCompiler/README.md)
- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [graph-utils](../../../packages/agents/agentUtils/graphUtils/README.md)
- [typechat-utils](../../../packages/utils/typechatUtils/README.md)

External: `chalk`, `date-fns`, `debug`

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/calendarManifest.json`, `./src/calendarSchema.agr`, `./src/calendarActionHandlerV1.ts`, …and 11 more under `./src/`.

### Agent surface

- Manifest: [./src/calendarManifest.json](./src/calendarManifest.json)
- Grammar: [./src/calendarSchema.agr](./src/calendarSchema.agr)

---

_Auto-generated against commit `656444843518fd1f9bb1b157b6dbf6dcbcde3999` on `2026-07-09T09:05:44.186Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter calendar docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

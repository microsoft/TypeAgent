<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=988489b2a45c8a83d5688ad4091e078d2f09f9377c5ece61555b863bf7075ebe -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# email — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The Email agent is a TypeAgent application agent that facilitates email management by integrating with the Microsoft Graph API. It enables users to perform common email operations such as sending, replying to, forwarding, and searching for emails. The agent leverages structured prompting and large language models (LLMs) to interpret user requests and execute email-related actions via the Outlook mail client.

## What it does

The Email agent supports the following actions, which are implemented using the Microsoft Graph API:

- **`sendEmail`**: Sends an email with a subject, body, and recipients. Additional options include CC, BCC, and attachments (file paths or URLs). The `genContent` parameter allows dynamic content generation for the email body.
- **`forwardEmail`**: Forwards an existing email to specified recipients, with an optional additional message.
- **`replyEmail`**: Replies to an existing email, with options to include a body, CC, BCC, and attachments.
- **`findEmail`**: Searches for an email message using a `messageRef` parameter, which identifies the email to be retrieved.

These actions are implemented in [emailActionHandler.ts](./src/emailActionHandler.ts) and rely on the `graph-utils` library for email-specific functionality. The agent also integrates with the `@microsoft/microsoft-graph-client` library to interact with the Microsoft Graph API.

## Setup

To use the Email agent, you need to configure access to the Microsoft Graph API. Follow these steps:

1. **Create a Microsoft Graph Client Application**:

   - Visit the Microsoft Graph quickstart page (`https://developer.microsoft.com/en-us/graph/quick-start?state=option-typescript`) to create a Graph Client application.
   - Set up a demo tenant if required.

2. **Configure Environment Variables**:

   - Update the following variables in `config.local.yaml` (under the `msGraph` section) or in a `.env` file:
     - `MSGRAPH_APP_CLIENTID`: The client ID of your Graph Client application.
     - `MSGRAPH_APP_CLIENTSECRET`: The client secret of your Graph Client application.
     - `MSGRAPH_APP_TENANTID`: The tenant ID associated with your Azure Active Directory.

3. **Identity Cache Management**:
   - The agent uses the `@azure/identity-cache-persistence` package to persist user identity information. If you encounter issues with the identity cache, clear it by running:
     ```bash
     cd %localappdata%/.IdentityService
     del typeagent-tokencache*
     ```

These steps are required only once to set up the Graph Client application and configure the agent.

## Key Files

The Email agent's implementation is distributed across several key files:

- **[emailManifest.json](./src/emailManifest.json)**: Defines the agent's manifest, including its description, schema, and integration points.
- **[emailActionsSchema.ts](./src/emailActionsSchema.ts)**: Contains type definitions for the supported email actions (`sendEmail`, `replyEmail`, `forwardEmail`, and `findEmail`), specifying their parameters and expected inputs.
- **[emailActionHandler.ts](./src/emailActionHandler.ts)**: Implements the logic for handling email actions. This file integrates with the Microsoft Graph API and the `graph-utils` library to perform operations like sending, replying, forwarding, and searching emails.
- **[emailSchema.agr](./src/emailSchema.agr)**: Defines the grammar for parsing user requests into actionable commands. This ensures that user inputs are correctly interpreted and mapped to the appropriate actions.
- **[emailKpBridge.ts](./src/emailKpBridge.ts)**: Bridges email agent types with Knowledge Processor (kp) types, converting email messages into `TextChunks` and `ChunkGroups` for indexing and search.
- **[emailKpIndex.ts](./src/emailKpIndex.ts)**: Manages the lifecycle of the kp index, including fetching emails, indexing them, and enabling search capabilities.
- **[emailSchema.tests.json](./src/emailSchema.tests.json)**: Contains test cases for validating the email schema and actions.

These files collectively define the agent's schema, grammar, action handlers, and integration with external services.

## How to extend

To extend the Email agent, follow these steps:

1. **Define New Actions**:

   - Add new action types or modify existing ones in [emailActionsSchema.ts](./src/emailActionsSchema.ts).
   - Ensure the new actions are well-typed and include all necessary parameters.

2. **Implement Action Handlers**:

   - Add or update handlers in [emailActionHandler.ts](./src/emailActionHandler.ts) to process the new actions.
   - Use the `graph-utils` library or other relevant APIs to implement the desired functionality.

3. **Update the Grammar**:

   - Modify [emailSchema.agr](./src/emailSchema.agr) to include rules for the new actions.
   - Ensure the grammar can parse user requests into the appropriate action format.

4. **Test Your Changes**:

   - Add test cases to [emailSchema.tests.json](./src/emailSchema.tests.json) to validate the new actions and grammar rules.
   - Run the tests to ensure the agent behaves as expected.

5. **Integrate with Knowledge Processor (Optional)**:
   - If the new actions involve indexing or searching email content, update [emailKpBridge.ts](./src/emailKpBridge.ts) and [emailKpIndex.ts](./src/emailKpIndex.ts) to handle the new data.

By following this process, you can extend the Email agent to support additional email operations or integrate with other systems.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/emailManifest.json](./src/emailManifest.json)
- `./agent/handlers` → [./dist/emailActionHandler.js](./dist/emailActionHandler.js)

### Dependencies

Workspace:

- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [@typeagent/aiclient](../../../packages/aiclient/README.md)
- [graph-utils](../../../packages/agents/agentUtils/graphUtils/README.md)
- kp
- [typeagent](../../../packages/typeagent/README.md)

External: `@anthropic-ai/claude-agent-sdk`, `chalk`, `debug`

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/emailActionHandler.ts`, `./src/emailActionsSchema.ts`, `./src/emailManifest.json`, …and 7 more under `./src/`.

### Agent surface

- Manifest: [./src/emailManifest.json](./src/emailManifest.json)
- Schema: [./src/emailActionsSchema.ts](./src/emailActionsSchema.ts)
- Grammar: [./src/emailSchema.agr](./src/emailSchema.agr)
- Handler: [./src/emailActionHandler.ts](./src/emailActionHandler.ts)

### Actions

_4 actions implemented by this agent, parsed deterministically from `./src/emailActionsSchema.ts`. Sample utterances and parameter shapes are illustrative; consult the schema for the full signature._

| User says                                               | Action                                                |
| ------------------------------------------------------- | ----------------------------------------------------- |
| _Type for sending a simple email_                       | `sendEmail` → `{ "subject": "…", "to": ["…"] }`       |
| _Type for forwarding an email_                          | `forwardEmail` → `{ "to": ["…"], "messageRef": "…" }` |
| _Type for replying to an email_                         | `replyEmail` → `{ "messageRef": "…" }`                |
| _Type for finding an email message (search for emails)_ | `findEmail` → `{ "messageRef": "…" }`                 |

---

_Auto-generated against commit `f928ce70269b7d0f8942977c29147b2c8832b722` on `2026-07-15T22:42:29.947Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter email docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

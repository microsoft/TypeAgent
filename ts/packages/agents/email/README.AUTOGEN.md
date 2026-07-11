<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=ef97cc9a212056f34581503ddb9c93b8df51380f02fbafabd2ee9e2e7f5d01ea -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# email — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The Email agent is a TypeAgent application agent designed to facilitate email management through the Microsoft Graph API. It enables users to perform common email operations such as sending, replying to, forwarding, and searching for emails. By leveraging structured prompting and large language models (LLMs), the agent interprets user requests and interacts with the Outlook mail client via the Microsoft Graph API.

## What it does

The Email agent provides the following key actions for managing email workflows:

- **`sendEmail`**: Allows users to send an email with a subject, body, recipients, and optional attachments. It supports CC, BCC, and attachment handling, including file paths or URLs.
- **`forwardEmail`**: Enables forwarding an existing email to specified recipients, with the option to include an additional message.
- **`replyEmail`**: Facilitates replying to an existing email, with optional parameters for body content, CC, BCC, and attachments.
- **`findEmail`**: Searches for a specific email using a message reference, allowing users to locate and retrieve emails based on their content or metadata.

The agent integrates with the `graph-utils` library to perform these operations and uses the `@microsoft/microsoft-graph-client` library to interact with the Microsoft Graph API. Additionally, the agent supports generating email content using LLMs, enabling dynamic and context-aware email composition.

## Setup

To set up the Email agent, you need to configure access to the Microsoft Graph API. Follow these steps:

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

To extend the Email agent, you can follow these steps:

1. **Add or Modify Actions**:

   - Define new action types or modify existing ones in [emailActionsSchema.ts](./src/emailActionsSchema.ts). Ensure the new actions are well-typed and include all necessary parameters.

2. **Update Action Handlers**:

   - Implement the logic for new or modified actions in [emailActionHandler.ts](./src/emailActionHandler.ts). Use the `graph-utils` library or other relevant APIs to achieve the desired functionality.

3. **Modify the Grammar**:

   - Update [emailSchema.agr](./src/emailSchema.agr) to include rules for the new actions. Ensure the grammar can parse user requests into the appropriate action format.

4. **Test Your Changes**:

   - Add test cases to [emailSchema.tests.json](./src/emailSchema.tests.json) to validate the new actions and grammar rules. Run the tests to ensure the agent behaves as expected.

5. **Enhance Knowledge Processor Integration (Optional)**:
   - If the new actions involve indexing or searching email content, update [emailKpBridge.ts](./src/emailKpBridge.ts) and [emailKpIndex.ts](./src/emailKpIndex.ts) to handle the new data.

By following this process, you can extend the Email agent to support additional email operations or integrate with other systems.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/emailManifest.json](./src/emailManifest.json)
- `./agent/handlers` → `./dist/emailActionHandler.js` _(not found on disk)_

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

_Auto-generated against commit `44b34a9ac8794b6f90489ff7e55fe57283c34960` on `2026-07-11T08:34:41.338Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter email docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

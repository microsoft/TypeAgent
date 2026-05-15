<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=f28f4db0986fec3000531fa23ac9ed3c709cef5aeb4d718d72f803e4f56b87cd -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# email — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The Email agent is a TypeAgent application agent designed to interact with the Outlook mail client using the Microsoft Graph API. It enables operations such as composing, replying, forwarding, and searching for email messages. This package includes the schema definition and implementation necessary for building an email agent that leverages structured prompting and large language models (LLMs).

## What it does

The Email agent supports four main actions:

- `sendEmail`: Sends a simple email with specified subject, body, recipients, and optional attachments.
- `forwardEmail`: Forwards an existing email to specified recipients, optionally adding an additional message.
- `replyEmail`: Replies to an existing email, optionally including a body, CC, BCC, and attachments.
- `findEmail`: Searches for an email message based on a message reference.

These actions allow the agent to manage email communications effectively, integrating with the Microsoft Graph API to perform these tasks.

## Setup

To set up the Email agent, you need to configure access to the Microsoft Graph API. This involves creating a Graph Client application and updating the following environment variables in the `.env` file:

- `MSGRAPH_APP_CLIENTID`
- `MSGRAPH_APP_CLIENTSECRET`
- `MSGRAPH_APP_TENANTID`

These variables are essential for authenticating and interacting with the Microsoft Graph API. For detailed setup instructions, refer to the hand-written README.

## Key Files
The internal structure of the Email agent is organized into several key files:

- [emailManifest.json](./src/emailManifest.json): Defines the agent's manifest, including its description and schema.
- [emailActionsSchema.ts](./src/emailActionsSchema.ts): Contains the type definitions for the email actions.
- [emailActionHandler.ts](./src/emailActionHandler.ts): Implements the handlers for the email actions, integrating with the Microsoft Graph API.
- [emailSchema.agr](./src/emailSchema.agr): Defines the grammar for the email actions.
- [emailKpBridge.ts](./src/emailKpBridge.ts): Bridges email agent types and Knowledge Processor (kp) types, converting email messages into kp TextChunks and ChunkGroups.
- [emailKpIndex.ts](./src/emailKpIndex.ts): Manages the kp index lifecycle for the email agent, including fetching emails, indexing them, and providing search capabilities.

## How to extend

To extend the Email agent, follow these steps:

1. **Open the schema file**: Start with [emailActionsSchema.ts](./src/emailActionsSchema.ts) to define new actions or modify existing ones.
2. **Implement handlers**: Add or update handlers in [emailActionHandler.ts](./src/emailActionHandler.ts) to process the new actions.
3. **Update the grammar**: Modify [emailSchema.agr](./src/emailSchema.agr) to include new action rules.
4. **Test your changes**: Ensure your modifications work correctly by adding test cases in [emailSchema.tests.json](./src/emailSchema.tests.json).

By following this pattern, you can extend the functionality of the Email agent to support additional email operations or integrate with other services.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/emailManifest.json](./src/emailManifest.json)
- `./agent/handlers` → [./dist/emailActionHandler.js](./dist/emailActionHandler.js)

### Dependencies

Workspace:

- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [aiclient](../../../packages/aiclient/README.md)
- [graph-utils](../../../packages/agents/agentUtils/graphUtils/README.md)
- kp
- [typeagent](../../../packages/typeagent/README.md)

External: `@anthropic-ai/claude-agent-sdk`, `chalk`, `debug`

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/emailActionHandler.ts`, `./src/emailActionsSchema.ts`, `./src/emailManifest.json`, …and 6 more under `./src/`.

### Agent surface

- Manifest: [./src/emailManifest.json](./src/emailManifest.json)
- Schema: [./src/emailActionsSchema.ts](./src/emailActionsSchema.ts)
- Grammar: [./src/emailSchema.agr](./src/emailSchema.agr)
- Handler: [./src/emailActionHandler.ts](./src/emailActionHandler.ts)

### Actions

_4 actions implemented by this agent, parsed deterministically from `./src/emailActionsSchema.ts`. Sample utterances and parameter shapes are illustrative; consult the schema for the full signature._

| User says | Action |
| --- | --- |
| _Type for sending a simple email_ | `sendEmail` → `{ "subject": "…", "to": ["…"] }` |
| _Type for forwarding an email_ | `forwardEmail` → `{ "to": ["…"], "messageRef": "…" }` |
| _Type for replying to an email_ | `replyEmail` → `{ "messageRef": "…" }` |
| _Type for finding an email message (search for emails)_ | `findEmail` → `{ "messageRef": "…" }` |

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T10:06:08.903Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter email docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

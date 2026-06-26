<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=45a77f2a9050899a071bc71ba0711777cf5cd5c5c4a807c494ce10062f4eb46e -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# android-mobile-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `android-mobile-agent` package is an Android mobile dispatcher agent designed to perform various actions on an Android device. It is part of the TypeAgent monorepo and interacts with mobile device functionalities such as sending SMS, making phone calls, setting alarms, searching nearby locations, and automating UI tasks.

## What it does

This agent supports the following actions:

- `sendSMS`: Sends an SMS to a specified phone number.
- `callPhoneNumber`: Initiates a phone call to a specified phone number.
- `setAlarm`: Sets an alarm on the local mobile device.
- `searchNearby`: Opens the maps application and performs a location search.
- `automateUI`: Automates UI tasks on the phone.

These actions enable the agent to interact with the mobile device's core functionalities, providing a range of automation capabilities. The agent can be used to enhance user experience by automating routine tasks and integrating mobile device operations into larger workflows.

## Setup

To set up the `android-mobile-agent`, ensure you have the necessary environment variables and configurations. The package does not require any external API keys or OAuth setup. Simply install the dependencies using `pnpm install`.

## Key Files

The package is structured as follows:

- **Manifest**: [androidMobileManifest.json](./src/androidMobileManifest.json) defines the agent's metadata, including its emoji representation and schema file.
- **Schema**: [androidMobileSchema.ts](./src/androidMobileSchema.ts) outlines the types and parameters for each action the agent can perform.
- **Handler**: [androidMobileActionHandler.ts](./src/androidMobileActionHandler.ts) contains the logic for executing the actions defined in the schema.

### Key Files and Their Responsibilities

- **[androidMobileManifest.json](./src/androidMobileManifest.json)**: Contains metadata about the agent, such as its description and the schema file it uses.
- **[androidMobileSchema.ts](./src/androidMobileSchema.ts)**: Defines the types and parameters for each action the agent can perform. This includes actions like `sendSMS`, `callPhoneNumber`, `setAlarm`, `searchNearby`, and `automateUI`.
- **[androidMobileActionHandler.ts](./src/androidMobileActionHandler.ts)**: Implements the logic for handling each action. This file includes functions to initialize the agent context, execute actions, and validate wildcard matches.

## How to extend

To extend the `android-mobile-agent`, follow these steps:

1. **Add a new action**: Define the new action type in [androidMobileSchema.ts](./src/androidMobileSchema.ts). Ensure it includes the necessary parameters and action name.

   ```ts
   export type NewAction = {
     actionName: "newAction";
     parameters: {
       originalRequest: string;
       additionalParam: string;
     };
   };
   ```

2. **Implement the action handler**: Update [androidMobileActionHandler.ts](./src/androidMobileActionHandler.ts) to include the logic for the new action within the `handlePhotoAction` function.

   ```ts
   async function handlePhotoAction(
     action: AndroidMobileAction,
     context: ActionContext<PhotoActionContext>,
   ) {
     let result: ActionResult | undefined = undefined;
     switch (action.actionName) {
       case "newAction": {
         // Implement the logic for the new action
         result = createActionResult({ success: true });
         break;
       }
       // other cases...
     }
     return result;
   }
   ```

3. **Test the new action**: Write tests to ensure the new action works as expected. Use the existing test patterns to validate the action's functionality.

By following these steps, you can extend the capabilities of the `android-mobile-agent` to support additional actions and functionalities.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/androidMobileManifest.json](./src/androidMobileManifest.json)
- `./agent/handlers` → [./dist/androidMobileActionHandler.js](./dist/androidMobileActionHandler.js)

### Dependencies

Workspace:

- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)

External: _None at runtime._

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/androidMobileActionHandler.ts`, `./src/androidMobileManifest.json`, `./src/androidMobileSchema.ts`, …and 1 more under `./src/`.

### Agent surface

- Manifest: [./src/androidMobileManifest.json](./src/androidMobileManifest.json)
- Schema: [./src/androidMobileSchema.ts](./src/androidMobileSchema.ts)
- Handler: [./src/androidMobileActionHandler.ts](./src/androidMobileActionHandler.ts)

### Actions

_5 actions implemented by this agent, parsed deterministically from `./src/androidMobileSchema.ts`. Sample utterances and parameter shapes are illustrative; consult the schema for the full signature._

| User says                                                                       | Action                                                                       |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| _sends a SMS to the supplied phone number_                                      | `sendSMS` → `{ "originalRequest": "…", "phoneNumber": "…", "message": "…" }` |
| _calls a user's phone number but only if we know the phone number_              | `callPhoneNumber` → `{ "originalRequest": "…", "phoneNumber": "…" }`         |
| _sets an alarm on the local mobile device_                                      | `setAlarm` → `{ "originalRequest": "…", "time": "…" }`                       |
| _opens the maps application and performs a location search_                     | `searchNearby` → `{ "originalRequest": "…", "searchTerm": "…" }`             |
| _Automation agent on the phone that can perform UI tasks on behalf of the user_ | `automateUI` → `{ "originalRequest": "…" }`                                  |

---

_Auto-generated against commit `127a36a95a15e918be533d6eaaf08adebe9070d9` on `2026-06-26T03:01:52.873Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter android-mobile-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

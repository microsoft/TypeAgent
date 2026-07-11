<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=6915d257cecea0f43f7a390062fe4aeb623de2d2ae5f8085d8ab825f07f9fd79 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# android-mobile-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `android-mobile-agent` is an Android mobile dispatcher agent within the TypeAgent monorepo. It facilitates interaction with Android devices by enabling the execution of various mobile-specific actions, such as sending SMS messages, making phone calls, setting alarms, performing location-based searches, and automating user interface tasks.

This agent is designed to integrate with the broader TypeAgent ecosystem, allowing developers to incorporate Android device operations into their workflows and applications.

## What it does

The `android-mobile-agent` provides a set of actions that allow it to control and interact with Android devices. These actions include:

- **`sendSMS`**: Sends an SMS message to a specified phone number. This action requires the `phoneNumber` and `message` parameters, along with the `originalRequest` for context.
- **`callPhoneNumber`**: Initiates a phone call to a specified phone number. The `phoneNumber` parameter is required, along with the `originalRequest`.
- **`setAlarm`**: Sets an alarm on the local Android device. The `time` parameter specifies the alarm time in the format `YYYY-MM-DDTHH:mm:ss`.
- **`searchNearby`**: Opens the device's maps application and performs a search for a specified `searchTerm` in the vicinity.
- **`automateUI`**: Automates user interface tasks on the Android device, enabling the agent to perform actions on behalf of the user. This action requires the `originalRequest` parameter.

These actions are defined in the agent's schema and implemented in its action handler. They enable the agent to perform a variety of tasks, making it a useful tool for automating and managing Android device operations.

## Setup

The `android-mobile-agent` does not require any additional setup, such as API keys or external service configurations. To use this agent, follow these steps:

1. Ensure you have the necessary dependencies installed by running:
   ```bash
   pnpm install
   ```
2. Install the agent from the workspace catalog source:
   ```text
   @package source list
   @package install androidMobile
   ```
   The catalog source entry for this agent is located in [../agents.catalog.json](../agents.catalog.json).

For more details, refer to the hand-written README.

## Key Files

The `android-mobile-agent` package is structured around the following key files:

- **[androidMobileManifest.json](./src/androidMobileManifest.json)**: This file contains metadata about the agent, including its description, emoji representation, and the schema file it uses. It serves as the configuration entry point for the agent.
- **[androidMobileSchema.ts](./src/androidMobileSchema.ts)**: This file defines the schema for the agent's actions, specifying the action types and their required parameters. It is the authoritative source for the agent's capabilities.
- **[androidMobileActionHandler.ts](./src/androidMobileActionHandler.ts)**: This file implements the logic for handling the actions defined in the schema. It includes functions for initializing the agent context, executing actions, and validating wildcard matches.

### File Responsibilities

1. **Manifest**: The [androidMobileManifest.json](./src/androidMobileManifest.json) file defines the agent's metadata and links to the schema file. It describes the agent's purpose and capabilities.
2. **Schema**: The [androidMobileSchema.ts](./src/androidMobileSchema.ts) file defines the structure of the actions, including their names and required parameters. For example:
   - `sendSMS` requires `originalRequest`, `phoneNumber`, and `message`.
   - `setAlarm` requires `originalRequest` and `time`.
3. **Handler**: The [androidMobileActionHandler.ts](./src/androidMobileActionHandler.ts) file contains the implementation of the actions. It includes a `handlePhotoAction` function that processes each action based on its type and executes the corresponding logic.

## How to extend

To add new actions or modify existing functionality in the `android-mobile-agent`, follow these steps:

1. **Define a new action in the schema**:

   - Open [androidMobileSchema.ts](./src/androidMobileSchema.ts).
   - Add a new action type with its name and required parameters. For example:
     ```ts
     export type NewAction = {
       actionName: "newAction";
       parameters: {
         originalRequest: string;
         customParam: string;
       };
     };
     ```
   - Update the `AndroidMobileAction` union type to include the new action.

2. **Implement the action handler**:

   - Open [androidMobileActionHandler.ts](./src/androidMobileActionHandler.ts).
   - Add a case for the new action in the `handlePhotoAction` function. For example:
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

3. **Update the manifest**:

   - Add the new action to the [androidMobileManifest.json](./src/androidMobileManifest.json) file under the `schema` section, ensuring it is properly documented.

4. **Test the new action**:
   - Write unit tests to verify the behavior of the new action. Use the existing test patterns as a guide to ensure the action is implemented correctly and integrates well with the rest of the agent.

By following these steps, you can extend the `android-mobile-agent` to support additional actions or modify its existing functionality to meet your requirements.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/androidMobileManifest.json](./src/androidMobileManifest.json)
- `./agent/handlers` → `./dist/androidMobileActionHandler.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)

External: _None at runtime._

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

_Auto-generated against commit `44b34a9ac8794b6f90489ff7e55fe57283c34960` on `2026-07-11T08:34:41.338Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter android-mobile-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

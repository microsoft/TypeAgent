// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAction } from "@typeagent/agent-sdk";
import { UnknownAction } from "./schema/dispatcherActionSchema.js";

export const DispatcherName = "dispatcher";
export const DispatcherClarifyName = "dispatcher.clarify";
export const DispatcherActivityName = "dispatcher.activity";
export const DispatcherEmoji = "🤖";

export function isUnknownAction(action: AppAction): action is UnknownAction {
    return action.actionName === "unknown";
}

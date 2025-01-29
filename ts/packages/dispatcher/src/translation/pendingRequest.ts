// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAction } from "@typeagent/agent-sdk";
import { DispatcherName } from "../context/interactiveIO.js";
import { PendingRequestEntry } from "./multipleActionSchema.js";
import { Action } from "agent-cache";

export type PendingRequestAction = {
    actionName: "pendingRequestAction";
    parameters: {
        pendingRequest: string;
        pendingResultEntityId: string;
    };
};

export function isPendingRequestAction(
    action: AppAction,
): action is PendingRequestAction {
    return (
        action.translatorName === DispatcherName &&
        action.actionName === "pendingRequestAction"
    );
}

export function createPendingRequestAction(entry: PendingRequestEntry) {
    return new Action(DispatcherName, "pendingRequestAction", {
        pendingRequest: entry.request,
        pendingResultEntityId: entry.pendingResultEntityId,
    });
}

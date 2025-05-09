// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAction } from "@typeagent/agent-sdk";
import { PendingRequestEntry } from "./multipleActionSchema.js";
import { createExecutableAction } from "agent-cache";
import { DispatcherName } from "../context/dispatcher/dispatcherUtils.js";

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
        action.schemaName === DispatcherName &&
        action.actionName === "pendingRequestAction"
    );
}

export function createPendingRequestAction(entry: PendingRequestEntry) {
    return createExecutableAction(DispatcherName, "pendingRequestAction", {
        pendingRequest: entry.request,
        pendingResultEntityId: entry.pendingResultEntityId,
    });
}

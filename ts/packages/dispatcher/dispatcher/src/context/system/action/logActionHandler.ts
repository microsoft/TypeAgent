// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ActionContext, TypeAgentAction } from "@typeagent/agent-sdk";

import type { CommandHandlerContext } from "../../commandHandlerContext.js";
import {
    clearLogSettings,
    openLogTrace,
    setLogProfile,
    showLogStatus,
} from "../handlers/logCommandHandler.js";
import type { LogAction } from "../schema/logActionSchema.js";

export async function executeLogAction(
    action: TypeAgentAction<LogAction>,
    context: ActionContext<CommandHandlerContext>,
) {
    switch (action.actionName) {
        case "showLogStatus":
            showLogStatus(context);
            return;
        case "setLogProfile":
            setLogProfile(action.parameters.profile, context);
            return;
        case "clearLogSettings":
            clearLogSettings(context);
            return;
        case "openLogTrace":
            await openLogTrace(action.parameters.traceId, context);
            return;
        default:
            throw new Error(
                `Invalid log action: ${(action as TypeAgentAction).actionName}`,
            );
    }
}

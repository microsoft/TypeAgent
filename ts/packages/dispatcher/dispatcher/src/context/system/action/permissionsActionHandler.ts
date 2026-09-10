// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ActionContext, TypeAgentAction } from "@typeagent/agent-sdk";

import type { CommandHandlerContext } from "../../commandHandlerContext.js";
import { setPermissionSessionApproval } from "../permissionSessionApproval.js";
import type { PermissionsAction } from "../schema/permissionsActionSchema.js";

export function executePermissionsAction(
    action: TypeAgentAction<PermissionsAction>,
    context: ActionContext<CommandHandlerContext>,
) {
    switch (action.actionName) {
        case "setPermissionApproval":
            setPermissionSessionApproval(context, action.parameters.enable);
            return;
        default:
            throw new Error(
                `Invalid permissions action: ${(action as TypeAgentAction).actionName}`,
            );
    }
}

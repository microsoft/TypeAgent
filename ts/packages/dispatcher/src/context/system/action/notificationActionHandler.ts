// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, AppAction } from "@typeagent/agent-sdk";
import {
    NotificationAction,
    ShowNotificationsAction,
} from "../schema/notificationActionSchema.js";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { processCommandNoLock } from "../../../command/command.js";

export async function executeNotificationAction(
    action: AppAction,
    context: ActionContext<CommandHandlerContext>,
) {
    const notificationAction = action as NotificationAction;
    switch (notificationAction.actionName) {
        case "show":
            const showAction = notificationAction as ShowNotificationsAction;
            await processCommandNoLock(
                `@notify show ${showAction.parameters.filter}`,
                context.sessionContext.agentContext,
            );
            break;
        case "summary":
            await processCommandNoLock(
                `@notify info`,
                context.sessionContext.agentContext,
            );
            break;
        case "clear":
            await processCommandNoLock(
                `@notify clear`,
                context.sessionContext.agentContext,
            );
            break;
        default:
            throw new Error(`Invalid action name: ${action.actionName}`);
    }
    return undefined;
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, AppAction } from "@typeagent/agent-sdk";
import {
    NotificationAction,
    ShowNotificationsAction,
} from "../schema/notificationActionSchema.js";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { processCommandNoLock } from "../../../command/command.js";
import { executeCommandFromHandlers } from "@typeagent/agent-sdk/helpers/command";
import {
    notifyCommandHandlers,
    STATUS_NOTICE_DEFAULT_MESSAGE,
} from "../handlers/notifyCommandHandler.js";

export async function executeNotificationAction(
    action: AppAction,
    context: ActionContext<CommandHandlerContext>,
) {
    const notificationAction = action as NotificationAction;
    switch (notificationAction.actionName) {
        case "showNotifications":
            const showAction = notificationAction as ShowNotificationsAction;
            await processCommandNoLock(
                `@notify show ${showAction.parameters.filter}`,
                context.sessionContext.agentContext,
            );
            break;
        case "showNotificationSummary":
            await processCommandNoLock(
                `@notify info`,
                context.sessionContext.agentContext,
            );
            break;
        case "clearNotifications":
            await processCommandNoLock(
                `@notify clear`,
                context.sessionContext.agentContext,
            );
            break;
        case "testNotification":
            await executeCommandFromHandlers(
                notifyCommandHandlers,
                ["test"],
                {
                    args: { message: notificationAction.parameters.message },
                    flags: {
                        mode: notificationAction.parameters.mode ?? "toast",
                    },
                },
                context,
            );
            break;
        case "testStatusNotice":
            await executeCommandFromHandlers(
                notifyCommandHandlers,
                ["status"],
                {
                    args: {
                        message:
                            notificationAction.parameters?.message ??
                            STATUS_NOTICE_DEFAULT_MESSAGE,
                    },
                    flags: {
                        level:
                            notificationAction.parameters?.level ?? "warning",
                        restart:
                            notificationAction.parameters?.restart ?? false,
                    },
                },
                context,
            );
            break;
        default:
            throw new Error(`Invalid action name: ${action.actionName}`);
    }
    return undefined;
}

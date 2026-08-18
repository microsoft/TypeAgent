// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, ActionResult, AppAction } from "@typeagent/agent-sdk";
import {
    CommandHandlerTable,
    executeCommandFromHandlers,
} from "@typeagent/agent-sdk/helpers/command";
import {
    NotificationAction,
    ShowNotificationsAction,
} from "../schema/notificationActionSchema.js";
import type { CommandHandlerContext } from "../../commandHandlerContext.js";
import { STATUS_NOTICE_DEFAULT_MESSAGE } from "../notificationDefaults.js";
import { getCommandParams } from "./actionParams.js";

// The command table is passed in rather than imported: importing it here would
// make this module depend on the command tree, which depends back on the system
// agent that dispatches these actions. Going through executeCommandFromHandlers
// also lets failures reach the caller, which processCommandNoLock swallows.
export async function executeNotificationAction(
    action: AppAction,
    context: ActionContext<CommandHandlerContext>,
    handlers: CommandHandlerTable,
): Promise<ActionResult | undefined> {
    const notificationAction = action as NotificationAction;
    const execute = (
        commands: string[],
        args: Record<string, unknown> = {},
        flags: Record<string, unknown> = {},
    ) =>
        executeCommandFromHandlers(
            handlers,
            commands,
            getCommandParams(handlers, commands, args, flags),
            context,
        );

    switch (notificationAction.actionName) {
        case "showNotifications": {
            const showAction = notificationAction as ShowNotificationsAction;
            return execute(["show", showAction.parameters.filter]);
        }
        case "showNotificationSummary":
            return execute(["info"]);
        case "clearNotifications":
            return execute(["clear"]);
        case "testNotification":
            return execute(
                ["test"],
                { message: notificationAction.parameters.message },
                { mode: notificationAction.parameters.mode ?? "toast" },
            );
        case "testStatusNotice":
            return execute(
                ["status"],
                {
                    message:
                        notificationAction.parameters?.message ??
                        STATUS_NOTICE_DEFAULT_MESSAGE,
                },
                {
                    level: notificationAction.parameters?.level ?? "warning",
                    restart: notificationAction.parameters?.restart ?? false,
                },
            );
        default:
            throw new Error(`Invalid action name: ${action.actionName}`);
    }
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAction, ActionContext, ActionResult } from "@typeagent/agent-sdk";
import {
    CommandHandlerTable,
    executeCommandFromHandlers,
} from "@typeagent/agent-sdk/helpers/command";
import type { CommandHandlerContext } from "../../commandHandlerContext.js";
import { UserSettingsAction } from "../schema/settingsActionSchema.js";
import { getCommandParams } from "./actionParams.js";

// The command table is passed in rather than imported: importing it here would
// make this module depend on the command tree, which depends back on the system
// agent that dispatches these actions. Going through executeCommandFromHandlers
// also lets failures reach the caller, which processCommandNoLock swallows.
export async function executeSettingsAction(
    action: AppAction,
    context: ActionContext<CommandHandlerContext>,
    handlers: CommandHandlerTable,
): Promise<ActionResult | undefined> {
    const settingsAction = action as unknown as UserSettingsAction;
    const execute = (commands: string[], args: Record<string, unknown> = {}) =>
        executeCommandFromHandlers(
            handlers,
            commands,
            getCommandParams(handlers, commands, args),
            context,
        );

    switch (settingsAction.actionName) {
        case "showSettings":
            return execute(["show"]);

        case "resetSettings":
            return execute(["reset"]);

        case "setServerHidden":
            return execute(["server", "hidden"], {
                value: String(settingsAction.parameters.enable),
            });

        case "setIdleTimeout":
            return execute(["server", "idleTimeout"], {
                seconds: settingsAction.parameters.seconds,
            });

        case "setConversationResume":
            return execute(["conversation", "resume"], {
                value: String(settingsAction.parameters.enable),
            });

        case "setAutoComplete":
            return execute(["ui", "autoComplete"], {
                value: String(settingsAction.parameters.enable),
            });

        default:
            throw new Error(
                `Unknown settings action: ${(settingsAction as UserSettingsAction).actionName}`,
            );
    }
}

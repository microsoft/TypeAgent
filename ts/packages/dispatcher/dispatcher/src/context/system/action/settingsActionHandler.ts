// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAction, ActionContext } from "@typeagent/agent-sdk";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { UserSettingsAction } from "../schema/settingsActionSchema.js";
import { processCommandNoLock } from "../../../command/command.js";

export async function executeSettingsAction(
    action: AppAction,
    context: ActionContext<CommandHandlerContext>,
) {
    const settingsAction = action as unknown as UserSettingsAction;
    switch (settingsAction.actionName) {
        case "setServerHidden":
            await processCommandNoLock(
                `@settings server hidden ${settingsAction.parameters.enable}`,
                context.sessionContext.agentContext,
            );
            break;

        case "setIdleTimeout":
            await processCommandNoLock(
                `@settings server idleTimeout ${settingsAction.parameters.seconds}`,
                context.sessionContext.agentContext,
            );
            break;

        case "setConversationResume":
            await processCommandNoLock(
                `@settings conversation resume ${settingsAction.parameters.enable}`,
                context.sessionContext.agentContext,
            );
            break;

        default:
            throw new Error(
                `Unknown settings action: ${(settingsAction as UserSettingsAction).actionName}`,
            );
    }
}

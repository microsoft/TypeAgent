// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    ActionResult,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import {
    CommandHandlerTable,
    executeCommandFromHandlers,
} from "@typeagent/agent-sdk/helpers/command";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { CopilotAction } from "../schema/copilotActionSchema.js";

export function executeCopilotAction(
    action: TypeAgentAction<CopilotAction, "system.copilot">,
    context: ActionContext<CommandHandlerContext>,
    handlers: CommandHandlerTable,
): Promise<ActionResult | undefined> {
    switch (action.actionName) {
        case "importCopilotSessions":
            return executeCommandFromHandlers(
                handlers,
                ["import"],
                undefined,
                context,
            );
        case "fixWithCopilot":
            return executeCommandFromHandlers(
                handlers,
                ["fix"],
                {
                    args: {
                        ...(action.parameters?.instructions === undefined
                            ? {}
                            : { instructions: action.parameters.instructions }),
                    },
                    flags: {
                        mode: action.parameters?.mode ?? "agent",
                        "no-screenshot":
                            action.parameters?.includeScreenshot === false,
                        "dev-captures":
                            action.parameters?.devCaptures ?? "auto",
                        target: action.parameters?.target ?? "native",
                        "no-send": action.parameters?.autoSend === false,
                        "reuse-session":
                            action.parameters?.reuseSession ?? false,
                        location: action.parameters?.location ?? "editor",
                    },
                },
                context,
            );
        case "loginToCopilot":
            return executeCommandFromHandlers(
                handlers,
                ["login"],
                {
                    args: {},
                    flags: {
                        host: action.parameters?.host ?? "https://github.com",
                        "no-open": action.parameters?.openBrowser === false,
                    },
                },
                context,
            );
    }
}

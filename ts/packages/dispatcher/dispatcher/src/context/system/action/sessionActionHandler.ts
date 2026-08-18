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
import type { CommandHandlerContext } from "../../commandHandlerContext.js";
import { SessionAction } from "../schema/sessionActionSchema.js";

export function executeSessionAction(
    action: TypeAgentAction<SessionAction, "system.session">,
    context: ActionContext<CommandHandlerContext>,
    handlers: CommandHandlerTable,
): Promise<ActionResult | undefined> {
    switch (action.actionName) {
        case "newSession":
            return executeCommandFromHandlers(
                handlers,
                ["new"],
                {
                    args: {},
                    flags: {
                        keep: action.parameters?.keepSettings ?? false,
                        ...(action.parameters?.persist === undefined
                            ? {}
                            : { persist: action.parameters.persist }),
                    },
                },
                context,
            );
        case "openSession":
            return executeCommandFromHandlers(
                handlers,
                ["open"],
                {
                    args: { session: action.parameters.session },
                    flags: undefined,
                },
                context,
            );
        case "resetSession":
            return executeCommandFromHandlers(
                handlers,
                ["reset"],
                undefined,
                context,
            );
        case "clearSession":
            return executeCommandFromHandlers(
                handlers,
                ["clear"],
                undefined,
                context,
            );
        case "listSessions":
            return executeCommandFromHandlers(
                handlers,
                ["list"],
                undefined,
                context,
            );
        case "deleteSession":
            return executeCommandFromHandlers(
                handlers,
                ["delete"],
                {
                    args: {
                        ...(action.parameters?.session === undefined
                            ? {}
                            : { session: action.parameters.session }),
                    },
                    flags: { all: action.parameters?.all ?? false },
                },
                context,
            );
        case "showSessionInfo":
            return executeCommandFromHandlers(
                handlers,
                ["info"],
                undefined,
                context,
            );
    }
}

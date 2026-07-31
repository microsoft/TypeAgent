// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    ActionResult,
    ParsedCommandParams,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import {
    CommandHandlerTable,
    executeCommandFromHandlers,
} from "@typeagent/agent-sdk/helpers/command";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { SystemDiagnosticsAction } from "../schema/systemDiagnosticsActionSchema.js";

type CommandExecutor = (
    handlers: CommandHandlerTable,
    commands: string[],
    params: ParsedCommandParams<any> | undefined,
    context: ActionContext<CommandHandlerContext>,
) => Promise<ActionResult | undefined>;

export function executeSystemDiagnosticsAction(
    action: TypeAgentAction<SystemDiagnosticsAction, "system.diagnostics">,
    context: ActionContext<CommandHandlerContext>,
    systemHandlers: CommandHandlerTable,
    execute: CommandExecutor = executeCommandFromHandlers,
): Promise<ActionResult | undefined> {
    const handlers = (name: "env" | "token" | "random") =>
        systemHandlers.commands[name] as CommandHandlerTable;

    switch (action.actionName) {
        case "listEnvironmentVariables":
            return execute(handlers("env"), ["all"], undefined, context);
        case "getEnvironmentVariable":
            return execute(
                handlers("env"),
                ["get"],
                {
                    args: { name: action.parameters.name },
                    flags: undefined,
                },
                context,
            );
        case "showTokenSummary":
            return execute(handlers("token"), ["summary"], undefined, context);
        case "showTokenDetails":
            return execute(handlers("token"), ["details"], undefined, context);
        case "runRandomOfflineRequest":
            return execute(handlers("random"), ["offline"], undefined, context);
        case "runRandomOnlineRequest":
            return execute(handlers("random"), ["online"], undefined, context);
    }
}

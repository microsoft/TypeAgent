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
import { indexCommandHandlers } from "../handlers/indexCommandHandler.js";
import { IndexAction } from "../schema/indexActionSchema.js";

type CommandExecutor = (
    handlers: CommandHandlerTable,
    commands: string[],
    params: ParsedCommandParams<any> | undefined,
    context: ActionContext<CommandHandlerContext>,
) => Promise<ActionResult | undefined>;

export function executeIndexAction(
    action: TypeAgentAction<IndexAction, "system.index">,
    context: ActionContext<CommandHandlerContext>,
    handlers: CommandHandlerTable = indexCommandHandlers,
    execute: CommandExecutor = executeCommandFromHandlers,
): Promise<ActionResult | undefined> {
    switch (action.actionName) {
        case "listIndexes":
            return execute(
                handlers,
                ["list"],
                { args: {}, flags: undefined },
                context,
            );
        case "showIndexInfo":
            return execute(
                handlers,
                ["info"],
                { args: { name: action.parameters.name }, flags: {} },
                context,
            );
        case "createIndex":
            return execute(
                handlers,
                ["create"],
                {
                    args: {
                        type: action.parameters.type,
                        name: action.parameters.name,
                        location: action.parameters.location,
                    },
                    flags: {},
                },
                context,
            );
        case "deleteIndex":
            return execute(
                handlers,
                ["delete"],
                {
                    args: { name: action.parameters.name },
                    flags: undefined,
                },
                context,
            );
    }
}

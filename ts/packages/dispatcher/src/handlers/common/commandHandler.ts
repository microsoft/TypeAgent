// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext } from "@typeagent/agent-sdk";
import { CommandHandlerContext } from "./commandHandlerContext.js";
import { CommandHandlerTable } from "@typeagent/agent-sdk/helpers/command";

export function getToggleCommandHandlers(
    name: string,
    toggle: (
        context: ActionContext<CommandHandlerContext>,
        enable: boolean,
    ) => Promise<void>,
) {
    return {
        on: {
            description: `Turn on ${name}`,
            run: async (
                request: string,
                context: ActionContext<CommandHandlerContext>,
            ) => {
                if (request !== "") {
                    throw new Error(`Invalid extra arguments: ${request}`);
                }
                await toggle(context, true);
            },
        },
        off: {
            description: `Turn off ${name}`,
            run: async (
                request: string,
                context: ActionContext<CommandHandlerContext>,
            ) => {
                if (request !== "") {
                    throw new Error(`Invalid extra arguments: ${request}`);
                }
                await toggle(context, false);
            },
        },
    };
}

export function getToggleHandlerTable(
    name: string,
    toggle: (
        context: ActionContext<CommandHandlerContext>,
        enable: boolean,
    ) => Promise<void>,
): CommandHandlerTable {
    return {
        description: `Toggle ${name}`,
        defaultSubCommand: undefined,
        commands: getToggleCommandHandlers(name, toggle),
    };
}

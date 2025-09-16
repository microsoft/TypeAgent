// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext } from "@typeagent/agent-sdk";
import { CommandHandlerContext } from "../context/commandHandlerContext.js";
import {
    CommandHandlerNoParams,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import { displaySuccess } from "@typeagent/agent-sdk/helpers/display";

export function getToggleCommandHandlers(
    name: string,
    toggle: (
        context: ActionContext<CommandHandlerContext>,
        enable: boolean,
    ) => Promise<void>,
): Record<string, CommandHandlerNoParams> {
    return {
        on: {
            description: `Turn on ${name}`,
            run: async (context: ActionContext<CommandHandlerContext>) => {
                await toggle(context, true);
                displaySuccess(`${name} is enabled.`, context);
            },
        },
        off: {
            description: `Turn off ${name}`,
            run: async (context: ActionContext<CommandHandlerContext>) => {
                await toggle(context, false);
                displaySuccess(`${name} is disabled.`, context);
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
        defaultSubCommand: "on",
        commands: getToggleCommandHandlers(name, toggle),
    };
}

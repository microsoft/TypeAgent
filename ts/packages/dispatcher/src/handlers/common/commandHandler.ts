// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandHandlerContext } from "./commandHandlerContext.js";

export interface CommandHandler {
    description: string;
    help?: string;
    run(request: string, context: CommandHandlerContext): Promise<void>;
}

export type HandlerTable = {
    description: string;
    commands: {
        [key: string]: CommandHandler | HandlerTable;
    };
    defaultCommand: CommandHandler | undefined;
};

export function getToggleCommandHandlers(
    name: string,
    toggle: (context: CommandHandlerContext, enable: boolean) => Promise<void>,
) {
    return {
        on: {
            description: `Turn on ${name}`,
            run: async (request: string, context: CommandHandlerContext) => {
                if (request !== "") {
                    throw new Error(`Invalid extra arguments: ${request}`);
                }
                await toggle(context, true);
            },
        },
        off: {
            description: `Turn off ${name}`,
            run: async (request: string, context: CommandHandlerContext) => {
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
    toggle: (context: CommandHandlerContext, enable: boolean) => Promise<void>,
): HandlerTable {
    return {
        description: `Toggle ${name}`,
        defaultCommand: undefined,
        commands: getToggleCommandHandlers(name, toggle),
    };
}

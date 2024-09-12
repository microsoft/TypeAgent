// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CommandDescriptor,
    CommandDescriptorTable,
} from "@typeagent/agent-sdk";
import { CommandHandlerContext } from "./commandHandlerContext.js";

export interface DispatcherCommandHandler extends CommandDescriptor {
    run(
        request: string,
        context: CommandHandlerContext,
        attachments?: string[],
    ): Promise<void>;
}

export interface DispatcherHandlerTable extends CommandDescriptorTable {
    description: string;
    commands: Record<string, DispatcherCommandHandler | DispatcherHandlerTable>;
    defaultSubCommand?: DispatcherCommandHandler | undefined;
}

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
): DispatcherHandlerTable {
    return {
        description: `Toggle ${name}`,
        defaultSubCommand: undefined,
        commands: getToggleCommandHandlers(name, toggle),
    };
}

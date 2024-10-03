// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext } from "../agentInterface.js";
import {
    AppAgentCommandInterface,
    CommandDescriptor,
    CommandDescriptors,
    CommandDescriptorTable,
    ParameterDefinitions,
} from "../command.js";

export { parseCommandArgs, resolveFlag } from "./parameterHelpers.js";

export type CommandHandlerNoParams = CommandDescriptor & {
    parameters?: undefined;
    run(
        context: ActionContext<unknown>,
        input: undefined,
        attachments?: string[],
    ): Promise<void>;
};

export type CommandHandlerNoParse = CommandDescriptor & {
    parameters: true;
    run(
        context: ActionContext<unknown>,
        input: string,
        attachments?: string[],
    ): Promise<void>;
};

export type CommandHandler = CommandDescriptor & {
    parameters: ParameterDefinitions;
    run(
        context: ActionContext<unknown>,
        input: string,
        attachments?: string[],
    ): Promise<void>;
};

type CommandHandlerTypes =
    | CommandHandlerNoParams
    | CommandHandlerNoParse
    | CommandHandler;

type CommandTypes = CommandHandlerTypes | CommandHandlerTable;

export interface CommandHandlerTable extends CommandDescriptorTable {
    description: string;
    commands: Record<string, CommandTypes>;
    defaultSubCommand?: CommandHandlerTypes | undefined;
}

export function isCommandDescriptorTable(
    entry: CommandDescriptors,
): entry is CommandDescriptorTable {
    return (entry as CommandDescriptorTable).commands !== undefined;
}

export function getCommandInterface(
    handlers: CommandTypes,
): AppAgentCommandInterface {
    return {
        getCommands: async () => handlers,
        executeCommand: async (
            commands: string[],
            args: string,
            context: ActionContext<unknown>,
            attachments?: string[],
        ) => {
            let curr: CommandTypes = handlers;
            const commandPrefix: string[] = [];

            while (true) {
                const currCommand = commands.shift();
                if (currCommand === undefined) {
                    break;
                }
                commandPrefix.push(currCommand);
                if (!isCommandDescriptorTable(curr)) {
                    break;
                }
                const next: CommandTypes | undefined =
                    curr.commands[currCommand];
                if (next === undefined) {
                    throw new Error(
                        `Unknown command '${currCommand}' in '@${commandPrefix.join(" ")}'`,
                    );
                }
                curr = next;
            }

            if (isCommandDescriptorTable(curr)) {
                if (curr.defaultSubCommand === undefined) {
                    throw new Error(
                        `Command '@${commandPrefix.join(" ")}' requires a subcommand`,
                    );
                }
                curr = curr.defaultSubCommand;
            }
            if (curr.parameters === undefined) {
                if (args.trim() !== "") {
                    throw new Error(
                        `No parameters expected for command '@${commandPrefix.join(" ")}'`,
                    );
                }
                await curr.run(context, undefined, attachments);
            } else {
                await curr.run(context, args, attachments);
            }
        },
    };
}

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
import { parseParams, ParsedCommandParams } from "./parameterHelpers.js";

export {
    splitParams,
    ParsedCommandParams,
    resolveFlag,
    getFlagMultiple,
    getFlagType,
} from "./parameterHelpers.js";

export type CommandHandlerNoParams = CommandDescriptor & {
    parameters?: undefined | false;
    run(
        context: ActionContext<unknown>,
        params: undefined,
        attachments?: string[],
    ): Promise<void>;
};

export type CommandHandlerNoParse = CommandDescriptor & {
    parameters: true;
    run(
        context: ActionContext<unknown>,
        params: string,
        attachments?: string[],
    ): Promise<void>;
};

export type CommandHandler = CommandDescriptor & {
    parameters: ParameterDefinitions;
    run(
        context: ActionContext<unknown>,
        params: ParsedCommandParams<ParameterDefinitions>,
        attachments?: string[],
    ): Promise<void>;
};

type CommandHandlerTypes =
    | CommandHandlerNoParams
    | CommandHandlerNoParse
    | CommandHandler;

function isCommandHandlerNoParams(
    handler: CommandHandlerTypes,
): handler is CommandHandlerNoParams {
    return handler.parameters === undefined || handler.parameters === false;
}

function isCommandHandlerNoParse(
    handler: CommandHandlerTypes,
): handler is CommandHandlerNoParse {
    return handler.parameters === true;
}

type CommandDefinitions = CommandHandlerTypes | CommandHandlerTable;

export interface CommandHandlerTable extends CommandDescriptorTable {
    description: string;
    commands: Record<string, CommandDefinitions>;
    defaultSubCommand?: CommandHandlerTypes | undefined;
}

export function isCommandDescriptorTable(
    entry: CommandDescriptors,
): entry is CommandDescriptorTable {
    return (entry as CommandDescriptorTable).commands !== undefined;
}

export function getCommandInterface(
    handlers: CommandDefinitions,
): AppAgentCommandInterface {
    return {
        getCommands: async () => handlers,
        executeCommand: async (
            commands: string[],
            args: string,
            context: ActionContext<unknown>,
            attachments?: string[],
        ) => {
            let curr: CommandDefinitions = handlers;
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
                const next: CommandDefinitions | undefined =
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
            if (isCommandHandlerNoParams(curr)) {
                if (args.trim() !== "") {
                    throw new Error(
                        `No parameters expected for command '@${commandPrefix.join(" ")}'`,
                    );
                }
                await curr.run(context, undefined, attachments);
            } else if (isCommandHandlerNoParse(curr)) {
                await curr.run(context, args, attachments);
            } else {
                await curr.run(
                    context,
                    parseParams(args, curr.parameters),
                    attachments,
                );
            }
        },
    };
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, SessionContext } from "../agentInterface.js";
import {
    AppAgentCommandInterface,
    CommandDescriptor,
    CommandDescriptors,
    CommandDescriptorTable,
} from "../command.js";
import {
    ParameterDefinitions,
    ParsedCommandParams,
    PartialParsedCommandParams,
} from "../parameters.js";

export {
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
    getCompletion?: undefined;
};

export type CommandHandler = CommandDescriptor & {
    parameters: ParameterDefinitions;
    run(
        context: ActionContext<unknown>,
        params: ParsedCommandParams<ParameterDefinitions>,
        attachments?: string[],
    ): Promise<void>;
    getCompletion?(
        context: SessionContext<unknown>,
        params: PartialParsedCommandParams<ParameterDefinitions>,
        name: string,
    ): Promise<string[] | undefined>;
};

type CommandHandlerTypes = CommandHandlerNoParams | CommandHandler;

function isCommandHandlerNoParams(
    handler: CommandHandlerTypes,
): handler is CommandHandlerNoParams {
    return handler.parameters === undefined || handler.parameters === false;
}

type CommandDefinitions = CommandHandlerTypes | CommandHandlerTable;

export interface CommandHandlerTable extends CommandDescriptorTable {
    description: string;
    commands: Record<string, CommandDefinitions>;
    defaultSubCommand?: CommandHandlerTypes | undefined;
}

function hasCompletion(handlers: CommandDefinitions): boolean {
    if (isCommandDescriptorTable(handlers)) {
        return (
            (handlers.defaultSubCommand !== undefined &&
                hasCompletion(handlers.defaultSubCommand)) ||
            Object.values(handlers.commands).some(hasCompletion)
        );
    }
    return handlers.getCompletion !== undefined;
}

export function isCommandDescriptorTable(
    entry: CommandDescriptors,
): entry is CommandDescriptorTable {
    return (entry as CommandDescriptorTable).commands !== undefined;
}

function getCommandHandler(
    handlers: CommandDefinitions,
    commands: string[],
): CommandHandlerTypes {
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
        const next: CommandDefinitions | undefined = curr.commands[currCommand];
        if (next === undefined) {
            throw new Error(
                `Unknown command '${currCommand}' in '@${commandPrefix.join(" ")}'`,
            );
        }
        curr = next;
    }

    if (commands.length !== 0) {
        throw new Error(
            `Unknown subcommand '${commands.join(" ")}' in '@${commandPrefix.join(" ")}'`,
        );
    }

    if (isCommandDescriptorTable(curr)) {
        if (curr.defaultSubCommand === undefined) {
            throw new Error(
                `Command '@${commandPrefix.join(" ")}' requires a subcommand`,
            );
        }
        curr = curr.defaultSubCommand;
    }

    return curr;
}
export function getCommandInterface(
    handlers: CommandDefinitions,
): AppAgentCommandInterface {
    const commandInterface: AppAgentCommandInterface = {
        getCommands: async () => handlers,
        executeCommand: async (
            commands: string[],
            params: ParsedCommandParams<ParameterDefinitions> | undefined,
            context: ActionContext<unknown>,
            attachments?: string[],
        ) => {
            const handler = getCommandHandler(handlers, commands);

            if (isCommandHandlerNoParams(handler)) {
                if (params !== undefined) {
                    throw new Error(
                        `Command '@${commands.join(" ")}' does not accept parameters`,
                    );
                }
                await handler.run(context, undefined, attachments);
                return;
            } else {
                if (params === undefined) {
                    throw new Error(
                        `Command '@${commands.join(" ")}' expects parameters`,
                    );
                }
                await handler.run(context, params, attachments);
            }
        },
    };

    if (hasCompletion(handlers)) {
        commandInterface.getCommandCompletion = async (
            commands: string[],
            params: ParsedCommandParams<ParameterDefinitions>,
            name: string,
            context: SessionContext<unknown>,
        ) => {
            const handler = getCommandHandler(handlers, commands);
            return handler.getCompletion?.(context, params, name);
        };
    }
    return commandInterface;
}

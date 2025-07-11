// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, SessionContext } from "../agentInterface.js";
import {
    AppAgentCommandInterface,
    CommandDescriptor,
    CommandDescriptors,
    CommandDescriptorTable,
    CompletionGroup,
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
        names: string[],
    ): Promise<CompletionGroup[]>;
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
    defaultSubCommand?: CommandHandlerTypes | string | undefined;
}

function getDefaultSubCommand(
    table: CommandHandlerTable,
): CommandHandlerTypes | undefined {
    if (typeof table.defaultSubCommand === "string") {
        const defaultSubCommand = table.commands[table.defaultSubCommand];
        if (
            defaultSubCommand !== undefined &&
            isCommandDescriptorTable(defaultSubCommand)
        ) {
            return undefined;
        }
        return defaultSubCommand;
    }
    return table.defaultSubCommand;
}

function hasCompletion(handlers: CommandDefinitions): boolean {
    if (isCommandDescriptorTable(handlers)) {
        const defaultSubCommand = getDefaultSubCommand(handlers);
        return (
            (defaultSubCommand !== undefined &&
                hasCompletion(defaultSubCommand)) ||
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

    for (const command of commands) {
        commandPrefix.push(command);
        if (!isCommandDescriptorTable(curr)) {
            throw new Error(
                `Unknown subcommand '${commands.join(" ")}' in '@${commandPrefix.join(" ")}'`,
            );
        }
        const next: CommandDefinitions | undefined = curr.commands[command];
        if (next === undefined) {
            throw new Error(
                `Unknown command '${command}' in '@${commandPrefix.join(" ")}'`,
            );
        }
        curr = next;
    }

    if (!isCommandDescriptorTable(curr)) {
        return curr;
    }

    const defaultSubCommand = getDefaultSubCommand(curr);
    if (defaultSubCommand === undefined) {
        throw new Error(
            `Command '@${commandPrefix.join(" ")}' requires a subcommand`,
        );
    }
    return defaultSubCommand;
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
            names: string[],
            context: SessionContext<unknown>,
        ) => {
            const handler = getCommandHandler(handlers, commands);
            return handler.getCompletion?.(context, params, names) ?? [];
        };
    }
    return commandInterface;
}

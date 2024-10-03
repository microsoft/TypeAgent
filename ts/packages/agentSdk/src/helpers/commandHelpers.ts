// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext } from "../agentInterface.js";
import {
    AppAgentCommandInterface,
    CommandDescriptor,
    CommandDescriptors,
    CommandDescriptorTable,
} from "../command.js";

export { parseCommandArgs, resolveFlag } from "./parameterHelpers.js";

export interface CommandHandler extends CommandDescriptor {
    run(
        context: ActionContext<unknown>,
        request: string,
        attachments?: string[],
    ): Promise<void>;
}

export interface CommandHandlerTable extends CommandDescriptorTable {
    description: string;
    commands: Record<string, CommandHandler | CommandHandlerTable>;
    defaultSubCommand?: CommandHandler | undefined;
}

export function isCommandDescriptorTable(
    entry: CommandDescriptors,
): entry is CommandDescriptorTable {
    return (entry as CommandDescriptorTable).commands !== undefined;
}

export function getCommandInterface(
    handlers: CommandHandler | CommandHandlerTable,
): AppAgentCommandInterface {
    return {
        getCommands: async () => handlers,
        executeCommand: async (
            commands: string[],
            args: string,
            context: ActionContext<unknown>,
            attachments?: string[],
        ) => {
            let curr: CommandHandlerTable | CommandHandler = handlers;
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
                const next: CommandHandlerTable | CommandHandler | undefined =
                    curr.commands[currCommand];
                if (next === undefined) {
                    throw new Error(
                        `Unknown command '${currCommand}' in '${commandPrefix.join(" ")}'`,
                    );
                }
                curr = next;
            }

            if (isCommandDescriptorTable(curr)) {
                if (curr.defaultSubCommand === undefined) {
                    throw new Error(
                        `Command '${commandPrefix.join(" ")}' requires a subcommand`,
                    );
                }
                curr = curr.defaultSubCommand;
            }
            await curr.run(context, args, attachments);
        },
    };
}

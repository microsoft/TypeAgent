// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import {
    AppAgent,
    AppAction,
    ActionContext,
    CommandDescriptorTable,
} from "@typeagent/agent-sdk";
import { isCommandDescriptorTable } from "@typeagent/agent-sdk/helpers/commands";
import { executeSessionAction } from "../action/system/sessionActionHandler.js";
import { executeConfigAction } from "../action/system/configActionHandler.js";
import { CommandHandlerContext } from "../handlers/common/commandHandlerContext.js";
import { getConfigCommandHandlers } from "../handlers/configCommandHandlers.js";
import { getConstructionCommandHandlers } from "../handlers/constructionCommandHandlers.js";
import { CorrectCommandHandler } from "../handlers/correctCommandHandler.js";
import { DebugCommandHandler } from "../handlers/debugCommandHandlers.js";
import { ExplainCommandHandler } from "../handlers/explainCommandHandler.js";
import { getSessionCommandHandlers } from "../handlers/sessionCommandHandlers.js";
import { getHistoryCommandHandlers } from "../handlers/historyCommandHandler.js";
import { TraceCommandHandler } from "../handlers/traceCommandHandler.js";
import { TranslateCommandHandler } from "../handlers/translateCommandHandler.js";
/* ==Experimental== */
import { getRandomCommandHandlers } from "../handlers/randomCommandHandler.js";
import { getShellCommandHandlers } from "../handlers/shellCommandHandler.js";
import { getNotifyCommandHandlers } from "../handlers/notifyCommandHandler.js";
import {
    DispatcherCommandHandler,
    DispatcherHandlerTable,
} from "../handlers/common/commandHandler.js";
import { processRequests } from "../utils/interactive.js";
import { getConsoleRequestIO } from "../handlers/common/interactiveIO.js";
import { getPrompt, processCommandNoLock, resolveCommand } from "../command.js";
import { RequestCommandHandler } from "../handlers/requestCommandHandler.js";
/* ==End Experimental== */

export function loadInlineAgent(
    name: string,
    context: CommandHandlerContext,
): AppAgent {
    const handlers = inlineHandlers[name];
    if (handlers === undefined) {
        throw new Error(`Invalid inline agent name: ${name}`);
    }
    return { ...handlers, initializeAgentContext: async () => context };
}

const inlineHandlers: { [key: string]: AppAgent } = {
    system: {
        executeAction: executeSystemAction,
        getCommands: async () => handlers,
        executeCommand: executeSystemCommand,
    },
};

function executeSystemAction(
    action: AppAction,
    context: ActionContext<CommandHandlerContext>,
) {
    switch (action.translatorName) {
        case "system.session":
            return executeSessionAction(action, context);
        case "system.config":
            return executeConfigAction(action, context);
    }

    throw new Error(`Invalid system sub-translator: ${action.translatorName}`);
}

class HelpCommandHandler implements DispatcherCommandHandler {
    public readonly description = "Show help";
    public async run(request: string, context: CommandHandlerContext) {
        const printHandleTable = (
            table: CommandDescriptorTable,
            command: string,
        ) => {
            context.requestIO.result((log: (message?: string) => void) => {
                log(`${table.description}`);
                log();
                if (command) {
                    log(`Usage: @${command} <subcommand> ...`);
                    log("Subcommands:");
                } else {
                    log("Usage: @<command> ...");
                    log("Commands:");
                    log(`  @<agentName> <subcommand>: command for 'agentName'`);
                }

                for (const name in table.commands) {
                    const handler = table.commands[name];
                    const subcommand = isCommandDescriptorTable(handler)
                        ? `${name} <subcommand>`
                        : name;
                    log(`  ${subcommand.padEnd(20)}: ${handler.description}`);
                }
            });
        };
        if (request === "") {
            printHandleTable(handlers, "");
        } else {
            const result = await resolveCommand(request, context, false);
            if (result === undefined) {
                throw new Error(`Unknown command '${request}'`);
            }

            if (result.descriptor !== undefined) {
                if (result.descriptor.help) {
                    context.requestIO.result(result.descriptor.help);
                } else {
                    context.requestIO.result(
                        `${result.command?.join(" ") ?? ""} - ${result.descriptor.description}`,
                    );
                }
            } else {
                printHandleTable(
                    result.table!,
                    result.command?.join(" ") ?? "",
                );
            }
        }
    }
}

class RunCommandScriptHandler implements DispatcherCommandHandler {
    public readonly description = "Run a command script file";
    public async run(input: string, context: CommandHandlerContext) {
        const prevScriptDir = context.currentScriptDir;
        const inputFile = path.resolve(prevScriptDir, input);
        const content = await fs.promises.readFile(inputFile, "utf8");
        const inputs = content.split(/\r?\n/);
        const prevRequestIO = context.requestIO;
        try {
            // handle nested @run in files
            context.currentScriptDir = path.parse(inputFile).dir;

            // Disable confirmation in file mode
            context.requestIO = getConsoleRequestIO(undefined);

            // Process the commands in the file.
            await processRequests(
                getPrompt,
                inputs,
                processCommandNoLock,
                context,
            );
        } finally {
            // Restore state
            context.requestIO = prevRequestIO;
            context.currentScriptDir = prevScriptDir;
        }
    }
}

const handlers: DispatcherHandlerTable = {
    description: "Agent Dispatcher System Commands",
    commands: {
        request: new RequestCommandHandler(),
        translate: new TranslateCommandHandler(),
        explain: new ExplainCommandHandler(),
        correct: new CorrectCommandHandler(),
        session: getSessionCommandHandlers(),
        history: getHistoryCommandHandlers(),
        const: getConstructionCommandHandlers(),
        config: getConfigCommandHandlers(),
        trace: new TraceCommandHandler(),
        help: new HelpCommandHandler(),
        debug: new DebugCommandHandler(),
        clear: {
            description: "Clear the console",
            async run(request: string, context: CommandHandlerContext) {
                context.requestIO.clear();
            },
        },
        run: new RunCommandScriptHandler(),
        exit: {
            description: "Exit the program",
            async run(request: string, context: CommandHandlerContext) {
                context.clientIO ? context.clientIO.exit() : process.exit(0);
            },
        },
        random: getRandomCommandHandlers(),
        shell: getShellCommandHandlers(),
        notify: getNotifyCommandHandlers(),
    },
};

async function executeSystemCommand(
    command: string[] | undefined,
    args: string,
    context: ActionContext<CommandHandlerContext>,
    attachments?: string[],
): Promise<void> {
    let curr: DispatcherHandlerTable | DispatcherCommandHandler = handlers;
    const commandPrefix: string[] = [];
    if (command) {
        while (true) {
            const currCommand = command.shift();
            if (currCommand === undefined) {
                break;
            }
            commandPrefix.push(currCommand);
            if (!isCommandDescriptorTable(curr)) {
                break;
            }
            const next:
                | DispatcherHandlerTable
                | DispatcherCommandHandler
                | undefined = curr.commands[currCommand];
            if (next === undefined) {
                throw new Error(
                    `Unknown command '${currCommand}' in '${commandPrefix.join(" ")}'`,
                );
            }
            curr = next;
        }
    }
    if (isCommandDescriptorTable(curr)) {
        if (curr.defaultSubCommand === undefined) {
            throw new Error(
                `Command '${commandPrefix.join(" ")}' requires a subcommand`,
            );
        }
        curr = curr.defaultSubCommand;
    }
    await curr.run(args, context.sessionContext.agentContext, attachments);
}

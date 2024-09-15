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
import {
    CommandHandler,
    CommandHandlerTable,
    getCommandInterface,
    isCommandDescriptorTable,
} from "@typeagent/agent-sdk/helpers/commands";
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
import { getNotifyCommandHandlers } from "../handlers/notifyCommandHandler.js";
import { processRequests } from "../utils/interactive.js";
import {
    displayResult,
    getConsoleRequestIO,
} from "../handlers/common/interactiveIO.js";
import { getPrompt, processCommandNoLock, resolveCommand } from "../command.js";
import { RequestCommandHandler } from "../handlers/requestCommandHandler.js";
/* ==End Experimental== */

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

class HelpCommandHandler implements CommandHandler {
    public readonly description = "Show help";
    public async run(
        request: string,
        context: ActionContext<CommandHandlerContext>,
    ) {
        const printHandleTable = (
            table: CommandDescriptorTable,
            command?: string,
        ) => {
            displayResult((log: (message?: string) => void) => {
                log(`${table.description}`);
                log();
                if (command) {
                    log(`Usage: @${command} <subcommand> ...`);
                    log("Subcommands:");
                } else {
                    log("Usage: @<command> ...");
                    log("Commands:");

                    if (command === undefined) {
                        log(
                            `  @<agentName> <subcommand>: command for 'agentName'`,
                        );
                    }
                }

                for (const name in table.commands) {
                    const handler = table.commands[name];
                    const subcommand = isCommandDescriptorTable(handler)
                        ? `${name} <subcommand>`
                        : name;
                    log(`  ${subcommand.padEnd(20)}: ${handler.description}`);
                }
            }, context);
        };
        if (request === "") {
            printHandleTable(systemHandlers, undefined);
        } else {
            const result = await resolveCommand(
                request,
                context.sessionContext.agentContext,
                false,
            );
            if (result === undefined) {
                throw new Error(`Unknown command '${request}'`);
            }

            if (result.descriptor !== undefined) {
                if (result.descriptor.help) {
                    displayResult(result.descriptor.help, context);
                } else {
                    displayResult(
                        `${result.command?.join(" ") ?? ""} - ${result.descriptor.description}`,
                        context,
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

class RunCommandScriptHandler implements CommandHandler {
    public readonly description = "Run a command script file";
    public async run(
        input: string,
        context: ActionContext<CommandHandlerContext>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const prevScriptDir = systemContext.currentScriptDir;
        const inputFile = path.resolve(prevScriptDir, input);
        const content = await fs.promises.readFile(inputFile, "utf8");
        const inputs = content.split(/\r?\n/);
        const prevRequestIO = systemContext.requestIO;
        try {
            // handle nested @run in files
            systemContext.currentScriptDir = path.parse(inputFile).dir;

            // Disable confirmation in file mode
            systemContext.requestIO = getConsoleRequestIO(undefined);

            // Process the commands in the file.
            await processRequests(
                getPrompt,
                inputs,
                processCommandNoLock,
                systemContext,
            );
        } finally {
            // Restore state
            systemContext.requestIO = prevRequestIO;
            systemContext.currentScriptDir = prevScriptDir;
        }
    }
}

const dispatcherHandlers: CommandHandlerTable = {
    description: "Type Agent Dispatcher Commands",
    commands: {
        request: new RequestCommandHandler(),
        translate: new TranslateCommandHandler(),
        explain: new ExplainCommandHandler(),
        correct: new CorrectCommandHandler(),
    },
};

const systemHandlers: CommandHandlerTable = {
    description: "Type Agent System Commands",
    commands: {
        session: getSessionCommandHandlers(),
        history: getHistoryCommandHandlers(),
        const: getConstructionCommandHandlers(),
        config: getConfigCommandHandlers(),
        trace: new TraceCommandHandler(),
        help: new HelpCommandHandler(),
        debug: new DebugCommandHandler(),
        clear: {
            description: "Clear the console",
            async run(
                request: string,
                context: ActionContext<CommandHandlerContext>,
            ) {
                context.sessionContext.agentContext.requestIO.clear();
            },
        },
        run: new RunCommandScriptHandler(),
        exit: {
            description: "Exit the program",
            async run(
                request: string,
                context: ActionContext<CommandHandlerContext>,
            ) {
                const systemContext = context.sessionContext.agentContext;
                systemContext.clientIO
                    ? systemContext.clientIO.exit()
                    : process.exit(0);
            },
        },
        random: getRandomCommandHandlers(),
        notify: getNotifyCommandHandlers(),
    },
};

const inlineHandlers: { [key: string]: AppAgent } = {
    dispatcher: {
        ...getCommandInterface(dispatcherHandlers),
    },
    system: {
        executeAction: executeSystemAction,
        ...getCommandInterface(systemHandlers),
    },
};

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

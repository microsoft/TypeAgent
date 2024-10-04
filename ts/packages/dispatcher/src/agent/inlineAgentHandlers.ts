// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import {
    AppAgent,
    AppAction,
    ActionContext,
    CommandDescriptorTable,
    CommandDescriptor,
} from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerNoParse,
    CommandHandlerTable,
    getCommandInterface,
    isCommandDescriptorTable,
    ParsedCommandParams,
} from "@typeagent/agent-sdk/helpers/command";
import { displayResult } from "@typeagent/agent-sdk/helpers/display";
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
import { getRandomCommandHandlers } from "../handlers/randomCommandHandler.js";
import { getNotifyCommandHandlers } from "../handlers/notifyCommandHandler.js";
import { processRequests } from "../utils/interactive.js";
import { getConsoleRequestIO } from "../handlers/common/interactiveIO.js";
import { getPrompt, processCommandNoLock, resolveCommand } from "../command.js";
import { RequestCommandHandler } from "../handlers/requestCommandHandler.js";
import { DisplayCommandHandler } from "../handlers/displayCommandHandler.js";
import chalk from "chalk";

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

function printUsage(
    command: string[] | undefined,
    descriptor: CommandDescriptor,
    context: ActionContext<CommandHandlerContext>,
) {
    if (descriptor.help) {
        displayResult(descriptor.help, context);
        return;
    }

    const commandUsage = `@${command?.join(" ") ?? ""}`;
    const paramUsage: string[] = [];
    const paramUsageFull: string[] = [];
    if (typeof descriptor.parameters === "object") {
        if (descriptor.parameters.args) {
            const args = Object.entries(descriptor.parameters.args);
            if (args.length !== 0) {
                paramUsageFull.push(`Arguments:`);
                for (const [name, def] of args) {
                    const usage = `<${name}>${def.multiple === true ? "..." : ""}`;
                    paramUsage.push(def.optional ? `[${usage}]` : usage);
                    paramUsageFull.push(
                        `  ${`<${name}>`.padEnd(10)}: ${def.optional ? "(optional) " : ""}${def.description} (type: ${def.type ?? "string"})`,
                    );
                }
            }
        }
        if (descriptor.parameters.flags) {
            const flags = Object.entries(descriptor.parameters.flags);
            if (flags.length !== 0) {
                paramUsageFull.push(`Flags:`);
                for (const [name, def] of flags) {
                    const usage = `--${name}`;
                    paramUsageFull.push(`  ${usage}`);
                }
            }
        }
    }
    displayResult((log: (message?: string) => void) => {
        log(`${commandUsage} - ${descriptor.description}`);
        log();
        log(`Usage: ${commandUsage} ${paramUsage.join(" ")}`);
        if (paramUsageFull.length !== 0) {
            log();
            log(paramUsageFull.join("\n"));
        }
    }, context);
}

class HelpCommandHandler implements CommandHandlerNoParse {
    public readonly description = "Show help";
    public readonly parameters = true;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        request: string,
    ) {
        const printHandleTable = (
            table: CommandDescriptorTable,
            command: string | undefined,
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
            );

            if (result.descriptor !== undefined) {
                printUsage(result.command, result.descriptor, context);
            } else {
                if (result.table === undefined) {
                    throw new Error(`Unknown command '${request}'`);
                }
                const command = result.command.join(" ");
                if (result.args.length === 0) {
                    printHandleTable(result.table, command);
                } else {
                    const subCommand =
                        command === ""
                            ? "command of"
                            : `subcommand of '${result.command.join(" ")}' in`;
                    throw new Error(
                        `'${result.args[0]}' is not a ${subCommand} app agent '${result.appAgentName}'`,
                    );
                }
            }
        }
    }
}

class RunCommandScriptHandler implements CommandHandler {
    public readonly description = "Run a command script file";
    public readonly parameters = {
        args: {
            input: {
                description: "command script file path",
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const prevScriptDir = systemContext.currentScriptDir;
        const inputFile = path.resolve(prevScriptDir, params.args.input);
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
        display: new DisplayCommandHandler(),
        trace: new TraceCommandHandler(),
        help: new HelpCommandHandler(),
        debug: new DebugCommandHandler(),
        clear: {
            description: "Clear the console",
            async run(context: ActionContext<CommandHandlerContext>) {
                context.sessionContext.agentContext.requestIO.clear();
            },
        },
        run: new RunCommandScriptHandler(),
        exit: {
            description: "Exit the program",
            async run(context: ActionContext<CommandHandlerContext>) {
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

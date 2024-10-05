// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path, { toNamespacedPath } from "node:path";
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
    getFlagType,
    isCommandDescriptorTable,
    ParsedCommandParams,
} from "@typeagent/agent-sdk/helpers/command";
import {
    displayError,
    displayResult,
} from "@typeagent/agent-sdk/helpers/display";
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
import {
    getParsedCommand,
    getPrompt,
    processCommandNoLock,
    resolveCommand,
} from "../command.js";
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
    command: string,
    descriptor: CommandDescriptor,
    context: ActionContext<CommandHandlerContext>,
) {
    if (descriptor.help) {
        displayResult(descriptor.help, context);
        return;
    }

    const paramUsage: string[] = [];
    const paramUsageFull: string[] = [];
    if (typeof descriptor.parameters === "object") {
        if (descriptor.parameters.args) {
            const args = Object.entries(descriptor.parameters.args);
            if (args.length !== 0) {
                paramUsageFull.push(chalk.bold(`Arguments:`));
                const maxNameLength = Math.max(
                    ...args.map(([name]) => name.length),
                );
                for (const [name, def] of args) {
                    const usage = `<${name}>${def.multiple === true ? "..." : ""}`;
                    paramUsage.push(def.optional ? `[${usage}]` : usage);
                    paramUsageFull.push(
                        `  ${`<${name}>`.padStart(maxNameLength)} - ${def.optional ? "(optional) " : ""}${def.description} (type: ${def.type ?? "string"})`,
                    );
                }
            }
        }
        if (descriptor.parameters.flags) {
            const flags = Object.entries(descriptor.parameters.flags);
            if (flags.length !== 0) {
                paramUsageFull.push(chalk.bold(`Flags:`));
                const maxNameLength = Math.max(
                    ...flags.map(([name]) => name.length),
                );
                for (const [name, def] of flags) {
                    const type = getFlagType(def);
                    const usage = `[${def.char ? `-${def.char}|` : ""}--${name}${type === "boolean" ? "" : ` <${type}>`}]`;
                    paramUsage.unshift(usage);
                    paramUsageFull.push(
                        `  ${`--${name}`.padStart(maxNameLength)} ${def.char !== undefined ? `-${def.char}` : "  "} : ${def.description}${def.default !== undefined ? ` (default: ${def.default})` : ""}`,
                    );
                }
            }
        }
    } else if (descriptor.parameters === true) {
        paramUsage.push("<parameters> ...");
    }
    displayResult((log: (message?: string) => void) => {
        log(`@${chalk.bold(command)} - ${descriptor.description}`);
        log();
        log(`${chalk.bold("Usage")}: @${command} ${paramUsage.join(" ")}`);
        if (paramUsageFull.length !== 0) {
            log();
            log(paramUsageFull.join("\n"));
        }
    }, context);
}

class HelpCommandHandler implements CommandHandler {
    public readonly description = "Show help";
    public readonly parameters = {
        args: {
            command: {
                description: "command to get help for",
                implicitQuotes: true,
                optional: true,
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const printHandleTable = (
            table: CommandDescriptorTable,
            command: string | undefined,
        ) => {
            displayResult((log: (message?: string) => void) => {
                log(`${chalk.bold(chalk.underline(table.description))}`);
                log();
                if (command) {
                    log(`${chalk.bold("Usage")}: @${command} <subcommand> ...`);
                    log();
                    log(`${chalk.bold("<subcommand>:")}`);
                } else {
                    log(
                        `${chalk.bold("Usage")}: @[<agentName>] <subcommand> ...`,
                    );
                    log();
                    log(`${chalk.bold("<agentNames>:")} (default to 'system')`);
                    const names = systemContext.agents.getAppAgentNames();
                    const maxNameLength = Math.max(
                        ...names.map((name) => name.length),
                    );
                    for (const name of systemContext.agents.getAppAgentNames()) {
                        if (systemContext.agents.isCommandEnabled(name)) {
                            log(
                                `  ${name.padEnd(maxNameLength)} : ${systemContext.agents.getAppAgentDescription(name)}`,
                            );
                        }
                    }
                    log();
                    log(`${chalk.bold("<subcommand>")} ('system')`);
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
        if (params.args.command === undefined) {
            printHandleTable(systemHandlers, undefined);
        } else {
            const result = await resolveCommand(
                params.args.command,
                systemContext,
            );

            const command = getParsedCommand(result);
            if (result.descriptor !== undefined) {
                printUsage(command, result.descriptor, context);
            } else {
                if (result.table === undefined) {
                    throw new Error(`Unknown command '${params.args.command}'`);
                }
                if (result.suffix.length !== 0) {
                    displayError(
                        `ERROR: '${result.suffix}' is not a subcommand for '@${command}'`,
                        context,
                    );
                }
                printHandleTable(result.table, command);
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

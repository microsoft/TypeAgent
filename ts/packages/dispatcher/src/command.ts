// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import chalk from "chalk";
import registerDebug from "debug";
import fs from "node:fs";
import path from "node:path";
import {
    RequestId,
    getConsoleRequestIO,
    getRequestIO,
} from "./handlers/common/interactiveIO.js";
import { getDefaultExplainerName } from "agent-cache";
import {
    CommandHandler,
    HandlerTable,
} from "./handlers/common/commandHandler.js";
import { CommandHandlerContext } from "./handlers/common/commandHandlerContext.js";
import { getConfigCommandHandlers } from "./handlers/configCommandHandlers.js";
import { getConstructionCommandHandlers } from "./handlers/constructionCommandHandlers.js";
import { CorrectCommandHandler } from "./handlers/correctCommandHandler.js";
import { DebugCommandHandler } from "./handlers/debugCommandHandlers.js";
import { ExplainCommandHandler } from "./handlers/explainCommandHandler.js";
import { RequestCommandHandler } from "./handlers/requestCommandHandler.js";
import { getSessionCommandHandlers } from "./handlers/sessionCommandHandlers.js";
import { getHistoryCommandHandlers } from "./handlers/historyCommandHandler.js";
import { TraceCommandHandler } from "./handlers/traceCommandHandler.js";
import { TranslateCommandHandler } from "./handlers/translateCommandHandler.js";
import { getTranslatorConfig } from "./translation/agentTranslators.js";
import { processRequests, unicodeChar } from "./utils/interactive.js";
/* ==Experimental== */
import { getRandomCommandHandlers } from "./handlers/randomCommandHandler.js";
/* ==End Experimental== */

class HelpCommandHandler implements CommandHandler {
    public readonly description = "Show help";
    public async run(request: string, context: CommandHandlerContext) {
        const printHandleTable = (handlers: HandlerTable, command: string) => {
            context.requestIO.result((log: (message?: string) => void) => {
                log(`${handlers.description}`);
                log();
                if (command) {
                    log(`Usage: @${command} <subcommand> ...`);
                    log("Subcommands:");
                } else {
                    log("Usage: @<command> ...");
                    log("Commands:");
                }

                for (const name in handlers.commands) {
                    const handler = handlers.commands[name];
                    const subcommand = isCommandHandler(handler)
                        ? name
                        : `${name} <subcommand>`;
                    log(`  ${subcommand.padEnd(20)}: ${handler.description}`);
                }
            });
        };
        if (request === "") {
            printHandleTable(handlers, "");
        } else {
            const result = resolveCommand(request, true);
            if (result === undefined) {
                throw new Error(`Unknown command '${request}'`);
            }

            if (isCommandHandler(result.resolved)) {
                if (result.resolved.help) {
                    context.requestIO.result(result.resolved.help);
                } else {
                    context.requestIO.result(
                        `${result.command} - ${result.resolved.description}`,
                    );
                }
            } else {
                printHandleTable(result.resolved, result.command);
            }
        }
    }
}

class RunCommandScriptHandler implements CommandHandler {
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

const debugInteractive = registerDebug("typeagent:cli:interactive");

const handlers: HandlerTable = {
    description: "Agent Dispatcher Commands",
    defaultSubCommand: undefined,
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
    },
};

function isCommandHandler(
    entry: CommandHandler | HandlerTable,
): entry is CommandHandler {
    return typeof (entry as CommandHandler).run === "function";
}

type ResolveCommandResult = {
    resolved: CommandHandler | HandlerTable;
    args: string;
    command: string;
};
function resolveCommand(
    input: string,
    isHelpCommand: boolean = false,
): ResolveCommandResult | undefined {
    let command: string = "";
    let currentHandlers = handlers;
    const args = input.split(/\s/).filter((s) => s !== "");
    while (true) {
        const subCommand = args.shift();
        if (subCommand === undefined) {
            if (
                currentHandlers.defaultSubCommand != undefined &&
                !isHelpCommand
            ) {
                return {
                    resolved: currentHandlers.defaultSubCommand,
                    args: "",
                    command,
                };
            } else {
                return { resolved: currentHandlers, args: "", command };
            }
        }
        const action = currentHandlers.commands[subCommand];
        if (action === undefined) {
            throw new Error(
                `Unknown command '${subCommand}'. ${
                    command
                        ? ` for '@${command}'. Try '@help ${command}' for the list of subcommands.`
                        : "Try '@help' for a list of commands."
                }`,
            );
        }
        command = command ? `${command} ${subCommand}` : subCommand;
        if (isCommandHandler(action)) {
            return { resolved: action, args: args.join(" "), command };
        }
        currentHandlers = action;
    }
}

export async function processCommandNoLock(
    originalInput: string,
    context: CommandHandlerContext,
    requestId?: RequestId,
) {
    let input = originalInput.trim();
    if (!input.startsWith("@")) {
        // default to request
        input = `request ${input}`;
    } else {
        input = input.substring(1);
    }

    const oldRequestIO = context.requestIO;
    context.requestId = requestId;
    if (context.clientIO) {
        context.requestIO = getRequestIO(context.clientIO, requestId);
    }

    try {
        const result = resolveCommand(input);
        if (result === undefined) {
            throw new Error(`Unknown command '${input}'`);
        }
        if (isCommandHandler(result.resolved)) {
            context.logger?.logEvent("command", { originalInput });
            await result.resolved.run(result.args, context);
        } else {
            throw new Error(
                `Command '${input}' requires a subcommand. Try '@help ${input}' for the list of sub commands.`,
            );
        }
    } catch (e: any) {
        context.requestIO.error(`ERROR: ${e.message}`);
        debugInteractive(e.stack);
    }

    context.requestId = undefined;
    context.requestIO = oldRequestIO;
}

export async function processCommand(
    originalInput: string,
    context: CommandHandlerContext,
    requestId?: RequestId,
) {
    // Process one command at at time.
    return context.commandLock(async () => {
        return processCommandNoLock(originalInput, context, requestId);
    });
}

export function getSettingSummary(context: CommandHandlerContext) {
    const prompt = [];
    if (!context.dblogging) {
        const str = "WARNING: DB LOGGING OFF!!! ";
        prompt.push(context.requestIO.type === "text" ? chalk.red(str) : str);
    }

    if (context.session.bot) {
        prompt.push(unicodeChar.robotFace);
    }
    const constructionStore = context.agentCache.constructionStore;
    if (constructionStore.isEnabled()) {
        prompt.push(unicodeChar.constructionSign);
        if (constructionStore.isAutoSave()) {
            prompt.push(unicodeChar.floppyDisk);
        }
    }

    const names = context.session.useTranslators;
    const ordered = names.filter(
        (name) => name !== context.currentTranslatorName,
    );
    if (ordered.length !== names.length) {
        ordered.unshift(context.currentTranslatorName);
    }

    const translators = Array.from(
        new Set(
            ordered.map((name) => getTranslatorConfig(name).emojiChar),
        ).values(),
    );
    prompt.push("  [", translators.join(""));
    if (context.agentCache.explainerName !== getDefaultExplainerName()) {
        prompt.push(` (explainer: ${context.agentCache.explainerName})`);
    }
    prompt.push("]");

    return prompt.join("");
}

export function getPrompt(context: CommandHandlerContext) {
    return `${getSettingSummary(context)}> `;
}

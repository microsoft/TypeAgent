// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import chalk from "chalk";
import registerDebug from "debug";
import {
    RequestId,
    getRequestIO,
    DispatcherName,
} from "./handlers/common/interactiveIO.js";
import { getDefaultExplainerName } from "agent-cache";
import {
    CommandHandlerContext,
    getActiveTranslatorList,
} from "./handlers/common/commandHandlerContext.js";

import { unicodeChar } from "./utils/interactive.js";
import {
    CommandDescriptor,
    CommandDescriptorTable,
} from "@typeagent/agent-sdk";

import { executeCommand } from "./action/actionHandlers.js";
import { isCommandDescriptorTable } from "@typeagent/agent-sdk/helpers/commands";
import { RequestMetrics } from "./utils/metrics.js";

const debugInteractive = registerDebug("typeagent:cli:interactive");

type ResolveCommandResult = {
    // The resolved app agent name
    appAgentName: string;

    // The resolved commands.
    command: string[];

    // The resolve arguments
    args: string[];

    // The table the resolved commands is in.  Undefined if the app agent has no subcommand. (e.g. @<agent> <args>)
    table: CommandDescriptorTable | undefined;

    // The descriptor of the resolved command.  Undefined if the last command index is not a command in the table.
    descriptor: CommandDescriptor | undefined;
};

export async function resolveCommand(
    input: string,
    context: CommandHandlerContext,
): Promise<ResolveCommandResult> {
    const args: string[] = input.match(/"[^"]+"|\S+/g) ?? [];
    let appAgentName = "system";
    const arg0 = args[0];
    if (arg0 !== undefined && context.agents.isCommandEnabled(arg0)) {
        appAgentName = args.shift()!;
    }
    const appAgent = context.agents.getAppAgent(appAgentName);
    const sessionContext = context.agents.getSessionContext(appAgentName);
    const commands = await appAgent.getCommands?.(sessionContext);
    if (commands === undefined || !isCommandDescriptorTable(commands)) {
        return {
            command: [],
            args,
            appAgentName,
            descriptor: commands ?? { description: "No description available" },
            table: undefined,
        };
    }

    let table = commands;
    let descriptor: CommandDescriptor | undefined;
    const commandPrefix: string[] = [];
    while (true) {
        const subCommand = args.shift();
        if (subCommand === undefined) {
            descriptor = table.defaultSubCommand;
            break;
        }

        const currentTable = table.commands[subCommand];
        if (currentTable === undefined) {
            // Unknown command
            args.unshift(subCommand);
            break;
        }

        commandPrefix.push(subCommand);
        if (!isCommandDescriptorTable(currentTable)) {
            descriptor = currentTable;
            break;
        }
        table = currentTable;
    }

    return {
        command: commandPrefix,
        args,
        appAgentName,
        table,
        descriptor,
    };
}

async function parseCommand(
    originalInput: string,
    context: CommandHandlerContext,
) {
    let input = originalInput.trim();
    if (!input.startsWith("@")) {
        // default to dispatcher request
        input = `dispatcher request ${input}`;
    } else {
        input = input.substring(1);
    }
    const result = await resolveCommand(input, context);
    if (result.descriptor !== undefined) {
        context.logger?.logEvent("command", {
            originalInput,
            appAgentName: result.appAgentName,
            command: result.command,
            args: result.args,
        });
        return result;
    }
    if (result.table !== undefined) {
        throw new Error(
            `Command '${input}' requires a subcommand. Try '@help ${input}' for the list of sub commands.`,
        );
    }
    const subCommand = result.command?.pop();
    const appAgentName = result.appAgentName;
    const command = input.startsWith(`@${appAgentName}`)
        ? `${appAgentName} ${result.command?.join(" ") ?? ""}`
        : result.command?.join(" ") ?? "";
    if (subCommand !== undefined) {
        throw new Error(
            `Unknown command '${subCommand}' ${
                command
                    ? ` for '@${command}'. Try '@help ${command}' for the list of subcommands.`
                    : "Try '@help' for a list of commands."
            }`,
        );
    }
    throw new Error(`Unknown command '${input}'`);
}

export async function processCommandNoLock(
    originalInput: string,
    context: CommandHandlerContext,
    attachments?: string[],
) {
    try {
        const result = await parseCommand(originalInput, context);
        await executeCommand(
            result.command,
            result.args.join(" "),
            result.appAgentName,
            context,
            attachments,
        );
    } catch (e: any) {
        context.requestIO.appendDisplay(
            {
                type: "text",
                content: `ERROR: ${e.message}`,
                kind: "error",
            },
            undefined,
            DispatcherName,
            "block",
        );
        debugInteractive(e.stack);
    }
}

export async function processCommand(
    originalInput: string,
    context: CommandHandlerContext,
    requestId?: RequestId,
    attachments?: string[],
): Promise<RequestMetrics | undefined> {
    // Process one command at at time.
    return context.commandLock(async () => {
        context.requestId = requestId;
        if (requestId) {
            context.commandProfiler =
                context.metricsManager?.beginCommand(requestId);
        }
        const oldRequestIO = context.requestIO;
        try {
            if (context.clientIO) {
                context.requestIO = getRequestIO(context, context.clientIO);
            }

            await processCommandNoLock(originalInput, context, attachments);
        } finally {
            context.commandProfiler?.stop();
            context.commandProfiler = undefined;

            const metrics = requestId
                ? context.metricsManager?.endCommand(requestId)
                : undefined;

            context.requestId = undefined;
            context.requestIO = oldRequestIO;

            return metrics;
        }
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

    const names = getActiveTranslatorList(context);
    const ordered = names.filter(
        (name) => name !== context.lastActionTranslatorName,
    );
    if (ordered.length !== names.length) {
        ordered.unshift(context.lastActionTranslatorName);
    }

    const translators = Array.from(
        new Set(
            ordered.map(
                (name) => context.agents.getTranslatorConfig(name).emojiChar,
            ),
        ).values(),
    );
    prompt.push("  [", translators.join(""));
    if (context.session.getConfig().models.translator !== "") {
        prompt.push(
            ` (model: ${context.session.getConfig().models.translator})`,
        );
    }
    if (context.agentCache.explainerName !== getDefaultExplainerName()) {
        prompt.push(` (explainer: ${context.agentCache.explainerName}`);
        if (context.session.getConfig().models.explainer !== "") {
            prompt.push(
                ` model: ${context.session.getConfig().models.translator}`,
            );
        }
        prompt.push(")");
    } else if (context.session.getConfig().models.explainer !== "") {
        prompt.push(
            ` (explainer model: ${context.session.getConfig().models.explainer})`,
        );
    }

    prompt.push("]");

    return prompt.join("");
}

export function getTranslatorNameToEmojiMap(context: CommandHandlerContext) {
    return new Map<string, string>(Object.entries(context.agents.getEmojis()));
}

export function getPrompt(context: CommandHandlerContext) {
    return `${getSettingSummary(context)}> `;
}

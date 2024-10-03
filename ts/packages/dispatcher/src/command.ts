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
import {
    isCommandDescriptorTable,
    resolveFlag,
} from "@typeagent/agent-sdk/helpers/command";
import { RequestMetrics } from "./utils/metrics.js";
import { PartialCompletionResult } from "./dispatcher/dispatcher.js";

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

        const current = table.commands[subCommand];
        if (current === undefined) {
            // Unknown command
            args.unshift(subCommand);
            break;
        }

        commandPrefix.push(subCommand);
        if (!isCommandDescriptorTable(current)) {
            descriptor = current;
            break;
        }
        table = current;
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

const debugPartialError = registerDebug("typeagent:dispatcher:partial:error");

// Determine the command to resolve for partial completion
// If there is a trailing space, then it will just be the input (minus the @)
// If there is no space, then it will the input without the last word
function getPartialCompletedCommand(input: string) {
    if (!/^\s*@/.test(input)) {
        return undefined;
    }

    if (/\s+$/.test(input)) {
        // There is trailing space, just resolve the whole command
        return { partial: input.trimEnd(), prefix: "" };
    }
    const suffix = input.match(/\s+\S+$/);
    if (suffix === null) {
        // No suffix, resolve the whole command
        return { partial: input.trimEnd(), prefix: "" };
    }
    const split = input.length - suffix[0].length;
    return {
        partial: input.substring(0, split).trimEnd(),
        prefix: input.substring(split).trimStart(),
    };
}

export async function getPartialCompletion(
    input: string,
    context: CommandHandlerContext,
): Promise<PartialCompletionResult | undefined> {
    const partialCompletedCommand = getPartialCompletedCommand(input);

    if (partialCompletedCommand === undefined) {
        // TODO: request completions
        return undefined;
    }

    // Trim spaces and remove leading '@'
    const partialCommand = partialCompletedCommand.partial.trim().substring(1);

    const result = await resolveCommand(partialCommand, context);

    const table = result.table;
    if (table === undefined) {
        // Unknown app agent, or appAgent doesn't support commands
        return undefined;
    }

    let completions: string[] = [];
    const descriptor = result.descriptor;
    if (descriptor !== undefined) {
        if (
            result.args.length === 0 &&
            table?.defaultSubCommand === result.descriptor
        ) {
            // Match the default sub command.  Includes additiona subcommand names
            completions.push(...Object.keys(table.commands));
        }

        const flags = descriptor.parameters?.flags;
        if (flags === undefined) {
            return undefined;
        }

        let flagsNeedsValue = false;
        if (result.args.length !== 0) {
            const lastArg = result.args[result.args.length - 1];
            if (lastArg.startsWith("-")) {
                const def = resolveFlag(flags, lastArg);
                if (def?.type !== "boolean") {
                    flagsNeedsValue = true;
                }
            }
        }
        if (!flagsNeedsValue) {
            for (const [key, value] of Object.entries(flags)) {
                completions.push(`--${key}`);
                if (
                    typeof value === "object" &&
                    !Array.isArray(value) &&
                    value.char !== undefined
                ) {
                    completions.push(`-${value.char}`);
                }
            }
        }
    } else {
        if (result.args.length !== 0) {
            // Unknown command
            return undefined;
        }
        completions.push(...Object.keys(table.commands));

        if (completions.length === 0) {
            // No more completion from the table.
            return undefined;
        }
    }

    return {
        ...partialCompletedCommand,
        space: partialCommand !== "",
        completions,
    };
}

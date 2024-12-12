// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import chalk from "chalk";
import registerDebug from "debug";
import {
    RequestId,
    DispatcherName,
    makeClientIOMessage,
} from "../context/interactiveIO.js";
import { getDefaultExplainerName } from "agent-cache";
import { CommandHandlerContext } from "../context/commandHandlerContext.js";

import {
    CommandDescriptor,
    CommandDescriptors,
    CommandDescriptorTable,
} from "@typeagent/agent-sdk";
import { executeCommand } from "../execute/actionHandlers.js";
import { isCommandDescriptorTable } from "@typeagent/agent-sdk/helpers/command";
import { RequestMetrics } from "../utils/metrics.js";
import { parseParams } from "./parameters.js";
import { getHandlerTableUsage, getUsage } from "./commandHelp.js";

const debugCommand = registerDebug("typeagent:dispatcher:command");
const debugCommandError = registerDebug("typeagent:dispatcher:command:error");

export type ResolveCommandResult = {
    // The resolved app agent name
    parsedAppAgentName: string | undefined;
    actualAppAgentName: string;

    // The resolved commands.
    commands: string[];

    // The resolve arguments
    suffix: string;

    // The table the resolved commands is in.  Undefined if the app agent has no subcommand. (e.g. @<agent> <args>)
    table: CommandDescriptorTable | undefined;

    // The descriptor of the resolved command.  Undefined if the last command index is not a command in the table.
    descriptor: CommandDescriptor | undefined;
};

export function getDefaultSubCommandDescriptor(
    table: CommandDescriptorTable,
): CommandDescriptor | undefined {
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

export async function resolveCommand(
    input: string,
    context: CommandHandlerContext,
): Promise<ResolveCommandResult> {
    let parsedAppAgentName: string | undefined;

    let prev: string | undefined = undefined;
    let curr = input;
    const nextToken = () => {
        const result = curr.match(/^\s*\S+/);
        if (result === null || result.length !== 1) {
            return undefined;
        }

        prev = curr;
        curr = curr.substring(result[0].length);
        return result[0].trim();
    };
    const rollbackToken = () => {
        if (prev === undefined) {
            throw new Error("No previous term to revert to.");
        }
        curr = prev;
        prev = undefined;
    };

    const first = nextToken();
    if (first !== undefined) {
        if (context.agents.isCommandEnabled(first)) {
            parsedAppAgentName = first;
        } else {
            rollbackToken();
        }
    }
    const actualAppAgentName = parsedAppAgentName ?? "system";
    const appAgent = context.agents.getAppAgent(actualAppAgentName);
    const sessionContext = context.agents.getSessionContext(actualAppAgentName);
    const descriptors = await appAgent.getCommands?.(sessionContext);
    const commands: string[] = [];

    let table: CommandDescriptorTable | undefined;
    let descriptor: CommandDescriptor | undefined;
    if (descriptors === undefined || !isCommandDescriptorTable(descriptors)) {
        descriptor = descriptors;
    } else {
        table = descriptors;
        while (true) {
            const subcommand = nextToken();
            if (subcommand === undefined) {
                descriptor = getDefaultSubCommandDescriptor(table);
                break;
            }

            const current: CommandDescriptors = table.commands[subcommand];
            if (current === undefined) {
                // Unknown command
                descriptor = getDefaultSubCommandDescriptor(table);
                rollbackToken();
                break;
            }
            commands.push(subcommand);
            if (!isCommandDescriptorTable(current)) {
                descriptor = current;
                break;
            }
            table = current;
        }

        table = table;
        descriptor = descriptor;
    }

    const result: ResolveCommandResult = {
        parsedAppAgentName,
        actualAppAgentName,
        commands,
        suffix: curr.trim(),
        table,
        descriptor,
    };

    if (debugCommand.enabled) {
        debugCommand(`Resolved command:`, {
            ...result,
            table: result.table !== undefined,
            descriptor: result.descriptor !== undefined,
        });
    }

    return result;
}

async function parseCommand(
    originalInput: string,
    context: CommandHandlerContext,
) {
    let input = originalInput.trim();
    if (!input.startsWith("@")) {
        const requestHandlerAgent = context.session.getConfig().request;
        input = `${requestHandlerAgent} request ${input}`;
    } else {
        input = input.substring(1);
    }
    const result = await resolveCommand(input, context);
    if (result.descriptor !== undefined) {
        context.logger?.logEvent("command", {
            originalInput,
            appAgentName: result.parsedAppAgentName,
            command: result.commands,
            suffix: result.suffix,
        });
        try {
            const params = result.descriptor.parameters
                ? parseParams(result.suffix, result.descriptor.parameters)
                : undefined;
            return {
                appAgentName: result.actualAppAgentName,
                command: result.commands,
                params,
            };
        } catch (e: any) {
            const command = getParsedCommand(result);
            throw new Error(
                `${e.message}\n\n${chalk.black(getUsage(command, result.descriptor))}`,
            );
        }
    }
    const command = getParsedCommand(result);

    if (result.table === undefined) {
        throw new Error(`Unknown command '${input}'`);
    }
    const message =
        result.suffix.length === 0
            ? `@${command}' requires a subcommand.`
            : `'${result.suffix}' is not a subcommand for '@${command}'`;

    throw new Error(
        `${message}\n\n${chalk.black(getHandlerTableUsage(result.table, command, context))}`,
    );
}

export function getParsedCommand(result: ResolveCommandResult) {
    const command = result.commands?.join(" ") ?? "";
    const parsedAgentName = result.parsedAppAgentName;
    return parsedAgentName
        ? command.length !== 0
            ? `${parsedAgentName} ${command}`
            : parsedAgentName
        : command;
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
            result.params,
            result.appAgentName,
            context,
            attachments,
        );
    } catch (e: any) {
        context.clientIO.appendDisplay(
            makeClientIOMessage(
                context,
                {
                    type: "text",
                    content: `ERROR: ${e.message}`,
                    kind: "error",
                },
                context.requestId,
                DispatcherName,
            ),
            "block",
        );
        debugCommandError(e.stack);
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
        try {
            await processCommandNoLock(originalInput, context, attachments);
        } finally {
            context.commandProfiler?.stop();
            context.commandProfiler = undefined;

            const metrics = requestId
                ? context.metricsManager?.endCommand(requestId)
                : undefined;

            context.requestId = undefined;
            return metrics;
        }
    });
}

export const enum unicodeChar {
    wood = "🪵",
    robotFace = "🤖",
    constructionSign = "🚧",
    floppyDisk = "💾",
    stopSign = "🛑",
    convert = "🔄",
}
export function getSettingSummary(context: CommandHandlerContext) {
    if (context.session.getConfig().request !== DispatcherName) {
        const requestAgentName = context.session.getConfig().request;
        return `{{${context.agents.getActionConfig(requestAgentName).emojiChar} ${requestAgentName.toUpperCase()}}}`;
    }
    const prompt: string[] = [unicodeChar.robotFace];

    const names = context.agents.getActiveSchemas();
    const ordered = names.filter(
        (name) => name !== context.lastActionSchemaName,
    );
    if (ordered.length !== names.length) {
        ordered.unshift(context.lastActionSchemaName);
    }

    const translators = Array.from(
        new Set(
            ordered.map(
                (name) => context.agents.getActionConfig(name).emojiChar,
            ),
        ).values(),
    );
    prompt.push(":[", translators.join(""), "]");

    const disabled = [];

    const config = context.session.getConfig();
    if (!config.translation.enabled) {
        disabled.push(unicodeChar.convert);
    }
    const constructionStore = context.agentCache.constructionStore;
    if (!constructionStore.isEnabled()) {
        disabled.push(unicodeChar.constructionSign);
        if (!constructionStore.isAutoSave()) {
            disabled.push(unicodeChar.floppyDisk);
        }
    }

    if (!context.dblogging) {
        disabled.push(unicodeChar.wood);
    }

    if (disabled.length !== 0) {
        prompt.push(" ", unicodeChar.stopSign, ":[", ...disabled, "]");
    }
    const translationModel = config.translation.model;
    if (translationModel !== "") {
        prompt.push(` (model: ${translationModel})`);
    }
    const explainerModel = config.explainer.model;
    if (context.agentCache.explainerName !== getDefaultExplainerName()) {
        prompt.push(` (explainer: ${context.agentCache.explainerName}`);

        if (explainerModel !== "") {
            prompt.push(` model: ${explainerModel}`);
        }
        prompt.push(")");
    } else if (explainerModel !== "") {
        prompt.push(` (explainer model: ${explainerModel})`);
    }

    return prompt.join("");
}

export function getTranslatorNameToEmojiMap(context: CommandHandlerContext) {
    return new Map<string, string>(Object.entries(context.agents.getEmojis()));
}

export function getPrompt(context: CommandHandlerContext) {
    return `${getSettingSummary(context)}> `;
}

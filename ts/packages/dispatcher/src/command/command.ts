// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import chalk from "chalk";
import registerDebug from "debug";
import { makeClientIOMessage, RequestId } from "../context/interactiveIO.js";
import { getDefaultExplainerName } from "agent-cache";
import {
    CommandHandlerContext,
    ensureCommandResult,
    getCommandResult,
} from "../context/commandHandlerContext.js";

import {
    CommandDescriptor,
    CommandDescriptors,
    CommandDescriptorTable,
} from "@typeagent/agent-sdk";
import { executeCommand } from "../execute/actionHandlers.js";
import { isCommandDescriptorTable } from "@typeagent/agent-sdk/helpers/command";
import { parseParams } from "./parameters.js";
import { getHandlerTableUsage, getUsage } from "./commandHelp.js";
import { CommandResult } from "../dispatcher.js";
import { DispatcherName } from "../context/dispatcher/dispatcherUtils.js";
import { getAppAgentName } from "../internal.js";

const debugCommand = registerDebug("typeagent:dispatcher:command");
const debugCommandError = registerDebug("typeagent:dispatcher:command:error");

export type ResolveCommandResult = {
    // the app agent name parsed from the input.
    parsedAppAgentName: string | undefined;

    // The actual app agent name that is resolved.
    actualAppAgentName: string;

    // The resolved commands.
    commands: string[];

    // The resolve arguments
    suffix: string;

    // The table the resolved commands is in.  Undefined if the app agent has no subcommand. (e.g. @<agent> <args>)
    table: CommandDescriptorTable | undefined;

    // The descriptor of the resolved command.  Undefined if the last command index is not a command in the table.
    descriptor: CommandDescriptor | undefined;

    // True if the command is matched to a command descriptor.
    // False if the command is not matched or the we resolved to the default.
    matched: boolean;
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

    const appAgentName =
        first !== undefined && context.agents.isAppAgentName(first)
            ? first
            : undefined;
    let actualAppAgentName: string;
    const useParsedAppAgentName =
        appAgentName !== undefined &&
        context.agents.isCommandEnabled(appAgentName);
    if (useParsedAppAgentName) {
        actualAppAgentName = appAgentName;
    } else {
        actualAppAgentName = "system";
        if (first !== undefined) {
            rollbackToken();
        }
    }

    const appAgent = context.agents.getAppAgent(actualAppAgentName);
    const sessionContext = context.agents.getSessionContext(actualAppAgentName);
    const descriptors = await appAgent.getCommands?.(sessionContext);
    const commands: string[] = [];
    let matched = false;
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
                matched = true;
                break;
            }
            table = current;
        }
    }

    const parsedAppAgentName =
        useParsedAppAgentName || commands.length === 0
            ? appAgentName
            : undefined;
    const result: ResolveCommandResult = {
        parsedAppAgentName,
        actualAppAgentName: parsedAppAgentName ?? actualAppAgentName,
        commands,
        suffix: curr.trim(),
        table,
        descriptor,
        matched,
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
            if (
                result.suffix !== "" &&
                result.descriptor.parameters === undefined
            ) {
                throw new Error(
                    `Command '@${getParsedCommand(result)}' does not accept parameters.`,
                );
            }
            const params = result.descriptor.parameters
                ? parseParams(result.suffix, result.descriptor.parameters)
                : undefined;
            return {
                appAgentName: result.actualAppAgentName,
                command: result.commands,
                params,
            };
        } catch (e: any) {
            if (
                result.matched ||
                result.suffix.length === 0 ||
                result.suffix.startsWith("-")
            ) {
                // Error with with the subcommand if it is not a default, or suffix started as a "flag".
                const command = getParsedCommand(result);
                throw new Error(
                    `${e.message}\n\n${chalk.reset(getUsage(command, result.descriptor))}`,
                );
            }
            // if we matched only default subcommand fall thru and error assuming that we matched only the table
        }
    }
    const command = getParsedCommand(result);

    if (
        result.parsedAppAgentName !== undefined &&
        !context.agents.isCommandEnabled(result.parsedAppAgentName)
    ) {
        throw new Error(
            `Command for '${result.parsedAppAgentName}' is disabled.`,
        );
    }

    if (result.table === undefined) {
        throw new Error(`Unknown command '${input}'`);
    }
    const message =
        command.length === 0
            ? "Command or agent name required."
            : result.suffix.length === 0
              ? `'@${command}' requires a subcommand.`
              : `'${result.suffix}' is not a subcommand for '@${command}'.`;

    throw new Error(
        `${message}\n\n${chalk.reset(getHandlerTableUsage(result.table, command, context))}`,
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
        return await executeCommand(
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
                undefined,
            ),
            "block",
        );
        debugCommandError(e.stack);

        const commandResult = getCommandResult(context);
        if (commandResult !== undefined) {
            commandResult.exception = e.message;
        }
    }
}

function beginProcessCommand(
    requestId: RequestId,
    context: CommandHandlerContext,
) {
    context.requestId = requestId;
    context.commandResult = undefined;
    if (requestId) {
        context.commandProfiler =
            context.metricsManager?.beginCommand(requestId);
    }
}

function endProcessCommand(
    requestId: RequestId,
    context: CommandHandlerContext,
) {
    const pendingToggleTransientAgents = context.pendingToggleTransientAgents;
    if (pendingToggleTransientAgents.length !== 0) {
        for (const [agentName, active] of pendingToggleTransientAgents) {
            context.agents.toggleTransient(agentName, active);
        }

        // Because of the embedded switcher, we need to clear the cache.
        context.translatorCache.clear();

        const [agentName, active] = pendingToggleTransientAgents.pop()!;
        if (active) {
            context.lastActionSchemaName = agentName;
        } else if (context.lastActionSchemaName === agentName) {
            context.lastActionSchemaName = getAppAgentName(agentName);
        }
        context.pendingToggleTransientAgents.length = 0; // clear the pending toggle agents.
    }

    context.commandProfiler?.stop();
    context.commandProfiler = undefined;

    const metrics = requestId
        ? context.metricsManager?.endCommand(requestId)
        : undefined;

    if (metrics) {
        ensureCommandResult(context).metrics = metrics;
    }
    const result = context.commandResult;
    context.commandResult = undefined;
    context.requestId = undefined;

    return result;
}

export async function processCommand(
    originalInput: string,
    context: CommandHandlerContext,
    requestId?: RequestId,
    attachments?: string[],
): Promise<CommandResult | undefined> {
    // Process one command at at time.
    return context.commandLock(async () => {
        beginProcessCommand(requestId, context);
        try {
            await processCommandNoLock(originalInput, context, attachments);
        } finally {
            return endProcessCommand(requestId, context);
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

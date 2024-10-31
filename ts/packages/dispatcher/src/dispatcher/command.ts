// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import chalk from "chalk";
import registerDebug from "debug";
import {
    RequestId,
    getRequestIO,
    DispatcherName,
} from "../handlers/common/interactiveIO.js";
import { getDefaultExplainerName } from "agent-cache";
import { CommandHandlerContext } from "../handlers/common/commandHandlerContext.js";

import { unicodeChar } from "../utils/interactive.js";
import {
    CommandDescriptor,
    CommandDescriptors,
    CommandDescriptorTable,
    FlagDefinitions,
    ParameterDefinitions,
    ParsedCommandParams,
} from "@typeagent/agent-sdk";
import { executeCommand } from "../action/actionHandlers.js";
import {
    getFlagMultiple,
    getFlagType,
    isCommandDescriptorTable,
    resolveFlag,
} from "@typeagent/agent-sdk/helpers/command";
import { RequestMetrics } from "../utils/metrics.js";
import { CommandCompletionResult } from "./dispatcher.js";
import { parseParams } from "./parameters.js";
import { getHandlerTableUsage, getUsage } from "./commandHelp.js";

const debugCommand = registerDebug("typeagent:dispatcher:command");
const debugCommandError = registerDebug("typeagent:dispatcher:command:error");

type ResolveCommandResult = {
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
                descriptor = table.defaultSubCommand;
                break;
            }

            const current: CommandDescriptors = table.commands[subcommand];
            if (current === undefined) {
                // Unknown command
                descriptor = table.defaultSubCommand;
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
        // default to dispatcher request
        input = `dispatcher request ${input}`;
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

    const names = context.agents.getActiveTranslators();
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
    const commandPrefix = input.match(/^\s*@/);
    if (commandPrefix === null) {
        return undefined;
    }

    const command = input.substring(commandPrefix.length);
    if (!/\s/.test(command)) {
        // No space no command yet.
        return { partial: commandPrefix[0], prefix: command };
    }

    const trimmedEnd = input.trimEnd();
    if (trimmedEnd !== input) {
        // There is trailing space, just resolve the whole command
        return { partial: trimmedEnd, prefix: "" };
    }

    const suffix = input.match(/\s\S+$/);
    if (suffix === null) {
        // No suffix, resolve the whole command
        return { partial: trimmedEnd, prefix: "" };
    }
    const split = input.length - suffix[0].length;
    return {
        partial: input.substring(0, split).trimEnd(),
        prefix: input.substring(split).trimStart(),
    };
}

function getPendingFlag(
    params: ParsedCommandParams<ParameterDefinitions>,
    flags: FlagDefinitions | undefined,
) {
    if (params.tokens.length === 0 || flags === undefined) {
        return undefined;
    }
    const lastToken = params.tokens[params.tokens.length - 1];
    const resolvedFlag = resolveFlag(flags, lastToken);
    return resolvedFlag !== undefined &&
        getFlagType(resolvedFlag[1]) !== "boolean"
        ? lastToken
        : undefined;
}

export async function getCommandCompletion(
    input: string,
    context: CommandHandlerContext,
): Promise<CommandCompletionResult | undefined> {
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
            result.suffix.length === 0 &&
            table?.defaultSubCommand === result.descriptor
        ) {
            // Match the default sub command.  Includes additional subcommand names
            completions.push(...Object.keys(table.commands));
        }

        if (typeof descriptor.parameters !== "object") {
            return undefined;
        }
        const flags = descriptor.parameters.flags;
        const params = parseParams(result.suffix, descriptor.parameters, true);
        const agent = context.agents.getAppAgent(result.actualAppAgentName);
        const sessionContext = context.agents.getSessionContext(
            result.actualAppAgentName,
        );

        const pendingFlag = getPendingFlag(params, flags);

        const pendingCompletions: string[] = [];
        if (pendingFlag === undefined) {
            pendingCompletions.push(...params.nextArgs);
            if (flags !== undefined) {
                const parsedFlags = params.flags;
                for (const [key, value] of Object.entries(flags)) {
                    const multiple = getFlagMultiple(value);
                    if (!multiple) {
                        if (getFlagType(value) === "json") {
                            // JSON property flags
                            pendingCompletions.push(`--${key}.`);
                        }
                        if (parsedFlags?.[key] !== undefined) {
                            // filter out non-multiple flags that is already set.
                            continue;
                        }
                    }
                    completions.push(`--${key}`);
                    if (value.char !== undefined) {
                        completions.push(`-${value.char}`);
                    }
                }
            }
        } else {
            // get the potential values for the pending flag
            pendingCompletions.push(pendingFlag);
        }

        if (agent.getCommandCompletion) {
            completions.push(
                ...(await agent.getCommandCompletion(
                    result.commands,
                    params,
                    pendingCompletions,
                    sessionContext,
                )),
            );
        }
    } else {
        if (result.suffix.length !== 0) {
            // Unknown command
            return undefined;
        }
        completions.push(...Object.keys(table.commands));
        if (
            result.parsedAppAgentName === undefined &&
            result.commands.length === 0
        ) {
            // Include the agent names
            completions.push(
                ...context.agents
                    .getAppAgentNames()
                    .filter((name) => context.agents.isCommandEnabled(name)),
            );
        }
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

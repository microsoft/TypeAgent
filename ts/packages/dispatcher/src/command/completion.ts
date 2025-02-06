// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandHandlerContext } from "../context/commandHandlerContext.js";

import {
    CommandDescriptor,
    FlagDefinitions,
    ParameterDefinitions,
    ParsedCommandParams,
} from "@typeagent/agent-sdk";
import {
    getFlagMultiple,
    getFlagType,
    resolveFlag,
} from "@typeagent/agent-sdk/helpers/command";
import { parseParams } from "./parameters.js";
import {
    getDefaultSubCommandDescriptor,
    resolveCommand,
    ResolveCommandResult,
} from "./command.js";

export type CommandCompletionResult = {
    partial: string; // The head part of the completion
    space: boolean; // require space between partial and prefix
    prefix: string; // the prefix for completion match
    completions: string[]; // All the partial completions available after partial (and space if true)
};

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
    if (resolvedFlag === undefined) {
        return undefined;
    }
    const type = getFlagType(resolvedFlag[1]);
    if (type === "boolean") {
        return undefined;
    }
    if (type === "json") {
        return `${lastToken}`;
    }

    return `--${resolvedFlag[0]}`; // use the full flag name in case it was a short flag
}

async function getCommandParameterCompletion(
    descriptor: CommandDescriptor,
    context: CommandHandlerContext,
    result: ResolveCommandResult,
) {
    const completions: string[] = [];
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
    return completions;
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
            table !== undefined &&
            getDefaultSubCommandDescriptor(table) === result.descriptor
        ) {
            // Match the default sub command.  Includes additional subcommand names
            completions.push(...Object.keys(table.commands));
        }
        const parameterCompletions = await getCommandParameterCompletion(
            descriptor,
            context,
            result,
        );

        if (parameterCompletions === undefined) {
            if (completions.length === 0) {
                // No more completion from the descriptor.
                return undefined;
            }
        } else {
            completions.push(...parameterCompletions);
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

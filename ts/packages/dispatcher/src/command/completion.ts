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
    normalizeCommand,
    resolveCommand,
    ResolveCommandResult,
} from "./command.js";

export type CommandCompletionResult = {
    startIndex: number; // the index for the input where completion starts
    completions: string[]; // All the partial completions available after partial (and space if true)
    space: boolean; // require space before the completion   (e.g. false if we are trying to complete a command)
};

// Return the index of the last incomplete term for completion.
// if the last term is the '@' command itself, return the index right after the '@'.
// Input with trailing space doesn't have incomplete term, so return -1.
function getCompletionStartIndex(input: string) {
    const commandPrefix = input.match(/^\s*@/);
    if (commandPrefix !== null) {
        // Input is a command
        const command = input.substring(commandPrefix.length);
        if (!/\s/.test(command)) {
            // No space no command yet just return right after the '@' as the start of the last term.
            return commandPrefix.length;
        }
    }

    const suffix = input.match(/\s\S+$/);
    return suffix !== null ? input.length - suffix[0].length : -1;
}

// Return the full flag name if we are waiting a flag value.  Add boolean values for completions and return undefined if the flag is boolean.
function getPendingFlag(
    params: ParsedCommandParams<ParameterDefinitions>,
    flags: FlagDefinitions | undefined,
    completions: string[],
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
        completions.push("true", "false");
        return undefined; // doesn't require a value.
    }
    if (type === "json") {
        return lastToken;
    }

    return `--${resolvedFlag[0]}`; // use the full flag name in case it was a short flag
}

// True if surrounded by quotes at both ends (matching single or double quotes).
// False if only start with a quote.
// Undefined if no starting quote.

function isFullyQuoted(value: string) {
    const len = value.length;
    if (len === 0) {
        return undefined;
    }
    const firstChar = value[0];
    if (firstChar !== "'" && firstChar !== '"') {
        return undefined;
    }

    return (
        len > 1 &&
        value[len - 1] === firstChar &&
        !(len > 2 && value[len - 2] === "\\")
    );
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

    const pendingFlag = getPendingFlag(params, flags, completions);

    const pendingCompletions: string[] = [];
    if (pendingFlag === undefined) {
        // TODO: auto inject boolean value for boolean args.
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
        const { tokens, lastCompletableParam, lastParamImplicitQuotes } =
            params;
        if (lastCompletableParam !== undefined && tokens.length > 0) {
            const valueToken = tokens[tokens.length - 1];
            const quoted = isFullyQuoted(valueToken);
            if (
                quoted === false ||
                (quoted === undefined && lastParamImplicitQuotes)
            ) {
                pendingCompletions.push(lastCompletableParam);
            }
        }
        if (pendingCompletions.length > 0) {
            completions.push(
                ...(await agent.getCommandCompletion(
                    result.commands,
                    params,
                    pendingCompletions,
                    sessionContext,
                )),
            );
        }
    }
    return completions;
}

export async function getCommandCompletion(
    input: string,
    context: CommandHandlerContext,
): Promise<CommandCompletionResult | undefined> {
    const completionStartIndex = getCompletionStartIndex(input);
    // Trim spaces and remove leading '@'
    const partialCommand = normalizeCommand(
        completionStartIndex !== -1
            ? input.substring(0, completionStartIndex)
            : input,
        context,
    );

    const result = await resolveCommand(partialCommand, context);

    const table = result.table;
    if (table === undefined) {
        // Unknown app agent, or appAgent doesn't support commands
        return undefined;
    }

    // Collect completions
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

    const space =
        completionStartIndex > 0 && input[completionStartIndex - 1] !== "@";
    return {
        startIndex: completionStartIndex,
        completions,
        space,
    };
}

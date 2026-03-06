// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandHandlerContext } from "../context/commandHandlerContext.js";

import {
    CommandDescriptor,
    FlagDefinitions,
    ParameterDefinitions,
    ParsedCommandParams,
    CompletionGroup,
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

import registerDebug from "debug";
import { CommandCompletionResult } from "@typeagent/dispatcher-types";
const debug = registerDebug("typeagent:command:completion");
const debugError = registerDebug("typeagent:command:completion:error");

// Return the full flag name if we are waiting a flag value.  Add boolean values for completions and return undefined if the flag is boolean.
function getPendingFlag(
    params: ParsedCommandParams<ParameterDefinitions>,
    flags: FlagDefinitions | undefined,
    completions: CompletionGroup[],
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
        completions.push({
            name: `--${resolvedFlag[0]}`,
            completions: ["true", "false"],
        });
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

function collectFlags(
    agentCommandCompletions: string[],
    flags: FlagDefinitions,
    parsedFlags: any,
) {
    const flagCompletions: string[] = [];
    for (const [key, value] of Object.entries(flags)) {
        const multiple = getFlagMultiple(value);
        if (!multiple) {
            if (getFlagType(value) === "json") {
                // JSON property flags
                agentCommandCompletions.push(`--${key}.`);
            }
            if (parsedFlags?.[key] !== undefined) {
                // filter out non-multiple flags that is already set.
                continue;
            }
        }
        flagCompletions.push(`--${key}`);
        if (value.char !== undefined) {
            flagCompletions.push(`-${value.char}`);
        }
    }

    return flagCompletions;
}

type ParameterCompletionResult = {
    completions: CompletionGroup[];
    startIndex: number;
};

async function getCommandParameterCompletion(
    descriptor: CommandDescriptor,
    context: CommandHandlerContext,
    result: ResolveCommandResult,
    inputLength: number,
): Promise<ParameterCompletionResult | undefined> {
    const completions: CompletionGroup[] = [];
    if (typeof descriptor.parameters !== "object") {
        // No more completion, return undefined;
        return undefined;
    }
    const flags = descriptor.parameters.flags;
    const params = parseParams(result.suffix, descriptor.parameters, true);
    const pendingFlag = getPendingFlag(params, flags, completions);
    const agentCommandCompletions: string[] = [];
    if (pendingFlag === undefined) {
        // TODO: auto inject boolean value for boolean args.
        agentCommandCompletions.push(...params.nextArgs);
        if (flags !== undefined) {
            const flagCompletions = collectFlags(
                agentCommandCompletions,
                flags,
                params.flags,
            );
            if (flagCompletions.length > 0) {
                completions.push({
                    name: "Command Flags",
                    completions: flagCompletions,
                });
            }
        }
    } else {
        // get the potential values for the pending flag
        agentCommandCompletions.push(pendingFlag);
    }

    const agent = context.agents.getAppAgent(result.actualAppAgentName);
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
                agentCommandCompletions.push(lastCompletableParam);
            }
        }
        if (agentCommandCompletions.length > 0) {
            const sessionContext = context.agents.getSessionContext(
                result.actualAppAgentName,
            );
            const agentGroups = await agent.getCommandCompletion(
                result.commands,
                params,
                agentCommandCompletions,
                sessionContext,
            );
            completions.push(...agentGroups);
        }
    }

    // Compute startIndex from the parse position.  The filter text is the
    // last incomplete token the user is typing (or empty at a boundary).
    const trailingSpace = /\s$/.test(result.suffix);
    const lastToken =
        params.tokens.length > 0
            ? params.tokens[params.tokens.length - 1]
            : undefined;
    const filterLength = trailingSpace || !lastToken ? 0 : lastToken.length;
    const startIndex = inputLength - filterLength;

    return { completions, startIndex };
}

export async function getCommandCompletion(
    input: string,
    context: CommandHandlerContext,
): Promise<CommandCompletionResult | undefined> {
    try {
        debug(`Command completion start: '${input}'`);

        // Always send the full input so the backend sees all typed text.
        const partialCommand = normalizeCommand(input, context);

        debug(`Command completion resolve command: '${partialCommand}'`);
        const result = await resolveCommand(partialCommand, context);

        const table = result.table;
        if (table === undefined) {
            // Unknown app agent, or appAgent doesn't support commands
            // Return undefined to indicate no more completions for this prefix.
            return undefined;
        }

        // The parse-derived startIndex: command resolution consumed
        // everything up to the suffix; within the suffix, parameter
        // parsing determines the last incomplete token position.
        let startIndex = input.length - result.suffix.length;

        // Collect completions
        const completions: CompletionGroup[] = [];
        if (input.trim() === "") {
            completions.push({
                name: "Command Prefixes",
                completions: ["@"],
            });
        }

        const descriptor = result.descriptor;
        // Track whether subcommand alternatives are included alongside the
        // default descriptor's parameters.  When true, startIndex must stay
        // at the command boundary (before the suffix) since needsSeparator
        // strips the space and lets the trie match both subcommands and
        // parameter values.
        let hasSubcommandCompletions = false;
        if (descriptor !== undefined) {
            if (
                table !== undefined &&
                !result.matched &&
                getDefaultSubCommandDescriptor(table) === result.descriptor
            ) {
                // Resolved to the default sub command (not an explicit
                // match).  Include sibling subcommand names so the user
                // can choose between them and the default's parameters.
                // This covers both "@config " (suffix="") and "@config c"
                // (suffix="c") — the trie filters by prefix either way.
                completions.push({
                    name: "Subcommands",
                    completions: Object.keys(table.commands),
                    needsSeparator: true,
                });
                hasSubcommandCompletions = true;
            }
            const parameterCompletions = await getCommandParameterCompletion(
                descriptor,
                context,
                result,
                input.length,
            );
            if (parameterCompletions === undefined) {
                if (completions.length === 0) {
                    // No more completion, return undefined;
                    return undefined;
                }
            } else {
                completions.push(...parameterCompletions.completions);
                if (!hasSubcommandCompletions) {
                    startIndex = parameterCompletions.startIndex;
                }
            }
        } else {
            if (result.suffix.length !== 0) {
                // Unknown command
                // Return undefined to indicate no more completions for this prefix.
                return undefined;
            }
            completions.push({
                name: "Subcommands",
                completions: Object.keys(table.commands),
                needsSeparator:
                    result.parsedAppAgentName !== undefined ||
                    result.commands.length > 0
                        ? true
                        : undefined,
            });
            if (
                result.parsedAppAgentName === undefined &&
                result.commands.length === 0
            ) {
                // Include the agent names
                completions.push({
                    name: "Agent Names",
                    completions: context.agents
                        .getAppAgentNames()
                        .filter((name) =>
                            context.agents.isCommandEnabled(name),
                        ),
                });
            }
        }

        // Allow grammar-reported prefixLength (from groups) to override
        // the parse-derived startIndex.  This handles CJK and other
        // non-space-delimited scripts where the grammar matcher is the
        // authoritative source for how far into the input it consumed.
        const groupPrefixLength = completions.find(
            (g) => g.prefixLength !== undefined,
        )?.prefixLength;
        if (groupPrefixLength !== undefined) {
            startIndex = groupPrefixLength;
        }

        // Extract needsSeparator from any group that reports it.
        const needsSeparator = completions.some(
            (g) => g.needsSeparator === true,
        )
            ? true
            : undefined;

        // Like the grammar matcher, exclude trailing whitespace before
        // startIndex when a separator is needed — the separator lives
        // between the command anchor and the completion text, not inside
        // the filter prefix.  This handles both "@config " (trailing
        // space) and "@config c" (space between command and partial token).
        if (needsSeparator) {
            while (startIndex > 0 && /\s/.test(input[startIndex - 1])) {
                startIndex--;
            }
        }

        const completionResult: CommandCompletionResult = {
            startIndex,
            completions,
            needsSeparator,
        };

        debug(`Command completion result:`, completionResult);
        return completionResult;
    } catch (e: any) {
        debugError(`Command completion error: ${e}\n${e.stack}`);
        return undefined;
    }
}

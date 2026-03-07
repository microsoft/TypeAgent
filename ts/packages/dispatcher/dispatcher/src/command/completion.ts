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

// Internal result from parameter-level completion.
//
// `complete` uses a conservative heuristic:
//  - false when the agent's getCommandCompletion was invoked (agents
//    cannot yet signal whether their set is exhaustive).
//  - false when a pending non-boolean flag accepts free-form input.
//  - true  when all positional args are filled and only enumerable
//    flag names remain (a finite, known set).
type ParameterCompletionResult = {
    completions: CompletionGroup[];
    startIndex: number;
    complete: boolean;
};

// Complete parameter values and flags for an already-resolved command
// descriptor.  Returns undefined when the descriptor declares no
// parameters (the caller decides whether sibling subcommands suffice).
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

    let agentInvoked = false;
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
            agentInvoked = true;
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

    // Determine whether the completion set is exhaustive.
    // Agent-provided completions are conservatively treated as
    // non-exhaustive since agents cannot yet signal exhaustiveness.
    // When no agent is involved, completions are exhaustive if:
    //  - A pending boolean flag offers only ["true", "false"]
    //  - All positional args are filled and only enumerable flags remain
    // Otherwise free-form text parameters make the set non-exhaustive.
    let complete: boolean;
    if (agentInvoked) {
        complete = false;
    } else if (pendingFlag !== undefined) {
        // A non-boolean pending flag accepts free-form values.
        // (Boolean flags are handled by getPendingFlag returning undefined
        //  and pushing ["true", "false"] into completions directly.)
        complete = false;
    } else {
        // No agent, no pending flag.  Exhaustive when there are no
        // unfilled positional args (nextArgs is empty) and only
        // flags remain — flag names are a finite, known set.
        complete = params.nextArgs.length === 0;
    }

    return { completions, startIndex, complete };
}

//
// ── getCommandCompletion contract ────────────────────────────────────────────
//
// Given a partial user input string, returns the longest valid prefix,
// available completions from that point, and metadata about how they attach.
//
// Always returns a result — every input has a longest valid prefix
// (at minimum the empty string, startIndex=0).  An empty completions
// array with complete=true means the command is fully specified and
// nothing further can follow.
//
// The portion of input after the prefix (the "suffix") is NOT a gate
// on whether completions are returned.  The suffix is filter text:
// the caller feeds it to a trie to narrow the offered completions
// down to prefix-matches.  Even if the suffix doesn't match anything
// today, the full set is still returned so the trie can decide.  For
// example "@unknownagent " resolves only as far as "@" (startIndex=1);
// completions offer all agent names and system subcommands, and the
// trie filters "unknownagent " against them (yielding no matches, but
// that is the trie's job, not ours).
//
// Return fields (see CommandCompletionResult):
//
//   startIndex   Length of the longest resolved prefix.
//                input[0..startIndex) was fully consumed by
//                normalizeCommand → resolveCommand (→ parseParams);
//                completions describe what can validly follow.
//                May be overridden by a grammar-reported prefixLength
//                from a CompletionGroup.  Trailing whitespace before
//                startIndex is stripped when needsSeparator is true.
//
//   completions  Array of CompletionGroups from up to three sources:
//                (a) built-in command / subcommand / agent-name lists,
//                (b) flag names from the descriptor's ParameterDefinitions,
//                (c) agent-provided groups via the agent's
//                    getCommandCompletion callback.
//
//   needsSeparator
//                true when the prefix and completions are structurally
//                separated (e.g. a space between a command and its
//                parameters).  Aggregated: true if *any* group reports
//                needsSeparator.
//
//   complete     true when the returned completions are the *exhaustive*
//                set of valid continuations after the prefix.  When true
//                and the user types something that doesn't prefix-match
//                any completion, the caller can skip re-fetching because
//                no other valid input exists.  Subcommand and agent-name
//                lists are always exhaustive.  Parameter completions are
//                exhaustive only when no agent was invoked and no
//                free-form positional args remain unfilled — see
//                ParameterCompletionResult for the heuristic.
//
export async function getCommandCompletion(
    input: string,
    context: CommandHandlerContext,
): Promise<CommandCompletionResult> {
    try {
        debug(`Command completion start: '${input}'`);

        // Always send the full input so the backend sees all typed text.
        const partialCommand = normalizeCommand(input, context);

        debug(`Command completion resolve command: '${partialCommand}'`);
        const result = await resolveCommand(partialCommand, context);

        const table = result.table;

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
        let complete = true;
        if (descriptor !== undefined) {
            // Get parameter completions first — we need to know
            // whether parameters consumed past the command boundary
            // before deciding if subcommand alternatives apply.
            const parameterCompletions = await getCommandParameterCompletion(
                descriptor,
                context,
                result,
                input.length,
            );

            // Include sibling subcommand names when resolved to the
            // default (not an explicit match), but only if parameter
            // parsing hasn't consumed past the command boundary.
            // Once the user has typed tokens that fill parameters
            // (moving startIndex forward), they've committed to the
            // default — subcommand names would be filtered against
            // the wrong text at the wrong position.
            const commandBoundary = input.length - result.suffix.length;
            const addSubcommands =
                table !== undefined &&
                !result.matched &&
                getDefaultSubCommandDescriptor(table) === descriptor &&
                (parameterCompletions === undefined ||
                    parameterCompletions.startIndex <= commandBoundary);

            if (addSubcommands) {
                completions.push({
                    name: "Subcommands",
                    completions: Object.keys(table.commands),
                    needsSeparator: true,
                });
            }

            if (parameterCompletions === undefined) {
                // Descriptor has no parameters.  If subcommand
                // alternatives were added above, they are the
                // exhaustive set; otherwise the command is fully
                // specified with nothing more to type.
            } else {
                completions.push(...parameterCompletions.completions);
                if (!addSubcommands) {
                    startIndex = parameterCompletions.startIndex;
                }
                complete = parameterCompletions.complete;
            }
        } else if (table !== undefined) {
            // descriptor is undefined: the suffix didn't resolve to any
            // known command or subcommand.  startIndex already points to
            // where resolution stopped (the start of the suffix), so we
            // offer every valid continuation from that point — subcommand
            // names from the current table.  Agent names are handled
            // independently below.  The suffix is filter text for the
            // caller's trie, not a reason to suppress completions.
            // Examples:
            //   "@com"            → suffix="com",   completions include
            //                       subcommands + agent names (trie
            //                       narrows to "comptest", etc.)
            //   "@unknownagent " → suffix="unknownagent ", same set
            //                       (trie finds no match — that's fine)
            completions.push({
                name: "Subcommands",
                completions: Object.keys(table.commands),
                needsSeparator:
                    result.parsedAppAgentName !== undefined ||
                    result.commands.length > 0
                        ? true
                        : undefined,
            });
        } else {
            // Both table and descriptor are undefined — the agent
            // returned no commands at all.  Nothing to add;
            // completions stays empty, complete stays true.
        }

        // Independently of which branch above ran, offer agent names
        // when the user hasn't typed a recognized agent and hasn't
        // navigated into a subcommand tree.  This is decoupled from
        // the three-way branch so it works regardless of whether the
        // fallback agent has a command table.
        if (
            result.parsedAppAgentName === undefined &&
            result.commands.length === 0
        ) {
            completions.push({
                name: "Agent Names",
                completions: context.agents
                    .getAppAgentNames()
                    .filter((name) =>
                        context.agents.isCommandEnabled(name),
                    ),
            });
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
            complete,
        };

        debug(`Command completion result:`, completionResult);
        return completionResult;
    } catch (e: any) {
        debugError(`Command completion error: ${e}\n${e.stack}`);
        // On error, return a safe default — don't claim exhaustiveness
        // since we don't know what went wrong.
        return {
            startIndex: 0,
            completions: [],
            needsSeparator: undefined,
            complete: false,
        };
    }
}

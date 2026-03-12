// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandHandlerContext } from "../context/commandHandlerContext.js";

import {
    CommitMode,
    CommandDescriptor,
    FlagDefinitions,
    ParameterDefinitions,
    CompletionGroup,
    CompletionGroups,
    SeparatorMode,
} from "@typeagent/agent-sdk";
import {
    getFlagMultiple,
    getFlagType,
    mergeSeparatorMode,
    resolveFlag,
} from "@typeagent/agent-sdk/helpers/command";
import { parseParams, ParseParamsResult } from "./parameters.js";
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
    params: ParseParamsResult<ParameterDefinitions>,
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

// Rewind index past any trailing whitespace in `text` so it sits
// at the end of the preceding token.  Returns `index` unchanged
// when the character before it is already non-whitespace.
function tokenBoundary(text: string, index: number): number {
    while (index > 0 && /\s/.test(text[index - 1])) {
        index--;
    }
    return index;
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
// `closedSet` uses a conservative heuristic:
//  - false when the agent's getCommandCompletion was invoked (agents
//    cannot yet signal whether their set is closed).
//  - false when a pending non-boolean flag accepts free-form input.
//  - true  when all positional args are filled and only enumerable
//    flag names remain (a finite, known set).
type ParameterCompletionResult = {
    completions: CompletionGroup[];
    startIndex: number;
    separatorMode: SeparatorMode | undefined;
    closedSet: boolean;
    commitMode: CommitMode | undefined;
};

// Complete parameter values and flags for an already-resolved command
// descriptor.  Returns undefined when the descriptor declares no
// parameters (the caller decides whether sibling subcommands suffice).
//
// ── Spec ──────────────────────────────────────────────────────────────────
//
// 1. Parse parameters partially up to the longest valid index.
//
// 2. If parsing did NOT consume all input (remainderLength > 0):
//    → startIndex = position after the longest valid prefix.
//    → Offer completions for whatever can validly follow that prefix
//      (next positional args, flag names).
//
// 3. If parsing consumed all input (remainderLength === 0):
//
//    a. If any of the following are true, the user is still typing the
//       last token — return startIndex at the *beginning* of that token
//       and offer completions for it:
//         • No trailing space (cursor is at the end of the last token).
//         • The last parameter uses implicitQuotes (rest-of-line capture,
//           never "committed" by whitespace).
//         • The last token is partially quoted (open quote without a
//           matching close quote).
//
//    b. Otherwise (trailing space present, last token is bare or fully
//       quoted) — the last token has been committed.  Return startIndex
//       at the *end* of the last token (excluding the trailing space)
//       and offer completions for the next parameters.
//
async function getCommandParameterCompletion(
    descriptor: CommandDescriptor,
    context: CommandHandlerContext,
    result: ResolveCommandResult,
    input: string,
    hasTrailingSpace: boolean,
): Promise<ParameterCompletionResult | undefined> {
    const completions: CompletionGroup[] = [];
    if (typeof descriptor.parameters !== "object") {
        // No more completion, return undefined;
        return undefined;
    }
    const flags = descriptor.parameters.flags;
    const params: ParseParamsResult<ParameterDefinitions> = parseParams(
        result.suffix,
        descriptor.parameters,
        true,
    );
    const pendingFlag = getPendingFlag(params, flags, completions);
    const agentCommandCompletions: string[] = [];
    if (pendingFlag !== undefined && hasTrailingSpace) {
        // The last token is a recognized flag and the user committed
        // it with a trailing space.  Ask the agent for flag values.
        agentCommandCompletions.push(pendingFlag);
    } else {
        // Either no pending flag, or the flag isn't committed yet
        // (no trailing space).  Offer positional args and flag names.
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
    }

    // Compute startIndex from how far parseParams consumed the suffix.
    // remainderLength is the length of the (trimmed) parameter text
    // that was NOT successfully parsed — everything before it is part
    // of the longest valid prefix.  Since parseParams strips inter-
    // token whitespace (trimStart), the raw arithmetic can land on
    // the separator space — tokenBoundary rewinds to the preceding
    // token edge.
    const remainderIndex = input.length - params.remainderLength;
    let startIndex = tokenBoundary(input, remainderIndex);
    debug(
        `Command completion parameter consumed length: ${params.remainderLength}`,
    );

    let agentInvoked = false;
    let agentClosedSet: boolean | undefined;
    let agentCommitMode: CommitMode | undefined;
    let separatorMode: SeparatorMode | undefined;
    const agent = context.agents.getAppAgent(result.actualAppAgentName);
    if (agent.getCommandCompletion) {
        const { tokens, lastCompletableParam, lastParamImplicitQuotes } =
            params;

        let tokenStartIndex = remainderIndex;
        if (lastCompletableParam !== undefined && tokens.length > 0) {
            const valueToken = tokens[tokens.length - 1];
            const quoted = isFullyQuoted(valueToken);
            if (
                quoted === false ||
                (quoted === undefined && lastParamImplicitQuotes) ||
                (quoted === undefined &&
                    !hasTrailingSpace &&
                    pendingFlag === undefined)
            ) {
                // The user is inside a token (open quote or
                // implicitQuotes rest-of-line) — completions for
                // other parameters or flags at the original
                // startIndex are invalid because no new token can
                // start.  Make this path exclusive: clear earlier
                // completions and adjust startIndex to the token
                // start so the caller replaces the partial token.
                agentCommandCompletions.length = 0;
                completions.length = 0;
                agentCommandCompletions.push(lastCompletableParam);
                tokenStartIndex = remainderIndex - valueToken.length;
                startIndex = tokenBoundary(input, tokenStartIndex);
            }
        }
        if (agentCommandCompletions.length > 0) {
            const agentName = result.actualAppAgentName;
            const sessionContext = context.agents.getSessionContext(agentName);
            debug(
                `Command completion parameter with agent: '${agentName}' with params ${JSON.stringify(agentCommandCompletions)}`,
            );
            const agentResult: CompletionGroups =
                await agent.getCommandCompletion(
                    result.commands,
                    params,
                    agentCommandCompletions,
                    sessionContext,
                );

            // Allow grammar-reported matchedPrefixLength to override
            // the parse-derived startIndex.  This handles CJK and other
            // non-space-delimited scripts where the grammar matcher is the
            // authoritative source for how far into the input it consumed.
            // Grammar matchedPrefixLength is relative to the token content
            // start (after the separator space), not to tokenBoundary
            // (before it), so use tokenStartIndex when available.
            const groupPrefixLength = agentResult.matchedPrefixLength;
            if (groupPrefixLength !== undefined && groupPrefixLength != 0) {
                startIndex = tokenStartIndex + groupPrefixLength;
                // we have advanced the startIndex, so existing completions are no longer valid, clear them out.
                completions.length = 0;
            }
            completions.push(...agentResult.groups);
            separatorMode = agentResult.separatorMode;
            agentInvoked = true;
            agentClosedSet = agentResult.closedSet;
            agentCommitMode = agentResult.commitMode;
            debug(
                `Command completion parameter with agent: groupPrefixLength=${groupPrefixLength}, startIndex=${startIndex}, tokenStartIndex=${tokenStartIndex}`,
            );
        }
    }

    // When there is no trailing space, the last consumed token
    // hasn't been committed.  If no earlier path already adjusted
    // startIndex (lastCompletableParam / grammar-matchedPrefixLength),
    // back up to the start of that token so the caller's trie can
    // filter completions against it.
    // Exception: fully-quoted tokens (e.g. "build") are committed
    // by their closing quote — no back-up needed.
    // Exception: when the agent was already invoked (for nextArgs),
    // its completions describe the *next* position — backing up
    // would create a mismatch between startIndex and completions.
    const unadjustedStartIndex = tokenBoundary(input, remainderIndex);
    if (
        !hasTrailingSpace &&
        !agentInvoked &&
        params.remainderLength === 0 &&
        params.tokens.length > 0 &&
        startIndex === unadjustedStartIndex
    ) {
        const lastToken = params.tokens[params.tokens.length - 1];
        if (isFullyQuoted(lastToken) !== true) {
            startIndex = tokenBoundary(
                input,
                unadjustedStartIndex - lastToken.length,
            );
        }
    }

    // Determine whether the completion set is a closed set.
    // Agent-provided completions use the agent's self-reported
    // closedSet flag (via CompletionGroups.closedSet), defaulting to
    // false when the agent doesn't set it.
    // When no agent is involved, the set is closed if:
    //  - A pending boolean flag offers only ["true", "false"]
    //  - All positional args are filled and only enumerable flags remain
    // Otherwise free-form text parameters make the set open.
    let closedSet: boolean;
    if (agentInvoked) {
        closedSet = agentClosedSet ?? false;
    } else if (pendingFlag !== undefined) {
        // A non-boolean pending flag accepts free-form values.
        // (Boolean flags are handled by getPendingFlag returning undefined
        //  and pushing ["true", "false"] into completions directly.)
        closedSet = false;
    } else {
        // No agent, no pending flag.  Closed set when there are no
        // unfilled positional args (nextArgs is empty) and only
        // flags remain — flag names are a finite, known set.
        closedSet = params.nextArgs.length === 0;
    }

    // Propagate agent-provided commitMode.  When the agent doesn't
    // specify one, leave undefined so the caller can apply its default.
    const commitMode: CommitMode | undefined = agentCommitMode;

    return { completions, startIndex, separatorMode, closedSet, commitMode };
}

//
// ── getCommandCompletion contract ────────────────────────────────────────────
//
// Given a partial user input string, returns the longest valid prefix,
// available completions from that point, and metadata about how they attach.
//
// Always returns a result — every input has a longest valid prefix
// (at minimum the empty string, startIndex=0).  An empty completions
// array with closedSet=true means the command is fully specified and
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
//                input[0..startIndex) is the "anchor" — the text
//                that was fully consumed by normalizeCommand →
//                resolveCommand (→ parseParams).  Completions
//                describe what can validly follow after the anchor.
//                May be overridden by a grammar-reported matchedPrefixLength
//                from a CompletionGroups result.
//
//                startIndex is always placed at a token boundary
//                (not on separator whitespace).  Each production
//                site — resolveCommand consumed length, parseParams
//                remainder, and the lastCompletableParam adjustment
//                — applies tokenBoundary() to enforce this.
//                Consumers treat the text after the anchor as
//                "rawPrefix", expect it to begin with a separator
//                (per separatorMode, which defaults to "space"
//                when omitted), and strip the separator before
//                filtering.  Keeping whitespace inside the anchor
//                would violate this contract.
//                The grammar-reported matchedPrefixLength override (Site 4)
//                is added to the token start position (before the
//                separator space), not to tokenBoundary — the grammar
//                reports how many characters of the token content it
//                consumed, which is relative to the token start.
//
//   completions  Array of CompletionGroups from up to three sources:
//                (a) built-in command / subcommand / agent-name lists,
//                (b) flag names from the descriptor's ParameterDefinitions,
//                (c) agent-provided groups via the agent's
//                    getCommandCompletion callback.
//
//   separatorMode
//                Describes what kind of separator is required between
//                the matched prefix and the completion text.
//                Merged: most restrictive mode from any source wins.
//                When omitted, consumers default to "space".
//
//   closedSet   true when the returned completions form a *closed set*
//                of valid continuations after the prefix.  When true
//                and the user types something that doesn't prefix-match
//                any completion, the caller can skip re-fetching because
//                no other valid input exists.  Subcommand and agent-name
//                lists are always closed sets.  Parameter completions are
//                closed only when no agent was invoked and no
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
        const commandConsumedLength = input.length - result.suffix.length;
        debug(
            `Command completion command consumed length: ${commandConsumedLength}, suffix: '${result.suffix}'`,
        );
        let startIndex = tokenBoundary(input, commandConsumedLength);
        const hasTrailingSpace = /\s$/.test(partialCommand);

        // Collect completions and track separatorMode across all sources.
        const completions: CompletionGroup[] = [];
        let separatorMode: SeparatorMode | undefined;
        if (input.trim() === "") {
            completions.push({
                name: "Command Prefixes",
                completions: ["@"],
            });
        }

        const descriptor = result.descriptor;
        let closedSet = true;
        let commitMode: "explicit" | "eager" = "explicit";

        // When the last command token was exactly matched but the
        // user hasn't typed a trailing space, they haven't committed
        // it yet.  Offer subcommand alternatives at that token's
        // position instead of jumping to parameter completions.
        const uncommittedCommand =
            descriptor !== undefined &&
            result.matched &&
            !hasTrailingSpace &&
            result.suffix === "" &&
            table !== undefined;

        if (uncommittedCommand) {
            const lastCmd = result.commands[result.commands.length - 1];
            startIndex =
                tokenBoundary(input, commandConsumedLength) - lastCmd.length;
            completions.push({
                name: "Subcommands",
                completions: Object.keys(table!.commands),
            });
            separatorMode = mergeSeparatorMode(separatorMode, "none");
            // closedSet stays true: subcommand names are exhaustive.
        } else if (descriptor !== undefined) {
            // Get parameter completions first — we need to know
            // whether parameters consumed past the command boundary
            // before deciding if subcommand alternatives apply.
            const parameterCompletions = await getCommandParameterCompletion(
                descriptor,
                context,
                result,
                input,
                hasTrailingSpace,
            );

            // Include sibling subcommand names when resolved to the
            // default (not an explicit match), but only if parameter
            // parsing hasn't consumed past the command boundary.
            // Once the user has typed tokens that fill parameters
            // (moving startIndex forward), they've committed to the
            // default — subcommand names would be filtered against
            // the wrong text at the wrong position.
            const addSubcommands =
                table !== undefined &&
                !result.matched &&
                getDefaultSubCommandDescriptor(table) === descriptor &&
                (parameterCompletions === undefined ||
                    parameterCompletions.startIndex <= commandConsumedLength);

            if (addSubcommands) {
                completions.push({
                    name: "Subcommands",
                    completions: Object.keys(table.commands),
                });
                separatorMode = mergeSeparatorMode(separatorMode, "space");
            }

            if (parameterCompletions === undefined) {
                // Descriptor has no parameters.  If subcommand
                // alternatives were added above, they are the
                // exhaustive set; otherwise the command is fully
                // specified with nothing more to type.
            } else {
                completions.push(...parameterCompletions.completions);
                startIndex = parameterCompletions.startIndex;
                separatorMode = mergeSeparatorMode(
                    separatorMode,
                    parameterCompletions.separatorMode,
                );
                closedSet = parameterCompletions.closedSet;
                if (parameterCompletions.commitMode === "eager") {
                    commitMode = "eager";
                }
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
            });
            separatorMode = mergeSeparatorMode(
                separatorMode,
                result.parsedAppAgentName !== undefined ||
                    result.commands.length > 0
                    ? "space"
                    : "optional",
            );
        } else {
            // Both table and descriptor are undefined — the agent
            // returned no commands at all.  Nothing to add;
            // completions stays empty, closedSet stays true.
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
                    .filter((name) => context.agents.isCommandEnabled(name)),
            });
            separatorMode = mergeSeparatorMode(separatorMode, "optional");
        }

        const completionResult: CommandCompletionResult = {
            startIndex,
            completions,
            separatorMode,
            closedSet,
            commitMode,
        };

        debug(`Command completion result:`, completionResult);
        return completionResult;
    } catch (e: any) {
        debugError(`Command completion error: ${e}\n${e.stack}`);
        // On error, return a safe default — don't claim closedSet
        // since we don't know what went wrong.
        return {
            startIndex: 0,
            completions: [],
            separatorMode: undefined,
            closedSet: false,
        };
    }
}

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

// Detect whether the last parsed token is a recognized flag name
// awaiting a value.  Pure: returns metadata only, no side effects.
//
//   pendingFlag      — for non-boolean flags: the canonical name
//                       (e.g. "--level") to pass to the agent for
//                       value completions.  undefined for boolean
//                       flags (they default to true and don't pend).
//   booleanFlagName  — for boolean flags: the canonical display name
//                       (e.g. "--debug") so the caller can offer
//                       ["true", "false"].  undefined otherwise.
type PendingFlagInfo = {
    pendingFlag: string | undefined;
    booleanFlagName: string | undefined;
};

function detectPendingFlag(
    params: ParseParamsResult<ParameterDefinitions>,
    flags: FlagDefinitions | undefined,
): PendingFlagInfo {
    if (params.tokens.length === 0 || flags === undefined) {
        return { pendingFlag: undefined, booleanFlagName: undefined };
    }
    const lastToken = params.tokens[params.tokens.length - 1];
    const resolvedFlag = resolveFlag(flags, lastToken);
    if (resolvedFlag === undefined) {
        return { pendingFlag: undefined, booleanFlagName: undefined };
    }
    const type = getFlagType(resolvedFlag[1]);
    if (type === "boolean") {
        return {
            pendingFlag: undefined,
            booleanFlagName: `--${resolvedFlag[0]}`,
        };
    }
    if (type === "json") {
        return { pendingFlag: lastToken, booleanFlagName: undefined };
    }
    return {
        pendingFlag: `--${resolvedFlag[0]}`,
        booleanFlagName: undefined,
    };
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

// ── resolveCompletionTarget ──────────────────────────────────────────────
//
// Pure decision logic: given the parse result, determine *what* to
// complete and *where* the completion attaches.  No I/O, no completion
// building — the caller materialises completions from the target.
//
// Returns:
//   completionNames  — parameter/flag names to ask the agent about.
//   startIndex       — index into `input` where the completion region
//                       begins (before any grammar matchedPrefixLength
//                       override).
//   tokenStartIndex  — raw position of the last token's first character,
//                       used by the caller to apply matchedPrefixLength
//                       arithmetic.  Equal to startIndex when no token is
//                       being edited (next-param / remainder modes).
//   isPartialValue   — true when the user is mid-edit on a free-form
//                       parameter value (string arg or string flag value).
//                       When true and no agent is invoked, closedSet is
//                       false because any text is valid.  False for
//                       enumerable completions (flag names, nextArgs)
//                       even when startIndex points at the current token.
//   includeFlags     — true when the caller should add flag-name
//                       completions via collectFlags.
//   booleanFlagName  — when non-undefined, the caller should add
//                       ["true","false"] completions for this flag.
type CompletionTarget = {
    completionNames: string[];
    startIndex: number;
    tokenStartIndex: number;
    isPartialValue: boolean;
    includeFlags: boolean;
    booleanFlagName: string | undefined;
};

function resolveCompletionTarget(
    params: ParseParamsResult<ParameterDefinitions>,
    flags: FlagDefinitions | undefined,
    input: string,
    hasTrailingSpace: boolean,
): CompletionTarget {
    const remainderIndex = input.length - params.remainderLength;

    // ── Pending flag detection ───────────────────────────────────────
    const { pendingFlag, booleanFlagName } = detectPendingFlag(params, flags);

    // ── Spec case 2: partial parse (remainderLength > 0) ────────────
    // Parsing stopped partway.  Offer what can follow the longest
    // valid prefix.
    if (params.remainderLength > 0) {
        const startIndex = tokenBoundary(input, remainderIndex);
        return {
            completionNames: [...params.nextArgs],
            startIndex,
            tokenStartIndex: startIndex,
            isPartialValue: false,
            includeFlags: true,
            booleanFlagName,
        };
    }

    // ── Spec case 3: full parse (remainderLength === 0) ─────────────
    const { tokens, lastCompletableParam, lastParamImplicitQuotes } = params;

    // ── Spec case 3a: user is still editing the last token ──────

    // 3a-i: free-form parameter value.  lastCompletableParam is set
    // only for string-type params — the only type whose partial text
    // is meaningful for prefix-match completion.
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
            const tokenStartIndex = remainderIndex - valueToken.length;
            const startIndex = tokenBoundary(input, tokenStartIndex);
            return {
                completionNames: [lastCompletableParam],
                startIndex,
                tokenStartIndex,
                isPartialValue: true,
                includeFlags: false,
                booleanFlagName: undefined,
            };
        }
    }

    // 3a-ii: uncommitted flag name.  A recognized flag was consumed
    // but the user hasn't typed a trailing space — they might still
    // change their mind (e.g. replace "--level" with "--debug").
    // Back up to the flag token's start and offer flag names.
    // isPartialValue is false: flag names are an enumerable set.
    if (pendingFlag !== undefined && !hasTrailingSpace) {
        const flagToken = tokens[tokens.length - 1];
        const flagTokenStart = remainderIndex - flagToken.length;
        const startIndex = tokenBoundary(input, flagTokenStart);
        return {
            completionNames: [],
            startIndex,
            tokenStartIndex: startIndex,
            isPartialValue: false,
            includeFlags: true,
            booleanFlagName,
        };
    }

    // ── Spec case 3b: last token committed, complete next ───────
    const startIndex = tokenBoundary(input, remainderIndex);
    if (pendingFlag !== undefined && hasTrailingSpace) {
        // Flag awaiting a value and the user committed with a space.
        return {
            completionNames: [pendingFlag],
            startIndex,
            tokenStartIndex: startIndex,
            isPartialValue: false,
            includeFlags: false,
            booleanFlagName: undefined,
        };
    }
    return {
        completionNames: [...params.nextArgs],
        startIndex,
        tokenStartIndex: startIndex,
        isPartialValue: false,
        includeFlags: true,
        booleanFlagName,
    };
}

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
//    a. The user is still editing the last token — return startIndex
//       at the *beginning* of that token:
//
//       i.  Free-form parameter value (lastCompletableParam is set):
//           triggered when the token is partially quoted, uses
//           implicitQuotes, or is a bare unquoted token with no
//           trailing space.  Completions come from the agent for
//           that parameter.
//
//       ii. Uncommitted flag name (pendingFlag with no trailing
//           space): the flag was recognized but the user hasn't
//           committed it.  Offer flag names so the user can change
//           their choice.
//
//    b. Otherwise — the last token has been committed (trailing space
//       present, or fully quoted).  Return startIndex at the *end* of
//       the last token (excluding trailing space) and offer completions
//       for the next parameters.
//
// ── Exceptions to case 3a ────────────────────────────────────────────────
//
// Case 3a depends on lastCompletableParam (for 3a-i) and pendingFlag
// (for 3a-ii).  parseParams only sets lastCompletableParam for
// *string*-type parameters: number, boolean, and json params leave it
// undefined.  This means the following scenarios fall through to 3b
// even though the user has not typed a trailing space:
//
//   • A number arg without trailing space    (e.g. "cmd 42")
//   • A boolean arg without trailing space   (e.g. "cmd true")
//   • A number flag value without trailing space (e.g. "cmd --level 5")
//
// In these cases startIndex stays at the end of the last token and
// completions describe what comes *next* rather than the current
// token.  This is acceptable because non-string values are not
// meaningful targets for prefix-match completion — there is no useful
// set of candidates to filter against a partial "42" or "tru".  The
// caller's trie will see an empty suffix (startIndex == input.length)
// and present the next-parameter completions unfiltered, which is the
// most useful behavior for the user.
//
async function getCommandParameterCompletion(
    descriptor: CommandDescriptor,
    context: CommandHandlerContext,
    result: ResolveCommandResult,
    input: string,
    hasTrailingSpace: boolean,
): Promise<ParameterCompletionResult | undefined> {
    if (typeof descriptor.parameters !== "object") {
        return undefined;
    }
    const params: ParseParamsResult<ParameterDefinitions> = parseParams(
        result.suffix,
        descriptor.parameters,
        true,
    );

    // ── 1. Decide what to complete and where ─────────────────────────
    const target = resolveCompletionTarget(
        params,
        descriptor.parameters.flags,
        input,
        hasTrailingSpace,
    );
    let { startIndex } = target;
    debug(
        `Command completion parameter consumed length: ${params.remainderLength}`,
    );

    // ── 2. Materialise built-in completions from the target ──────────
    const completions: CompletionGroup[] = [];
    if (target.booleanFlagName !== undefined) {
        completions.push({
            name: target.booleanFlagName,
            completions: ["true", "false"],
        });
    }
    if (target.includeFlags && descriptor.parameters.flags !== undefined) {
        const flagCompletions = collectFlags(
            target.completionNames,
            descriptor.parameters.flags,
            params.flags,
        );
        if (flagCompletions.length > 0) {
            completions.push({
                name: "Command Flags",
                completions: flagCompletions,
            });
        }
    }

    // ── 3. Invoke agent (if available) ───────────────────────────────
    // Note: collectFlags (above) mutates target.completionNames as a
    // side effect, appending "--key." entries for JSON property flags.
    // This must happen before the agent call so the agent sees the
    // full list of names to complete.
    let agentInvoked = false;
    let agentClosedSet: boolean | undefined;
    let agentCommitMode: CommitMode | undefined;
    let separatorMode: SeparatorMode | undefined;

    const agent = context.agents.getAppAgent(result.actualAppAgentName);
    if (agent.getCommandCompletion && target.completionNames.length > 0) {
        const agentName = result.actualAppAgentName;
        const sessionContext = context.agents.getSessionContext(agentName);
        debug(
            `Command completion parameter with agent: '${agentName}' with params ${JSON.stringify(target.completionNames)}`,
        );
        const agentResult: CompletionGroups = await agent.getCommandCompletion(
            result.commands,
            params,
            target.completionNames,
            sessionContext,
        );

        // Allow grammar-reported matchedPrefixLength to override
        // the parse-derived startIndex.  This handles CJK and other
        // non-space-delimited scripts where the grammar matcher is
        // the authoritative source for how far into the input it
        // consumed.  matchedPrefixLength is relative to the token
        // content start, so add it to tokenStartIndex.
        const groupPrefixLength = agentResult.matchedPrefixLength;
        if (groupPrefixLength !== undefined && groupPrefixLength !== 0) {
            startIndex = target.tokenStartIndex + groupPrefixLength;
            completions.length = 0; // grammar overrides built-in completions
        }
        completions.push(...agentResult.groups);
        separatorMode = agentResult.separatorMode;
        agentInvoked = true;
        agentClosedSet = agentResult.closedSet;
        agentCommitMode = agentResult.commitMode;
        debug(
            `Command completion parameter with agent: groupPrefixLength=${groupPrefixLength}, startIndex=${startIndex}, tokenStartIndex=${target.tokenStartIndex}`,
        );
    }

    // ── 4. Determine closedSet ───────────────────────────────────────
    let closedSet: boolean;
    if (agentInvoked) {
        closedSet = agentClosedSet ?? false;
    } else if (target.isPartialValue) {
        // Editing a free-form value with no agent → open set.
        closedSet = false;
    } else {
        // No agent.  Closed when all positional args are filled and
        // only flags (a finite set) remain.
        closedSet = params.nextArgs.length === 0;
    }

    return {
        completions,
        startIndex,
        separatorMode,
        closedSet,
        commitMode: agentCommitMode,
    };
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

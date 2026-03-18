// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandHandlerContext } from "../context/commandHandlerContext.js";

import {
    CommandDescriptor,
    CompletionDirection,
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

// True when text[0..index) ends with whitespace — i.e., the user
// has typed a trailing separator after the last token.  A trailing
// separator acts as a commit signal: the token before it is
// considered committed and the separator itself is consumed, so
// startIndex should include it and separatorMode should be
// "optional" (no additional separator needed).
function hasTrailingSpace(text: string, index: number): boolean {
    return index > 0 && /\s/.test(text[index - 1]);
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

// True when the user is mid-edit on a free-form parameter value:
//   - partially quoted (opening quote, no closing)
//   - implicitQuotes parameter (rest-of-line)
//   - input has no trailing whitespace and no pending flag
function isEditingFreeFormValue(
    quoted: boolean | undefined,
    implicitQuotes: boolean,
    inputEndsMidToken: boolean,
    pendingFlag: string | undefined,
): boolean {
    if (quoted === false) return true; // partially quoted
    if (quoted !== undefined) return false; // fully quoted → committed
    return implicitQuotes || (inputEndsMidToken && pendingFlag === undefined);
}

// Determine closedSet for parameter completion:
//   - Agent is authoritative when invoked.
//   - Free-form text with no agent → open set (anything is valid).
//   - No agent and all positional args filled → only flags remain (finite set).
function computeClosedSet(
    agentInvoked: boolean,
    agentClosedSet: boolean | undefined,
    isPartialValue: boolean,
    hasRemainingArgs: boolean,
): boolean {
    if (agentInvoked) return agentClosedSet ?? false;
    if (isPartialValue) return false;
    return !hasRemainingArgs;
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
type ParameterCompletionResult = CommandCompletionResult;

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
//                       override).  Also used by the caller to apply
//                       matchedPrefixLength arithmetic.
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
//   separatorMode    — when set, the caller should use this as the
//                       base separator mode (before merging with
//                       agent-reported modes).  "optional" when
//                       trailing whitespace was consumed by startIndex.
type CompletionTarget = {
    completionNames: string[];
    startIndex: number;
    isPartialValue: boolean;
    includeFlags: boolean;
    booleanFlagName: string | undefined;
    separatorMode: SeparatorMode | undefined;
    directionSensitive: boolean;
};

function resolveCompletionTarget(
    params: ParseParamsResult<ParameterDefinitions>,
    flags: FlagDefinitions | undefined,
    input: string,
    direction: CompletionDirection,
): CompletionTarget {
    const remainderIndex = input.length - params.remainderLength;

    // ── Pending flag detection ───────────────────────────────────────
    const { pendingFlag, booleanFlagName } = detectPendingFlag(params, flags);

    // ── Spec case 2: partial parse (remainderLength > 0) ────────────
    // Parsing stopped partway.  Offer what can follow the longest
    // valid prefix.
    if (params.remainderLength > 0) {
        return {
            completionNames: [...params.nextArgs],
            startIndex: remainderIndex,
            isPartialValue: false,
            includeFlags: true,
            booleanFlagName,
            separatorMode: hasTrailingSpace(input, remainderIndex)
                ? "optional"
                : undefined,
            directionSensitive: false,
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
            isEditingFreeFormValue(
                quoted,
                lastParamImplicitQuotes,
                !/\s$/.test(input), // true when input ends mid-token (no trailing space)
                pendingFlag,
            )
        ) {
            const startIndex = remainderIndex - valueToken.length;
            return {
                completionNames: [lastCompletableParam],
                startIndex,
                isPartialValue: true,
                includeFlags: false,
                booleanFlagName: undefined,
                separatorMode: hasTrailingSpace(input, startIndex)
                    ? "optional"
                    : undefined,
                directionSensitive: false,
            };
        }
    }

    // 3a-ii: reconsidering flag name.  A recognized flag was consumed
    // but the user is backing up (direction="backward") — they
    // want to reconsider their choice (e.g. replace "--level" with
    // "--debug").  Back up to the flag token's start and offer flag
    // names.  isPartialValue is false: flag names are an enumerable
    // set.
    //
    // Trailing space commits the flag — direction no longer matters.
    // When the user typed "--level " (with space), they've moved on;
    // fall through to 3b for value completions regardless of direction.
    const trailingSpace = hasTrailingSpace(input, remainderIndex);
    if (
        pendingFlag !== undefined &&
        direction === "backward" &&
        !trailingSpace
    ) {
        const flagToken = tokens[tokens.length - 1];
        const flagTokenStart = remainderIndex - flagToken.length;
        return {
            completionNames: [],
            startIndex: flagTokenStart,
            isPartialValue: false,
            includeFlags: true,
            booleanFlagName,
            separatorMode: hasTrailingSpace(input, flagTokenStart)
                ? "optional"
                : undefined,
            directionSensitive: true,
        };
    }

    // ── Spec case 3b: last token committed, complete next ───────
    // startIndex is the raw position — includes any trailing
    // whitespace that the user typed.  When trailing whitespace is
    // present, separatorMode becomes "optional" because the space
    // is already consumed.
    if (pendingFlag !== undefined) {
        // Flag awaiting a value — either the user moved forward or
        // trailing space committed the flag (direction doesn't matter).
        return {
            completionNames: [pendingFlag],
            startIndex: remainderIndex,
            isPartialValue: false,
            includeFlags: false,
            booleanFlagName: undefined,
            separatorMode: trailingSpace ? "optional" : undefined,
            directionSensitive: !trailingSpace,
        };
    }
    return {
        completionNames: [...params.nextArgs],
        startIndex: remainderIndex,
        isPartialValue: false,
        includeFlags: true,
        booleanFlagName,
        separatorMode: trailingSpace ? "optional" : undefined,
        directionSensitive: false,
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
//           implicitQuotes, or input has no trailing whitespace
//           with no pending flag.  Completions come from the agent
//           for that parameter.
//
//       ii. Reconsidering flag name (pendingFlag with direction=
//           "backward"): the flag was recognized but the user backed
//           up to reconsider.  Offer flag names so the user can
//           change their choice.
//
//    b. Otherwise — the last token is complete (direction="forward",
//       fully quoted, or trailing whitespace).  Return startIndex
//       at the *end* of the consumed input (including any trailing
//       space) and offer completions for the next parameters.  When
//       trailing whitespace is present, separatorMode is "optional"
//       because the space is already consumed.
//
// ── Exceptions to case 3a ────────────────────────────────────────────────
//
// Case 3a depends on lastCompletableParam (for 3a-i) and pendingFlag
// (for 3a-ii).  parseParams only sets lastCompletableParam for
// *string*-type parameters: number, boolean, and json params leave it
// undefined.  This means the following scenarios fall through to 3b
// even when direction="forward":
//
//   • A number arg being edited             (e.g. "cmd 42")
//   • A boolean arg being edited            (e.g. "cmd true")
//   • A number flag value being edited       (e.g. "cmd --level 5")
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
    direction: CompletionDirection,
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
        direction,
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
    let separatorMode: SeparatorMode | undefined = target.separatorMode;
    let directionSensitive = false;

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
            direction,
        );

        // Allow grammar-reported matchedPrefixLength to override
        // the parse-derived startIndex.  This handles CJK and other
        // non-space-delimited scripts where the grammar matcher is
        // the authoritative source for how far into the input it
        // consumed.  matchedPrefixLength is relative to the token
        // content start, so add it to target.startIndex.

        const groupPrefixLength = agentResult.matchedPrefixLength;
        if (groupPrefixLength !== undefined && groupPrefixLength !== 0) {
            startIndex = target.startIndex + groupPrefixLength;
            completions.length = 0; // grammar overrides built-in completions
            // The agent advanced the prefix — it is authoritative for
            // the separator at this position.
            separatorMode = agentResult.separatorMode;
        }
        completions.push(...agentResult.groups);
        agentInvoked = true;
        agentClosedSet = agentResult.closedSet;
        // Default: direction-sensitive when agent consumed input
        // (matchedPrefixLength > 0), not sensitive otherwise.
        directionSensitive =
            agentResult.directionSensitive ??
            (groupPrefixLength !== undefined && groupPrefixLength > 0);
        debug(
            `Command completion parameter with agent: groupPrefixLength=${groupPrefixLength}, startIndex=${startIndex}`,
        );
    }

    return {
        completions,
        startIndex,
        separatorMode,
        closedSet: computeClosedSet(
            agentInvoked,
            agentClosedSet,
            target.isPartialValue,
            params.nextArgs.length > 0,
        ),
        directionSensitive: target.directionSensitive || directionSensitive,
    };
}

// Complete a resolved command descriptor: parameter completions plus
// optional sibling subcommand names from the parent table.
async function completeDescriptor(
    descriptor: CommandDescriptor,
    context: CommandHandlerContext,
    result: ResolveCommandResult,
    input: string,
    direction: CompletionDirection,
    commandConsumedLength: number,
): Promise<{
    completions: CompletionGroup[];
    startIndex: number | undefined;
    separatorMode: SeparatorMode | undefined;
    closedSet: boolean;
    directionSensitive: boolean;
}> {
    const completions: CompletionGroup[] = [];
    let separatorMode: SeparatorMode | undefined;

    const parameterCompletions = await getCommandParameterCompletion(
        descriptor,
        context,
        result,
        input,
        direction,
    );

    // Include sibling subcommand names when resolved to the default
    // (not an explicit match), but only if parameter parsing hasn't
    // consumed past the command boundary.  Once the user has typed
    // tokens that fill parameters (moving startIndex forward),
    // they've committed to the default — subcommand names would be
    // filtered against the wrong text at the wrong position.
    const table = result.table;
    const addSubcommands =
        table !== undefined &&
        !result.matched &&
        getDefaultSubCommandDescriptor(table) === descriptor &&
        (parameterCompletions === undefined ||
            parameterCompletions.startIndex <= commandConsumedLength);

    if (addSubcommands) {
        completions.push({
            name: "Subcommands",
            completions: Object.keys(table!.commands),
        });
        separatorMode = mergeSeparatorMode(separatorMode, "space");
    }

    if (parameterCompletions === undefined) {
        return {
            completions,
            startIndex: undefined,
            separatorMode,
            closedSet: true,
            directionSensitive: false,
        };
    }

    completions.push(...parameterCompletions.completions);
    return {
        completions,
        startIndex: parameterCompletions.startIndex,
        separatorMode: mergeSeparatorMode(
            separatorMode,
            parameterCompletions.separatorMode,
        ),
        closedSet: parameterCompletions.closedSet,
        directionSensitive: parameterCompletions.directionSensitive,
    };
}

//
// ── getCommandCompletion contract ────────────────────────────────────────────
//
// Given a partial user input string and a direction hint from the host,
// returns the longest valid prefix, available completions from that point,
// and metadata about how they attach.
//
// The `direction` parameter resolves structural ambiguity when the
// input is fully valid:
//   "forward"  — the user is moving forward (appending characters, typed
//                a separator, selected a menu item).  Proceed to what
//                follows the current position.
//   "backward" — the user is backing up (backspaced/deleted).  Reconsider
//                the current position, e.g. offer alternative commands
//                or flag names.
//
// Direction is only consulted at structural ambiguity points — where
// the input is valid but could mean either "stay at this level" or
// "advance to the next level".  For free-form parameter values,
// the input's trailing whitespace is used instead (no ambiguity to
// resolve; trailing space means the token is complete).
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
//   completions  Array of CompletionGroup items from up to three sources:
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
//                no other valid input exists.
//
export async function getCommandCompletion(
    input: string,
    direction: CompletionDirection,
    context: CommandHandlerContext,
): Promise<CommandCompletionResult> {
    try {
        debug(`Command completion start ${direction}: '${input}'`);

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
        let startIndex = commandConsumedLength;

        // Collect completions and track separatorMode across all sources.
        // When trailing whitespace was consumed *and* nothing follows
        // (suffix is empty), separatorMode starts at "optional" — the
        // space is already part of the anchor so no additional separator
        // is needed.  When a suffix exists (e.g. "--off"), the space
        // before it is structural, not trailing.
        const completions: CompletionGroup[] = [];
        let separatorMode: SeparatorMode | undefined =
            result.suffix.length === 0 &&
            hasTrailingSpace(input, commandConsumedLength)
                ? "optional"
                : undefined;
        let closedSet = true;
        // Track whether direction influenced the result.  When false,
        // the caller can skip re-fetching on direction change.
        let directionSensitive = false;

        const descriptor = result.descriptor;

        // When the last command token was exactly matched but the
        // user is backing up (direction="backward"), they want to
        // reconsider the command choice.  Offer subcommand alternatives
        // at that token's position instead of proceeding to parameter
        // completions.
        //
        // However, when normalizeCommand inserts implicit tokens
        // (e.g. prepending the default agent and default subcommand
        // for empty input), those tokens are inherently committed —
        // the user never typed them.  Detect this by checking whether
        // the normalized command ends with whitespace, which indicates
        // the resolver already considers the last token committed.
        const normalizedCommitted = /\s$/.test(partialCommand);
        // Direction matters at the command level when the command is
        // exactly matched and could be either "committed to" (forward)
        // or "reconsidered" (backward).
        const directionSensitiveCommand =
            descriptor !== undefined &&
            result.matched &&
            !normalizedCommitted &&
            result.suffix === "" &&
            table !== undefined;
        const reconsideringCommand =
            directionSensitiveCommand && direction === "backward";

        if (reconsideringCommand) {
            const lastCmd = result.commands[result.commands.length - 1];
            startIndex = commandConsumedLength - lastCmd.length;
            completions.push({
                name: "Subcommands",
                completions: Object.keys(table!.commands),
            });
            separatorMode = mergeSeparatorMode(separatorMode, "none");
            directionSensitive = true;
            // closedSet stays true: subcommand names are exhaustive.
        } else if (descriptor !== undefined) {
            const desc = await completeDescriptor(
                descriptor,
                context,
                result,
                input,
                direction,
                commandConsumedLength,
            );
            completions.push(...desc.completions);
            if (desc.startIndex !== undefined) {
                startIndex = desc.startIndex;
            }
            separatorMode = mergeSeparatorMode(
                separatorMode,
                desc.separatorMode,
            );
            closedSet = desc.closedSet;
            // Direction-sensitive if the command level is (would have
            // taken the reconsideringCommand branch with opposite
            // direction) or if the agent/parameter level is.
            directionSensitive =
                directionSensitiveCommand || desc.directionSensitive;
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

        if (startIndex === 0) {
            // It is the first token, add "@" for the command prefix
            completions.push({
                name: "Command Prefixes",
                completions: ["@"],
            });

            // The first token doesn't require separator before it
            separatorMode = "optional";
        }
        const completionResult: CommandCompletionResult = {
            startIndex,
            completions,
            separatorMode,
            closedSet,
            directionSensitive,
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
            directionSensitive: false,
        };
    }
}

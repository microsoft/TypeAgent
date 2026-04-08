// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Architecture: docs/architecture/completion.md — §4 Dispatcher

import { CommandHandlerContext } from "../context/commandHandlerContext.js";

import {
    CommandDescriptor,
    CompletionDirection,
    FlagDefinitions,
    ParameterDefinitions,
    CompletionGroup,
    CompletionGroups,
    SeparatorMode,
    AfterWildcard,
} from "@typeagent/agent-sdk";
import {
    getFlagMultiple,
    getFlagType,
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

// Returns the separatorMode implied by the position in the input.
// When the position is 0 (beginning of input) or preceded by
// whitespace, the separator is already satisfied → "optionalSpace".
// Otherwise returns undefined — callers treat undefined as "separator
// not yet present" and leave the group's own separatorMode intact
// (which defaults to "space" per the CompletionGroup contract).
function inferSeparatorMode(
    text: string,
    index: number,
): "optionalSpace" | undefined {
    return index === 0 || /\s/.test(text[index - 1])
        ? "optionalSpace"
        : undefined;
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
//                       agent-reported modes).  "optionalSpace" when
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

    // ── Spec case 1: partial parse (remainderLength > 0) ────────────
    // Parsing stopped partway.  Offer what can follow the longest
    // valid prefix.
    if (params.remainderLength > 0) {
        return {
            completionNames: [...params.nextArgs],
            startIndex: remainderIndex,
            isPartialValue: false,
            includeFlags: true,
            booleanFlagName,
            separatorMode: inferSeparatorMode(input, remainderIndex),
            directionSensitive: false,
        };
    }

    // ── Spec case 2: full parse (remainderLength === 0) ─────────────
    const { tokens, lastCompletableParam, lastParamImplicitQuotes } = params;

    // ── Spec case 2a: user is still editing the last token ──────

    // 2a-i: free-form parameter value.  lastCompletableParam is set
    // only for string-type params — the only type whose partial text
    // is meaningful for prefix-match completion.
    if (lastCompletableParam !== undefined && tokens.length > 0) {
        const valueToken = tokens[tokens.length - 1];
        const quoted = isFullyQuoted(valueToken);
        if (
            isEditingFreeFormValue(
                quoted,
                lastParamImplicitQuotes,
                !/\s$/.test(input), // true when input ends mid-token (no trailing whitespace)
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
                separatorMode: inferSeparatorMode(input, startIndex),
                directionSensitive: false,
            };
        }
    }

    // 2a-ii: reconsidering flag name.  A recognized flag was consumed
    // but the user is backing up (direction="backward") — they
    // want to reconsider their choice (e.g. replace "--level" with
    // "--debug").  Back up to the flag token's start and offer flag
    // names.  isPartialValue is false: flag names are an enumerable
    // set.
    //
    // Trailing whitespace commits the flag — direction no longer matters.
    // When the user typed "--level " (with whitespace), they've moved on;
    // fall through to 2b for value completions regardless of direction.
    const trailingSepMode = inferSeparatorMode(input, remainderIndex);
    if (
        pendingFlag !== undefined &&
        direction === "backward" &&
        trailingSepMode === undefined
    ) {
        const flagToken = tokens[tokens.length - 1];
        const flagTokenStart = remainderIndex - flagToken.length;
        return {
            completionNames: [],
            startIndex: flagTokenStart,
            isPartialValue: false,
            includeFlags: true,
            booleanFlagName,
            separatorMode: inferSeparatorMode(input, flagTokenStart),
            directionSensitive: true,
        };
    }

    // ── Spec case 2b: last token committed, complete next ───────
    // startIndex is the raw position — includes any trailing
    // whitespace that the user typed.  When trailing whitespace is
    // present, separatorMode becomes "optionalSpace" because the
    // whitespace is already consumed.
    if (pendingFlag !== undefined) {
        // Flag awaiting a value — either the user moved forward or
        // trailing whitespace committed the flag (direction doesn't matter).
        return {
            completionNames: [pendingFlag],
            startIndex: remainderIndex,
            isPartialValue: false,
            includeFlags: false,
            booleanFlagName: undefined,
            separatorMode: trailingSepMode,
            directionSensitive: trailingSepMode === undefined,
        };
    }
    return {
        completionNames: [...params.nextArgs],
        startIndex: remainderIndex,
        isPartialValue: false,
        includeFlags: true,
        booleanFlagName,
        separatorMode: trailingSepMode,
        directionSensitive: false,
    };
}

// Complete parameter values and flags for an already-resolved command
// descriptor.  Returns undefined when the descriptor declares no
// parameters (the caller decides whether sibling subcommands suffice).
//
// ── Spec ──────────────────────────────────────────────────────────────────
//
// 1. If parsing did NOT consume all input (remainderLength > 0):
//    → startIndex = position after the longest valid prefix.
//    → Offer completions for whatever can validly follow that prefix
//      (next positional args, flag names).
//
// 2. If parsing consumed all input (remainderLength === 0):
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
//       whitespace) and offer completions for the next parameters.
//       When trailing whitespace is present, separatorMode is
//       "optionalSpace" because the whitespace is already consumed.
//
// ── Exceptions to case 2a ────────────────────────────────────────────────
//
// Case 2a depends on lastCompletableParam (for 2a-i) and pendingFlag
// (for 2a-ii).  parseParams only sets lastCompletableParam for
// *string*-type parameters: number, boolean, and json params leave it
// undefined.  This means the following scenarios fall through to 2b
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
            separatorMode: target.separatorMode,
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
                separatorMode: target.separatorMode,
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
    let directionSensitive = false;
    let afterWildcard: AfterWildcard = "none";

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
        } else {
            // Override separatorMode if matchedPrefixLength is undefined or zero.
            // Intentionally mutates the agent's group objects in-place — the
            // groups are single-use results from the agent callback and are
            // not retained by the agent.
            for (const group of agentResult.groups) {
                if (
                    group.separatorMode === "autoSpacePunctuation" ||
                    group.separatorMode === "spacePunctuation" ||
                    group.separatorMode === "optionalSpacePunctuation"
                ) {
                    group.separatorMode =
                        target.separatorMode === "optionalSpace"
                            ? "optionalSpacePunctuation"
                            : "spacePunctuation";
                } else {
                    group.separatorMode = target.separatorMode;
                }
            }
        }
        completions.push(...agentResult.groups);
        agentInvoked = true;
        agentClosedSet = agentResult.closedSet;
        // Default: direction-sensitive when agent consumed input
        // (matchedPrefixLength > 0), not sensitive otherwise.
        directionSensitive =
            agentResult.directionSensitive ??
            (groupPrefixLength !== undefined && groupPrefixLength > 0);
        afterWildcard = agentResult.afterWildcard ?? "none";
        debug(
            `Command completion parameter with agent: groupPrefixLength=${groupPrefixLength}, startIndex=${startIndex}`,
        );
    }

    return {
        completions,
        startIndex,
        closedSet: computeClosedSet(
            agentInvoked,
            agentClosedSet,
            target.isPartialValue,
            params.nextArgs.length > 0,
        ),
        directionSensitive: target.directionSensitive || directionSensitive,
        afterWildcard,
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
    closedSet: boolean;
    directionSensitive: boolean;
    afterWildcard: AfterWildcard;
}> {
    const completions: CompletionGroup[] = [];

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
            separatorMode: "optionalSpace",
        });
    }

    if (parameterCompletions === undefined) {
        return {
            completions,
            startIndex: undefined,
            closedSet: true,
            directionSensitive: false,
            afterWildcard: "none",
        };
    }

    completions.push(...parameterCompletions.completions);
    return {
        completions,
        startIndex: parameterCompletions.startIndex,
        closedSet: parameterCompletions.closedSet,
        directionSensitive: parameterCompletions.directionSensitive,
        afterWildcard: parameterCompletions.afterWildcard,
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
// resolve; trailing whitespace means the token is complete).
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
//                Each CompletionGroup carries its own separatorMode
//                describing what separator is required before that
//                group's completions.
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

        const completions: CompletionGroup[] = [];
        let closedSet = true;
        // Track whether direction influenced the result.  When false,
        // the caller can skip re-fetching on direction change.
        let directionSensitive = false;
        let afterWildcard: AfterWildcard = "none";

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
        const implicitlyCommitted = /\s$/.test(partialCommand);
        // Direction matters at the command level when the command is
        // exactly matched and could be either "committed to" (forward)
        // or "reconsidered" (backward).
        const directionSensitiveCommand =
            descriptor !== undefined &&
            result.matched &&
            !implicitlyCommitted &&
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
                separatorMode: "optionalSpace",
            });
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
            closedSet = desc.closedSet;
            // Direction-sensitive if the command level is (would have
            // taken the reconsideringCommand branch with opposite
            // direction) or if the agent/parameter level is.
            directionSensitive =
                directionSensitiveCommand || desc.directionSensitive;
            afterWildcard = desc.afterWildcard;
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
                separatorMode:
                    result.parsedAppAgentName !== undefined ||
                    result.commands.length > 0
                        ? "space"
                        : "optionalSpace",
            });
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
                separatorMode: "optionalSpace",
            });
        }

        if (startIndex === 0) {
            // It is the first token, add "@" for the command prefix
            completions.push({
                name: "Command Prefixes",
                completions: ["@"],
                separatorMode: "optionalSpace",
            });
        }
        const completionResult: CommandCompletionResult = {
            startIndex,
            completions,
            closedSet,
            directionSensitive,
            afterWildcard,
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
            closedSet: false,
            directionSensitive: false,
            afterWildcard: "none",
        };
    }
}

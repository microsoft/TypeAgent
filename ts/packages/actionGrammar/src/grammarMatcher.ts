// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CompiledSpacingMode, CompiledValueNode } from "./grammarTypes.js";
import registerDebug from "debug";
// REVIEW: switch to RegExp.escape() when it becomes available.
import escapeMatch from "regexp.escape";
import {
    Grammar,
    GrammarPart,
    RulesPart,
    StringPart,
    VarNumberPart,
    VarStringPart,
} from "./grammarTypes.js";

// Separator mode for completion results.  Structurally identical to
// SeparatorMode from @typeagent/agent-sdk; independently defined here so
// actionGrammar does not depend on agentSdk.  The grammar matcher only
// produces "spacePunctuation", "optional", and "none" — never "space"
// (which is strictly command/flag-level).
type SeparatorMode = "space" | "spacePunctuation" | "optional" | "none";

const debugMatchRaw = registerDebug("typeagent:grammar:match");
const debugCompletion = registerDebug("typeagent:grammar:completion");

// Treats spaces and punctuation as word separators
const separatorRegExpStr = "\\s\\p{P}";
const separatorRegExp = new RegExp(`[${separatorRegExpStr}]+`, "yu");
const wildcardTrimRegExp = new RegExp(
    `[${separatorRegExpStr}]*([^${separatorRegExpStr}](?:.*[^${separatorRegExpStr}])?)[${separatorRegExpStr}]*$`,
    "yu",
);

// Scripts that use explicit word-space boundaries (Latin, Cyrillic, Greek,
// Armenian, Georgian, Hangul, Arabic, Hebrew, Devanagari, Bengali, Tamil,
// Telugu, Kannada, Malayalam, Gujarati, Gurmukhi, Oriya, Sinhala, Ethiopic,
// Mongolian). In "auto" mode, a separator is required between two adjacent
// characters only when BOTH belong to one of these scripts. Unknown/unlisted
// scripts (e.g. CJK) default to no separator needed.
const wordBoundaryScriptRe =
    /\p{Script=Latin}|\p{Script=Cyrillic}|\p{Script=Greek}|\p{Script=Armenian}|\p{Script=Georgian}|\p{Script=Hangul}|\p{Script=Arabic}|\p{Script=Hebrew}|\p{Script=Devanagari}|\p{Script=Bengali}|\p{Script=Tamil}|\p{Script=Telugu}|\p{Script=Kannada}|\p{Script=Malayalam}|\p{Script=Gujarati}|\p{Script=Gurmukhi}|\p{Script=Oriya}|\p{Script=Sinhala}|\p{Script=Ethiopic}|\p{Script=Mongolian}/u;

// Decimal digits are not part of any word-space script, but two adjacent
// digit characters must still be separated: "123456" is a different token from
// "123 456", so concatenating two digit segments without a separator is ambiguous.
const digitRe = /[0-9]/;

// In auto mode (undefined), a separator is required between two segments only
// if both adjacent characters belong to a word-boundary script. This allows users
// to omit separators when the scripts differ (e.g. Latin followed by CJK),
// while still requiring them when both sides use word spaces
// (e.g. Latin followed by Latin).
function isWordBoundaryScript(c: string): boolean {
    // Fast path: all ASCII characters are handled here without the regex.
    // ASCII letters are Latin-script (boundary required).
    // ASCII digits, punctuation, and space return false
    // (digits are handled separately by digitRe, punctuation/space never need a boundary).
    const code = c.charCodeAt(0);
    if (code < 128) {
        return (code >= 65 && code <= 90) || (code >= 97 && code <= 122); // A-Z, a-z
    }
    return wordBoundaryScriptRe.test(c);
}
export function needsSeparatorInAutoMode(a: string, b: string): boolean {
    if (digitRe.test(a) && digitRe.test(b)) {
        return true;
    }
    return isWordBoundaryScript(a) && isWordBoundaryScript(b);
}
function requiresSeparator(
    a: string,
    b: string,
    mode: CompiledSpacingMode,
): boolean {
    switch (mode) {
        case "required":
            return true;
        case "optional":
            return false;
        case "none":
            // "none" mode is handled directly by the caller (matchStringPart
            // short-circuits with an empty separator string).  If we ever
            // reach this branch it indicates a logic error.
            throw new Error(
                "Internal error: requiresSeparator should not be called for 'none' mode",
            );
        case undefined: // auto
            return needsSeparatorInAutoMode(a, b);
    }
}

// Convert a per-candidate (needsSep, spacingMode) pair into a
// SeparatorMode value.  When needsSep is true (separator required),
// the grammar always uses spacePunctuation separators.
// When needsSep is false: "none" spacingMode → "none", otherwise
// → "optional" (covers auto mode/CJK/mixed and explicit "optional").
function candidateSeparatorMode(
    needsSep: boolean,
    spacingMode: CompiledSpacingMode,
): SeparatorMode {
    if (needsSep) {
        return "spacePunctuation";
    }
    if (spacingMode === "none") {
        return "none";
    }
    return "optional";
}

// Merge a new candidate's separator mode into the running aggregate.
// The mode requiring the strongest separator wins (i.e. the mode that
// demands the most from the user): space > spacePunctuation > optional > none.
function mergeSeparatorMode(
    current: SeparatorMode | undefined,
    needsSep: boolean,
    spacingMode: CompiledSpacingMode,
): SeparatorMode {
    const candidateMode = candidateSeparatorMode(needsSep, spacingMode);
    if (current === undefined) {
        return candidateMode;
    }
    // "space" requires strict whitespace — strongest requirement.
    if (current === "space" || candidateMode === "space") {
        return "space";
    }
    // "spacePunctuation" requires a separator — next strongest.
    if (
        current === "spacePunctuation" ||
        candidateMode === "spacePunctuation"
    ) {
        return "spacePunctuation";
    }
    // "optional" is a stronger requirement than "none".
    if (current === "optional" || candidateMode === "optional") {
        return "optional";
    }
    return "none";
}

function isBoundarySatisfied(
    request: string,
    index: number,
    mode: CompiledSpacingMode,
) {
    if (index === 0 || index === request.length) {
        return true;
    }
    switch (mode) {
        case "required":
            // In "required" mode, the input at `index` must begin with a
            // separator sequence ([\s\p{P}]+).  Separators already consumed
            // *inside* the match pattern (e.g. the infix [\s\p{P}]+ between
            // tokens) do not satisfy this trailing-edge check; one or more
            // separator characters must immediately follow the entire matched
            // phrase in the input.
            separatorRegExp.lastIndex = index;
            return separatorRegExp.test(request);
        case "optional":
        case "none":
            // In both "optional" and "none" modes there is no constraint on
            // the outer boundary.  For top-level "none" rules, leading
            // whitespace is rejected (via leadingSpacingMode) and trailing
            // content is rejected (via finalizeState).  For nested rules,
            // the nearest ancestor with a flex-space boundary — or the
            // top-level rule if none — controls leading/trailing spacing
            // around the nested match (see leadingSpacingMode).  The
            // boundary check itself always passes.
            return true;
        case undefined: // auto: requires a separator only when BOTH characters
            // adjacent to the boundary belong to word-boundary scripts.  If
            // either side is punctuation, CJK, or another no-space script, no
            // separator is required.
            return !needsSeparatorInAutoMode(
                request[index - 1],
                request[index],
            );
    }
}

type MatchedValue =
    | string
    | number
    | undefined
    // Value from nested rule
    | {
          node: CompiledValueNode | undefined;
          valueIds: ValueIdNode | undefined;
      };

type MatchedValueEntry = {
    valueId: number;
    value: MatchedValue;
    wildcard: boolean;
    prev: MatchedValueEntry | undefined;
};

type ValueIdNode = {
    name?: string | undefined;
    valueId: number;
    wildcardTypeName?: string | undefined;
    prev?: ValueIdNode | undefined;
};

type ParentMatchState = {
    name: string; // For debugging
    parts: GrammarPart[];
    value: CompiledValueNode | undefined; // the value to be assigned after finishing the nested rule.
    partIndex: number; // the part index after the nested rule.
    variable: string | undefined;
    valueIds: ValueIdNode | undefined | null; // null means we don't need any value
    parent: ParentMatchState | undefined;
    repeatPartIndex?: number | undefined; // defined for ()* / )+ — holds the part index to loop back to
    spacingMode: CompiledSpacingMode; // parent rule's spacingMode, restored in MatchState on return from nested rule
};

// A wildcard slot awaiting its capture value.  Used on MatchState.pendingWildcard
// and saved across finalizeState calls for backward completion.
type PendingWildcard = {
    readonly start: number;
    readonly valueId: number | undefined;
};

type MatchState = {
    // Current context
    name: string; // For debugging
    parts: GrammarPart[];
    value: CompiledValueNode | undefined; // the value to be assigned after finishing the current rule if the rule has only one part.
    partIndex: number;
    valueIds?: ValueIdNode | undefined | null; // null means we don't need any value

    // Match state
    nextValueId: number;
    values?: MatchedValueEntry | undefined;
    parent?: ParentMatchState | undefined;

    nestedLevel: number; // for debugging

    inRepeat?: boolean | undefined; // true when re-entering a repeat group after a successful match

    spacingMode: CompiledSpacingMode; // active spacing mode for this rule

    index: number;
    pendingWildcard?: PendingWildcard | undefined;

    // Completion support: tracks the last matched non-wildcard part
    // (string or number).  Used by backward completion to back up to
    // the most recently matched item.
    //
    // `afterWildcard` indicates the part was matched via wildcard
    // scanning (matchStringPartWithWildcard / matchVarNumberPartWithWildcard)
    // — i.e., a wildcard preceded this part and the part's position
    // was determined by scanning forward through the wildcard region.
    // When backward backs up to such a part, the position is ambiguous
    // (see openWildcard on GrammarCompletionResult).
    lastMatchedPartInfo?:
        | {
              readonly type: "string";
              readonly start: number;
              readonly part: StringPart;
              readonly afterWildcard: boolean;
          }
        | {
              readonly type: "number";
              readonly start: number;
              readonly valueId: number;
              readonly afterWildcard: boolean;
          }
        | undefined;
};

type GrammarMatchStat = {
    matchedValueCount: number;
    wildcardCharCount: number;
    entityWildcardPropertyNames: string[];
};
export type GrammarMatchResult = GrammarMatchStat & {
    match: unknown;
};

// Non-entity wildcard type names - these should NOT be treated as entity wildcards
const nonEntityWildcardTypes = new Set([
    "string",
    "wildcard",
    "word",
    "number",
]);

function createMatchedValue(
    valueIdNode: ValueIdNode,
    values: MatchedValueEntry | undefined,
    propertyName: string,
    wildcardPropertyNames: string[],
    partialValueId?: number,
    stat?: GrammarMatchStat,
): unknown {
    const { name, valueId, wildcardTypeName } = valueIdNode;

    // Only add to entityWildcardPropertyNames if it's an actual entity type
    // (not basic wildcard types like "string", "wildcard", "word", "number")
    if (
        valueId === partialValueId ||
        (wildcardTypeName !== undefined &&
            !nonEntityWildcardTypes.has(wildcardTypeName) &&
            partialValueId === undefined)
    ) {
        wildcardPropertyNames.push(propertyName);
    }

    let entry: MatchedValueEntry | undefined = values;
    while (entry !== undefined && entry.valueId !== valueId) {
        entry = entry.prev;
    }
    if (entry === undefined) {
        if (partialValueId !== undefined) {
            // Partial match, missing variable is ok
            return undefined;
        }
        throw new Error(
            `Internal error: Missing value for variable: ${name} id: ${valueId} property: ${propertyName}`,
        );
    }

    const value = entry.value;
    if (typeof value === "object") {
        return createValue(
            value.node,
            value.valueIds,
            values,
            propertyName,
            wildcardPropertyNames,
            partialValueId,
            stat,
        );
    }

    if (stat !== undefined) {
        // undefined means optional, don't count
        if (value !== undefined) {
            stat.matchedValueCount++;
        }

        if (entry.wildcard) {
            if (typeof value !== "string") {
                throw new Error(
                    `Internal error: Wildcard has non-string value for variable: ${name} id: ${valueId} property: ${propertyName}`,
                );
            }
            stat.wildcardCharCount += value.length;
        }
    }
    return value;
}

/**
 * Find a variable by name in the valueIds linked list and create its matched value
 */
function createValueForVariable(
    variableName: string,
    valueIds: ValueIdNode | undefined,
    values: MatchedValueEntry | undefined,
    propertyName: string,
    wildcardPropertyNames: string[],
    partialValueId?: number,
    stat?: GrammarMatchStat,
): unknown {
    let valueIdNode: ValueIdNode | undefined = valueIds;
    while (valueIdNode !== undefined && valueIdNode.name !== variableName) {
        valueIdNode = valueIdNode.prev;
    }
    if (valueIdNode === undefined) {
        if (partialValueId !== undefined) {
            // Partial match, missing variable is ok
            return undefined;
        }
        throw new Error(
            `Internal error: No value for variable '${variableName}'. Values: ${JSON.stringify(valueIds)}'`,
        );
    }

    return createMatchedValue(
        valueIdNode,
        values,
        propertyName,
        wildcardPropertyNames,
        partialValueId,
        stat,
    );
}

function createValue(
    node: CompiledValueNode | undefined,
    valueIds: ValueIdNode | undefined,
    values: MatchedValueEntry | undefined,
    propertyName: string,
    wildcardPropertyNames: string[],
    partialValueId?: number,
    stat?: GrammarMatchStat,
): unknown {
    if (node === undefined) {
        if (valueIds === undefined) {
            if (partialValueId !== undefined) {
                // Partial match, missing variable is ok
                return undefined;
            }
            throw new Error("Internal error: missing value for default");
        }
        if (valueIds.prev !== undefined) {
            throw new Error("Internal error: multiple values for default");
        }
        return createMatchedValue(
            valueIds,
            values,
            propertyName,
            wildcardPropertyNames,
            partialValueId,
            stat,
        );
    }

    switch (node.type) {
        case "literal":
            return node.value;
        case "object": {
            const obj: Record<string, any> = {};

            for (const [k, v] of Object.entries(node.value)) {
                if (v === null) {
                    // Shorthand form: { k } means { k: k }
                    obj[k] = createValueForVariable(
                        k,
                        valueIds,
                        values,
                        propertyName ? `${propertyName}.${k}` : k,
                        wildcardPropertyNames,
                        partialValueId,
                        stat,
                    );
                } else {
                    obj[k] = createValue(
                        v,
                        valueIds,
                        values,
                        propertyName ? `${propertyName}.${k}` : k,
                        wildcardPropertyNames,
                        partialValueId,
                        stat,
                    );
                }
            }
            return obj;
        }
        case "array": {
            const arr: any[] = [];
            for (const [index, v] of node.value.entries()) {
                arr.push(
                    createValue(
                        v,
                        valueIds,
                        values,
                        propertyName
                            ? `${propertyName}.${index}`
                            : index.toString(),
                        wildcardPropertyNames,
                        partialValueId,
                        stat,
                    ),
                );
            }
            return arr;
        }
        case "variable": {
            return createValueForVariable(
                node.name,
                valueIds,
                values,
                propertyName,
                wildcardPropertyNames,
                partialValueId,
                stat,
            );
        }
    }
}

// Extract and trim a wildcard capture from `request[start..end)`.  In the
// default spacing modes the result is stripped of leading/trailing separators
// (whitespace and punctuation).  Returns `undefined` when the capture is empty
// or consists *entirely* of separator characters — e.g. a lone " " — so that
// the matcher rejects wildcard slots that contain no meaningful content.
// In "none" mode no trimming is performed; only a truly zero-length capture
// is rejected.
function getWildcardStr(
    request: string,
    start: number,
    end: number,
    spacingMode?: CompiledSpacingMode,
) {
    const string = request.substring(start, end);
    if (spacingMode === "none") {
        // In "none" mode there are no flex-space separator positions, so any
        // whitespace or punctuation between tokens belongs to the wildcard
        // value itself.  Only reject truly empty wildcards.
        return string.length > 0 ? string : undefined;
    }
    wildcardTrimRegExp.lastIndex = 0;
    const match = wildcardTrimRegExp.exec(string);
    return match?.[1];
}

function captureWildcard(
    state: MatchState,
    request: string,
    wildcardEnd: number,
    newIndex: number,
    pending: MatchState[] = [],
) {
    const { start: wildcardStart, valueId } = state.pendingWildcard!;
    const wildcardStr = getWildcardStr(
        request,
        wildcardStart,
        wildcardEnd,
        state.spacingMode,
    );
    if (wildcardStr === undefined) {
        return false;
    }
    state.index = newIndex;

    // Queue up longer wildcard match
    pending.push({ ...state });

    // Update current state
    state.pendingWildcard = undefined;
    if (valueId !== undefined) {
        addValueWithId(state, valueId, wildcardStr, true);
    }
    return true;
}

function addValueId(
    state: MatchState,
    name: string | undefined,
    wildcardTypeName?: string,
) {
    const valueIds = state.valueIds;
    if (valueIds === null) {
        // No need to track values
        return;
    }
    const valueId = state.nextValueId++;
    state.valueIds = { name, valueId, prev: valueIds, wildcardTypeName };
    return valueId;
}

function addValueWithId(
    state: MatchState,
    valueId: number,
    matchedValue: MatchedValue,
    wildcard: boolean,
) {
    state.values = {
        valueId,
        value: matchedValue,
        wildcard,
        prev: state.values,
    };
}

function addValue(
    state: MatchState,
    name: string | undefined,
    matchedValue: MatchedValue,
) {
    const valueId = addValueId(state, name);
    if (valueId !== undefined) {
        addValueWithId(state, valueId, matchedValue, false);
    }
}

function nextNonSeparatorIndex(request: string, index: number) {
    if (request.length <= index) {
        return request.length;
    }

    // Detect trailing separators
    separatorRegExp.lastIndex = index;
    const match = separatorRegExp.exec(request);
    return match === null ? index : index + match[0].length;
}

// When `index` is followed only by separator characters (whitespace /
// punctuation) until end-of-string, return `text.length` so that the
// trailing separators are included in the consumed prefix.  Otherwise
// return `index` unchanged.
//
// This makes completion trailing-space-sensitive: "play music " reports
// matchedPrefixLength=11 (including the space) instead of 10.  The
// dispatcher no longer strips trailing whitespace, so the grammar must
// include it when the user has already typed it.
function consumeTrailingSeparators(text: string, index: number): number {
    if (index >= text.length) {
        return index;
    }
    return nextNonSeparatorIndex(text, index) >= text.length
        ? text.length
        : index;
}

// Finalize the state to capture the last wildcard if any
// and make sure to reject any trailing un-matched non-separator characters.
function finalizeState(state: MatchState, request: string) {
    const pendingWildcard = state.pendingWildcard;
    if (pendingWildcard !== undefined) {
        const value = getWildcardStr(
            request,
            pendingWildcard.start,
            request.length,
            state.spacingMode,
        );
        if (value === undefined) {
            return false;
        }
        state.pendingWildcard = undefined;
        state.index = request.length;
        if (pendingWildcard.valueId !== undefined) {
            addValueWithId(state, pendingWildcard.valueId, value, true);
        }
    }
    if (state.index < request.length) {
        // In "none" mode the match must be exact — no trailing content
        // is tolerated.  This applies to the top-level rule's spacing
        // mode (by the time finalizeState runs, nested rules have been
        // unwound and the spacing mode has been restored to the
        // top-level rule's mode).
        if (state.spacingMode === "none") {
            debugMatch(
                state,
                `Reject trailing content in none mode at ${state.index}: ${request.slice(state.index)}`,
            );
            return false;
        }

        // Detect trailing separators
        const nonSepIndex = nextNonSeparatorIndex(request, state.index);
        if (nonSepIndex < request.length) {
            debugMatch(
                state,
                `Reject with trailing non-separator text at ${nonSepIndex}: ${request.slice(
                    nonSepIndex,
                )}`,
            );
            return false;
        }

        debugMatch(state, `Consume trailing separators to ${request.length}}`);
    }
    return true;
}

function finalizeMatch(
    state: MatchState,
    request: string,
    results: GrammarMatchResult[],
) {
    if (state.valueIds === null) {
        throw new Error(
            "Internal Error: state for finalizeMatch should not have valueIds be null",
        );
    }

    if (!finalizeState(state, request)) {
        return;
    }
    debugMatch(
        state,
        `Matched at end of input. Matched ids: ${JSON.stringify(state.valueIds)}, values: ${JSON.stringify(state.values)}'`,
    );

    const wildcardPropertyNames: string[] = [];
    const matchResult: GrammarMatchResult = {
        match: undefined,
        matchedValueCount: 0,
        wildcardCharCount: 0,
        entityWildcardPropertyNames: wildcardPropertyNames,
    };

    matchResult.match = createValue(
        state.value,
        state.valueIds,
        state.values,
        "",
        wildcardPropertyNames,
        undefined,
        matchResult, // stats
    );
    results.push(matchResult);
}

function finalizeNestedRule(
    state: MatchState,
    pending?: MatchState[],
    partial: boolean = false,
) {
    const parent = state.parent;
    if (parent !== undefined) {
        debugMatch(state, `finished nested`);

        // Reuse state
        const { valueIds, value: value } = state;

        state.nestedLevel--;
        state.parent = parent.parent;

        if (
            // Only process values if the parent rule is tracking values
            parent.valueIds !== null &&
            (parent.variable !== undefined ||
                parent.value !== undefined ||
                parent.parts.length !== 1)
        ) {
            state.value = parent.value;
            state.valueIds = parent.valueIds;
            if (parent.variable !== undefined) {
                if (valueIds === null) {
                    throw new Error(
                        "Internal Error: should not have valueIds be null when variable is defined",
                    );
                }

                if (valueIds === undefined && value === undefined) {
                    // Variable should have a value
                    if (!partial) {
                        // Should be detected by the grammar compiler
                        throw new Error(
                            `Internal error: No value assign to variable '${parent.variable}'`,
                        );
                    }
                } else {
                    addValue(state, parent.variable, {
                        node: value,
                        valueIds,
                    });
                }
            }
        }

        state.name = parent.name;
        state.parts = parent.parts;
        state.partIndex = parent.partIndex;
        state.spacingMode = parent.spacingMode;

        // For repeat parts ()*  or )+: after each successful match, queue a state
        // that tries to match the same group again.  inRepeat suppresses the
        // optional-skip push so we don't generate duplicate "done" states.
        if (parent.repeatPartIndex !== undefined && pending !== undefined) {
            pending.push({
                ...state,
                partIndex: parent.repeatPartIndex,
                inRepeat: true,
            });
        }

        return true;
    }

    return false;
}

function matchStringPartWithWildcard(
    regExpStr: string,
    request: string,
    part: StringPart,
    state: MatchState,
    pending: MatchState[],
) {
    const regExp = new RegExp(regExpStr, "iug");
    regExp.lastIndex = state.index;
    while (true) {
        const match = regExp.exec(request);
        if (match === null) {
            return false;
        }
        const wildcardEnd = match.index;
        const newIndex = wildcardEnd + match[0].length;
        if (!isBoundarySatisfied(request, newIndex, state.spacingMode)) {
            debugMatch(
                state,
                `Rejected non-separated matched string '${part.value.join(" ")}' at ${wildcardEnd}`,
            );
            continue;
        }

        if (captureWildcard(state, request, wildcardEnd, newIndex, pending)) {
            state.lastMatchedPartInfo = {
                type: "string",
                start: wildcardEnd,
                part,
                afterWildcard: true,
            };
            debugMatch(
                state,
                `Matched string '${part.value.join(" ")}' at ${wildcardEnd}`,
            );
            return true;
        }
        debugMatch(
            state,
            `Rejected matched string '${part.value.join(" ")}' at ${wildcardEnd} with empty wildcard`,
        );
    }
}

// Greedily match keyword words against text starting at startIndex.
// Returns the number of fully matched words and cursor positions.
//
// The first word allows an optional non-greedy leading separator
// ([\s\p{P}]*?) so callers don't need to pre-skip whitespace.
// Subsequent words use strict separators based on requiresSeparator.
// isBoundarySatisfied is checked after every word — this is a no-op
// at end-of-text and otherwise prevents partial-word matches
// (e.g. "play" inside "playback").
function matchWordsGreedily(
    words: string[],
    text: string,
    startIndex: number,
    spacingMode: CompiledSpacingMode,
): { matchedWords: number; endIndex: number; prevEndIndex: number } {
    let index = startIndex;
    let prevIndex = startIndex;
    let matchedWords = 0;

    for (let k = 0; k < words.length; k++) {
        const word = words[k];
        const escaped = escapeMatch(word);

        let regExpStr: string;
        if (spacingMode === "none") {
            regExpStr = escaped;
        } else if (k === 0) {
            regExpStr = `[${separatorRegExpStr}]*?${escaped}`;
        } else {
            const sep = requiresSeparator(
                words[k - 1].at(-1)!,
                word[0],
                spacingMode,
            )
                ? `[${separatorRegExpStr}]+`
                : `[${separatorRegExpStr}]*`;
            regExpStr = sep + escaped;
        }

        const re = new RegExp(regExpStr, "iuy");
        re.lastIndex = index;
        const m = re.exec(text);
        if (m === null) break;

        const newIndex = m.index + m[0].length;
        if (!isBoundarySatisfied(text, newIndex, spacingMode)) {
            break;
        }

        prevIndex = index;
        index = newIndex;
        matchedWords++;
    }

    return { matchedWords, endIndex: index, prevEndIndex: prevIndex };
}

// Try matching keyword words forward from startIndex in prefix.
// Returns the position and completion word if a partial match is found,
// or undefined if no match or all words matched fully.
function matchKeywordWordsFrom(
    prefix: string,
    startIndex: number,
    words: string[],
    spacingMode: CompiledSpacingMode,
): { position: number; completionWord: string } | undefined {
    const { matchedWords, endIndex } = matchWordsGreedily(
        words,
        prefix,
        startIndex,
        spacingMode,
    );

    // All words matched fully — not a partial match.
    if (matchedWords >= words.length) return undefined;

    // Consumed to end of prefix with more words remaining.
    if (matchedWords > 0 && endIndex === prefix.length) {
        return {
            position: prefix.length,
            completionWord: words[matchedWords],
        };
    }

    // Check if remaining text is a partial prefix of the next word.
    const word = words[matchedWords];
    let textToCheck = prefix.slice(endIndex);
    if (matchedWords > 0 && spacingMode !== "none") {
        const sepMatch = textToCheck.match(
            new RegExp(`^[${separatorRegExpStr}]+`, "u"),
        );
        if (sepMatch) {
            textToCheck = textToCheck.slice(sepMatch[0].length);
        } else if (
            requiresSeparator(
                words[matchedWords - 1].at(-1)!,
                word[0],
                spacingMode,
            )
        ) {
            return undefined;
        }
    }

    if (
        textToCheck.length > 0 &&
        textToCheck.length < word.length &&
        word.toLowerCase().startsWith(textToCheck.toLowerCase())
    ) {
        return {
            position: prefix.length - textToCheck.length,
            completionWord: word,
        };
    }
    return undefined;
}

// When a wildcard has absorbed all remaining input (via finalizeState),
// check whether the absorbed text ends with a separator-delimited prefix
// of the first word of the next keyword part.  Returns the position where
// the partial keyword starts (i.e. the first non-separator character after
// the last separator), or undefined if no partial keyword is found.
//
// Used in Category 2 backward to offer the keyword at the partial keyword
// position instead of backing up to the wildcard start.
//
// Handles both single-word and multi-word keyword parts.  For a keyword
// like ["played", "by"], the function recognizes:
//   "p"        → partial of word 0 → completion = "played"
//   "played"   → full word 0       → completion = "by"
//   "played b" → full word 0 + partial of word 1 → completion = "by"
//
// Honors spacingMode between keyword words, using the same separator
// logic as matchStringPart:
//   "none"     → words are directly adjacent (no separators)
//   "required" → [\s\p{P}]+ between words
//   "optional" → [\s\p{P}]* between words
//   auto       → + or * depending on requiresSeparator() for adjacent chars
function findPartialKeywordInWildcard(
    prefix: string,
    wildcardStart: number,
    part: StringPart,
    spacingMode: CompiledSpacingMode,
): { position: number; completionWord: string } | undefined {
    const sepCharRe = /[\s\p{P}]/u;
    const minStart = wildcardStart + 1;

    // Scan candidate start positions from right to left.
    for (
        let candidateStart = prefix.length - 1;
        candidateStart >= minStart;
        candidateStart--
    ) {
        // The candidate position must be a valid boundary between the
        // wildcard content and the keyword fragment.  This mirrors how
        // matchStringPart builds its leading separator regex:
        //   - "none" mode: no separator needed (keywords are adjacent).
        //   - Other modes: a separator is required only when
        //     requiresSeparator returns true for the adjacent characters.
        //     When the keyword starts with punctuation, CJK, or another
        //     non-word-boundary character, no separator is needed — the
        //     character itself creates a natural boundary.
        if (
            spacingMode !== "none" &&
            !sepCharRe.test(prefix[candidateStart - 1]) &&
            requiresSeparator(
                prefix[candidateStart - 1],
                part.value[0][0],
                spacingMode,
            )
        ) {
            continue;
        }

        const result = matchKeywordWordsFrom(
            prefix,
            candidateStart,
            part.value,
            spacingMode,
        );
        if (result === undefined) {
            continue;
        }

        // Verify the wildcard content before the candidate is valid.
        if (
            getWildcardStr(
                prefix,
                wildcardStart,
                candidateStart,
                spacingMode,
            ) === undefined
        ) {
            continue;
        }

        return result;
    }
    return undefined;
}

function matchStringPartWithoutWildcard(
    regExpStr: string,
    request: string,
    part: StringPart,
    state: MatchState,
) {
    const regExp = new RegExp(regExpStr, "iuy");
    const curr = state.index;
    regExp.lastIndex = curr;
    const match = regExp.exec(request);
    if (match === null) {
        return false;
    }
    const newIndex = match.index + match[0].length;
    if (!isBoundarySatisfied(request, newIndex, state.spacingMode)) {
        debugMatch(
            state,
            `Rejected non-separated matched string ${part.value.join(" ")}`,
        );
        return false;
    }

    debugMatch(state, `Matched string ${part.value.join(" ")} to ${newIndex}`);

    if (
        state.value === undefined &&
        state.parts.length === 1 &&
        state.valueIds !== null
    ) {
        // default string part value
        addValue(state, undefined, part.value.join(" "));
    }
    state.lastMatchedPartInfo = {
        type: "string",
        start: curr,
        part,
        afterWildcard: false,
    };
    state.index = newIndex;
    return true;
}

// Determine the spacing mode that governs the leading separator prefix
// ([\s\p{P}]*?) for a part at the current position.
//
// For subsequent parts within a rule (partIndex > 0), the rule's own
// spacingMode applies — there is a flex-space boundary between the
// previous part and this one.
//
// For the first part of a nested rule (partIndex === 0, parent exists),
// we walk up the parent chain looking for the nearest ancestor that has
// a flex-space boundary before the rule reference (parent.partIndex > 1
// means the rule ref was not the first part).  That ancestor's spacing
// mode controls the separator.  If no ancestor has a preceding
// flex-space, we've reached the top-level rule — its spacing mode
// determines the leading/trailing behavior (all modes except "none"
// allow leading whitespace at the top level).
function leadingSpacingMode(state: MatchState): CompiledSpacingMode {
    if (state.partIndex !== 0 || state.parent === undefined) {
        return state.spacingMode;
    }
    let parent: ParentMatchState | undefined = state.parent;
    while (parent !== undefined) {
        if (parent.partIndex > 1) {
            // The rule reference had a preceding part in this ancestor
            // — use this ancestor's spacing mode for the flex-space.
            return parent.spacingMode;
        }
        if (parent.parent === undefined) {
            // Reached the top-level rule with no preceding flex-space.
            return parent.spacingMode;
        }
        parent = parent.parent;
    }
    // Should not reach here (the loop terminates when parent.parent is undefined).
    return state.spacingMode;
}

function matchStringPart(
    request: string,
    state: MatchState,
    part: StringPart,
    pending: MatchState[],
) {
    debugMatch(
        state,
        `Checking string expr "${part.value.join(" ")}" with${state.pendingWildcard ? "" : "out"} wildcard`,
    );
    const escaped = part.value.map(escapeMatch);
    // Build the joined regex string using an array to avoid O(N²) string concatenation.
    // "required" → [\s\p{P}]+, "optional" → [\s\p{P}]*.
    // In "auto" mode, + is used only when both adjacent characters belong to
    // word-space scripts; otherwise * allows zero separators (e.g. when a
    // segment ends/starts with punctuation, or the neighboring script does
    // not use word spaces such as CJK).
    const regexpSegments: string[] = [escaped[0]];
    for (let i = 1; i < escaped.length; i++) {
        // In "none" mode flex-space positions must match exactly zero
        // characters — tokens are directly adjacent.  Any literal spaces
        // (e.g. from "\ ") are already part of the segment text and will
        // be matched by the regex itself.
        const sep =
            state.spacingMode === "none"
                ? ""
                : requiresSeparator(
                        // Invariant: segments are always non-empty (guaranteed by the parser).
                        part.value[i - 1].at(-1)!,
                        part.value[i][0],
                        state.spacingMode,
                    )
                  ? `[${separatorRegExpStr}]+`
                  : `[${separatorRegExpStr}]*`;
        regexpSegments.push(sep, escaped[i]);
    }
    const joined = regexpSegments.join("");
    // Whether to add a leading separator prefix is determined by
    // leadingSpacingMode: for the first part of a nested rule, the
    // parent's spacing mode decides; otherwise the rule's own mode.
    // In "none" mode no leading separator is consumed; the match must
    // start exactly at the current position.
    const regExpStr =
        leadingSpacingMode(state) === "none"
            ? joined
            : `[${separatorRegExpStr}]*?${joined}`;
    return state.pendingWildcard !== undefined
        ? matchStringPartWithWildcard(regExpStr, request, part, state, pending)
        : matchStringPartWithoutWildcard(regExpStr, request, part, state);
}

const matchNumberPartWithWildcardRegExp =
    /[\s\p{P}]*?(0o[0-7]+|0x[0-9a-f]+|0b[01]+|([+-]?[0-9]+)(\.[0-9]+)?(e[+-]?[1-9][0-9]*)?)/giu;
// "none" mode variant: no leading separator allowed.
const matchNumberPartWithWildcardNoSepRegExp =
    /(0o[0-7]+|0x[0-9a-f]+|0b[01]+|([+-]?[0-9]+)(\.[0-9]+)?(e[+-]?[1-9][0-9]*)?)/giu;
function matchVarNumberPartWithWildcard(
    request: string,
    state: MatchState,
    part: VarNumberPart,
    pending: MatchState[],
) {
    const curr = state.index;
    const re =
        leadingSpacingMode(state) === "none"
            ? matchNumberPartWithWildcardNoSepRegExp
            : matchNumberPartWithWildcardRegExp;
    re.lastIndex = curr;
    while (true) {
        const match = re.exec(request);
        if (match === null) {
            return false;
        }
        const n = Number(match[1]);
        if (isNaN(n)) {
            continue;
        }

        const wildcardEnd = match.index;
        const newIndex = wildcardEnd + match[0].length;

        if (!isBoundarySatisfied(request, newIndex, state.spacingMode)) {
            debugMatch(
                state,
                `Rejected non-separated matched number at ${wildcardEnd}`,
            );
            continue;
        }

        if (captureWildcard(state, request, wildcardEnd, newIndex, pending)) {
            debugMatch(
                state,
                `Matched number at ${wildcardEnd} to ${newIndex}`,
            );

            const valueId = addValueId(state, part.variable);
            if (valueId !== undefined) {
                addValueWithId(state, valueId, n, false);
                state.lastMatchedPartInfo = {
                    type: "number",
                    start: wildcardEnd,
                    valueId,
                    afterWildcard: true,
                };
            }
            return true;
        }
        debugMatch(
            state,
            `Rejected match number at ${wildcardEnd} to ${newIndex} with empty wildcard`,
        );
    }
}

const matchNumberPartRegexp =
    /[\s\p{P}]*?(0o[0-7]+|0x[0-9a-f]+|0b[01]+|([+-]?[0-9]+)(\.[0-9]+)?(e[+-]?[1-9][0-9]*)?)/iuy;
// "none" mode variant: no leading separator allowed.
const matchNumberPartNoSepRegexp =
    /(0o[0-7]+|0x[0-9a-f]+|0b[01]+|([+-]?[0-9]+)(\.[0-9]+)?(e[+-]?[1-9][0-9]*)?)/iuy;
function matchVarNumberPartWithoutWildcard(
    request: string,
    state: MatchState,
    part: VarNumberPart,
) {
    const curr = state.index;
    const re =
        leadingSpacingMode(state) === "none"
            ? matchNumberPartNoSepRegexp
            : matchNumberPartRegexp;
    re.lastIndex = curr;
    const m = re.exec(request);
    if (m === null) {
        return false;
    }
    const n = Number(m[1]);
    if (isNaN(n)) {
        return false;
    }

    const newIndex = curr + m[0].length;

    if (!isBoundarySatisfied(request, newIndex, state.spacingMode)) {
        debugMatch(state, `Rejected non-separated matched number`);
        return false;
    }

    debugMatch(state, `Matched number to ${newIndex}`);

    const valueId = addValueId(state, part.variable);
    if (valueId !== undefined) {
        addValueWithId(state, valueId, n, false);
        state.lastMatchedPartInfo = {
            type: "number",
            start: curr,
            valueId,
            afterWildcard: false,
        };
    }
    state.index = newIndex;
    return true;
}

function matchVarNumberPart(
    request: string,
    state: MatchState,
    part: VarNumberPart,
    pending: MatchState[],
) {
    debugMatch(
        state,
        `Checking number expr at with${state.pendingWildcard ? "" : "out"} wildcard`,
    );
    return state.pendingWildcard !== undefined
        ? matchVarNumberPartWithWildcard(request, state, part, pending)
        : matchVarNumberPartWithoutWildcard(request, state, part);
}

function matchVarStringPart(state: MatchState, part: VarStringPart) {
    // string variable, wildcard
    if (state.pendingWildcard !== undefined) {
        return false;
    }

    const valueId = addValueId(state, part.variable, part.typeName);
    state.pendingWildcard = {
        valueId,
        start: state.index,
    };
    return true;
}

function matchState(state: MatchState, request: string, pending: MatchState[]) {
    while (true) {
        const { parts, partIndex } = state;
        if (partIndex >= parts.length) {
            if (!finalizeNestedRule(state, pending)) {
                // Finish matching this state.
                return true;
            }

            // Check the trailing boundary after the nested rule using the
            // parent's (now-restored) spacingMode, but only if the
            // parent still has parts remaining.  If the parent is also
            // exhausted, skip the check here: the loop will call
            // finalizeNestedRule again and the check will fire once we
            // reach an ancestor that actually has a following part — using
            // that ancestor's mode instead of an intermediate pass-through
            // rule's mode.
            if (
                state.partIndex < state.parts.length &&
                state.pendingWildcard === undefined &&
                !isBoundarySatisfied(request, state.index, state.spacingMode)
            ) {
                return false;
            }

            continue;
        }

        const part = parts[partIndex];
        debugMatch(
            state,
            `matching type=${JSON.stringify(part.type)} pendingWildcard=${JSON.stringify(state.pendingWildcard)}`,
        );

        if (part.optional && !state.inRepeat) {
            // queue up skipping optional (suppressed when re-entering a repeat
            // group to avoid duplicating already-queued "done" states)
            const newState = { ...state, partIndex: state.partIndex + 1 };
            if (part.variable) {
                addValue(newState, part.variable, undefined);
            }
            pending.push(newState);
        }

        switch (part.type) {
            case "string":
                if (!matchStringPart(request, state, part, pending)) {
                    return false;
                }
                break;

            case "number":
                if (!matchVarNumberPart(request, state, part, pending)) {
                    return false;
                }
                break;
            case "wildcard":
                // string variable, wildcard
                if (!matchVarStringPart(state, part)) {
                    return false;
                }
                break;
            case "rules": {
                const rules = part.rules;
                debugMatch(state, `expanding ${rules.length} rules`);

                // Save the current state to be restored after finishing the nested rule.
                const parent: ParentMatchState = {
                    name: state.name,
                    variable: part.variable,
                    parts: state.parts,
                    value: state.value,
                    partIndex: state.partIndex + 1,
                    valueIds: state.valueIds,
                    parent: state.parent,
                    repeatPartIndex: part.repeat ? state.partIndex : undefined,
                    spacingMode: state.spacingMode,
                };

                // The nested rule needs to track values if the current rule is tracking value AND
                // - the current part has variable
                // - the current rule has not explicit value and only has one part (default)
                const requireValue =
                    state.valueIds !== null &&
                    (part.variable !== undefined ||
                        (state.value === undefined && parts.length === 1));

                // Update the current state to consider the first nested rule.
                state.name = getNestedStateName(state, part, 0);
                state.parts = rules[0].parts;
                state.value = rules[0].value;
                state.partIndex = 0;
                state.valueIds = requireValue ? undefined : null;
                state.parent = parent;
                state.nestedLevel++;
                state.inRepeat = undefined; // entering nested rules, clear repeat flag
                state.spacingMode = rules[0].spacingMode;

                // queue up the other rules (backwards to search in the original order)
                for (let i = rules.length - 1; i > 0; i--) {
                    pending.push({
                        ...state,
                        name: getNestedStateName(state, part, i),
                        parts: rules[i].parts,
                        value: rules[i].value,
                        spacingMode: rules[i].spacingMode,
                    });
                }
                // continue the loop (without incrementing partIndex)
                continue;
            }
        }
        state.partIndex++;
    }
}

function initialMatchState(grammar: Grammar): MatchState[] {
    return grammar.rules
        .map((r, i) => ({
            name: `<Start>[${i}]`,
            parts: r.parts,
            value: r.value,
            partIndex: 0,
            index: 0,
            nextValueId: 0,
            nestedLevel: 0,
            spacingMode: r.spacingMode,
        }))
        .reverse();
}

export type GrammarCompletionProperty = {
    match: unknown;
    propertyNames: string[];
};

export type GrammarCompletionResult = {
    completions: string[];
    properties?: GrammarCompletionProperty[] | undefined;
    // Number of characters from the input prefix that the grammar consumed
    // before the completion point.  The shell uses this to determine where
    // to insert/filter completions (replacing the space-based heuristic).
    matchedPrefixLength?: number | undefined;
    // What kind of separator is expected between the content at
    // `matchedPrefixLength` and the completion text.  This is a
    // *completion-result* concept (SeparatorMode), derived from the
    // per-rule *match-time* spacing rules (CompiledSpacingMode /
    // spacingMode) but distinct from them.
    //   "spacePunctuation" — whitespace or punctuation required
    //     (Latin "y" → "m" requires a separator).
    //   "optional" — separator accepted but not required
    //     (CJK 再生 → 音楽 does not require a separator).
    //   "none" — no separator at all ([spacing=none] grammars).
    // Omitted when no completions were generated.
    separatorMode?: SeparatorMode | undefined;
    // True when `completions` is the closed set of valid
    // continuations after the matched prefix — if the user types
    // something not in the list, no further completions can exist
    // beyond it.  False or undefined means the parser can continue
    // past unrecognized input and find more completions (e.g.
    // wildcard/entity slots whose values are external to the grammar).
    closedSet?: boolean | undefined;
    // True when the result would differ if queried with the opposite
    // direction.  When false, the caller can skip re-fetching on
    // direction change.
    directionSensitive: boolean;
    // True when the completion's `matchedPrefixLength` position is
    // *ambiguous* — it could shift forward as the user types more.
    //
    // A position is **definite** when it is structurally pinned by
    // matched grammar tokens: no amount of additional typing can
    // change where it falls.  Examples: the start of a wildcard
    // (pinned by the preceding keyword), or a keyword matched
    // without a preceding wildcard.
    //
    // A position is **ambiguous** when it sits at the boundary of a
    // wildcard whose extent is not fully determined.  The wildcard
    // could absorb more text, moving the boundary forward.  This
    // happens in two cases:
    //   - **Forward:** a keyword completion follows a wildcard that
    //     was finalized at end-of-input (via `finalizeState`).  The
    //     wildcard consumed everything up to EOI, but the user may
    //     still be typing within it.
    //   - **Backward:** completion backs up to a keyword that was
    //     matched after a captured wildcard (`afterWildcard`).  The
    //     wildcard's end was pinned by this keyword, but backing up
    //     un-pins it — the wildcard could extend to absorb the
    //     keyword text.
    //
    // When true, the caller should allow its anchor to slide forward
    // (the "slide" policy) rather than re-fetching or giving up.
    openWildcard: boolean;
};

function getGrammarCompletionProperty(
    state: MatchState,
    valueId: number,
): GrammarCompletionProperty | undefined {
    const temp = { ...state };

    while (finalizeNestedRule(temp, undefined, true)) {}
    if (temp.valueIds === null) {
        // valueId would have been undefined
        throw new Error(
            "Internal Error: state for getGrammarCompletionProperty should not have valueIds be null",
        );
    }
    const wildcardPropertyNames: string[] = [];
    const match = createValue(
        temp.value,
        temp.valueIds,
        temp.values,
        "",
        wildcardPropertyNames,
        valueId,
    );

    return {
        match,
        propertyNames: wildcardPropertyNames,
    };
}

function debugMatch(state: MatchState, msg: string) {
    debugMatchRaw(
        `${" ".repeat(state.nestedLevel)}${getStateName(state)}: @${state.index}: ${msg}`,
    );
}
function getStateName(state: MatchState): string {
    return `${state.name}{${state.partIndex}}`;
}

function getNestedStateName(state: MatchState, part: RulesPart, index: number) {
    return `${part.name ? `<${part.name}>` : getStateName(state)}[${index}]`;
}

export function matchGrammar(grammar: Grammar, request: string) {
    const pending = initialMatchState(grammar);
    const results: GrammarMatchResult[] = [];
    while (pending.length > 0) {
        const state = pending.pop()!;
        debugMatch(state, `resume state`);
        if (matchState(state, request, pending)) {
            finalizeMatch(state, request, results);
        }
    }

    return results;
}

/**
 * Try to partially match leading words of a multi-word string part
 * against the prefix starting at `startIndex`.  Returns the consumed
 * length and the remaining (unmatched) words as the completion text.
 *
 * - All words matched → returns undefined (caller should treat as
 *   a full match, not a completion candidate).
 * - Some words matched → returns consumed length + next word.
 * - No words matched → returns startIndex + first word.
 *
 * When returning a non-undefined result, it contains exactly one
 * word as the completion text, providing one-word-at-a-time
 * progression.
 */
function tryPartialStringMatch(
    part: StringPart,
    prefix: string,
    startIndex: number,
    spacingMode: CompiledSpacingMode,
    direction?: "forward" | "backward",
):
    | {
          consumedLength: number;
          remainingText: string;
          directionSensitive: boolean;
      }
    | undefined {
    const words = part.value;
    const { matchedWords, endIndex, prevEndIndex } = matchWordsGreedily(
        words,
        prefix,
        startIndex,
        spacingMode,
    );

    // Direction matters when at least one word fully matched and no
    // trailing separator commits the last matched word.
    const couldBackUp =
        matchedWords > 0 &&
        (spacingMode === "none" ||
            nextNonSeparatorIndex(prefix, endIndex) === endIndex);

    if (direction === "backward" && couldBackUp) {
        return {
            consumedLength: prevEndIndex,
            remainingText: words[matchedWords - 1],
            directionSensitive: true,
        };
    }
    // Forward (default), or backward with no words fully matched
    // (nothing to reconsider — e.g. input "pl" still offers "play").
    // Return undefined when all words matched (exact match).
    if (matchedWords >= words.length) {
        return undefined;
    }

    return {
        consumedLength: endIndex,
        remainingText: words[matchedWords],
        directionSensitive: couldBackUp,
    };
}

/**
 * Given a grammar and a user-typed prefix string, determine what completions
 * are available.  The algorithm greedily matches as many grammar parts as
 * possible against the prefix (the "longest completable prefix"), then
 * reports completions from the *next* unmatched part.
 *
 * ## Two-Phase Architecture
 *
 * The function uses a **collect-then-convert** design.  Phase A (the main
 * loop) processes every rule and collects lightweight *candidate
 * descriptors* into two sets — `fixedCandidates` and `rangeCandidates`.
 * Phase B (post-loop) converts surviving candidates into the final
 * `completions[]` and `properties[]` arrays.  See the inline "Two-Phase
 * Collect then Convert Architecture" comment for details.
 *
 * ## Phase A — Three categories
 *
 * The function explores every alternative rule/state in the grammar (via the
 * `pending` work-list).  Each state is run through `matchState` which
 * consumes as many parts as the prefix allows.  The state then falls into
 * one of three categories:
 *
 * 1. **Exact match** — the prefix satisfies every part in the rule.
 *    No completion is needed, but `maxPrefixLength` is updated to
 *    the full input length so that completion candidates from shorter
 *    partial matches are eagerly discarded (via `updateMaxPrefixLength`).
 *
 * 2. **Partial match, finalized** — the prefix was consumed (possibly with
 *    trailing separators) but the rule still has remaining parts.
 *    `matchState` returns `false` (could not match the next part) and
 *    `finalizeState` returns `true` (no trailing non-separator junk).
 *    The next unmatched part produces a completion candidate:
 *      - String part → literal keyword completion (e.g. "music").
 *      - Wildcard / number → property completion (handled elsewhere).
 *
 * 3. **Partial match, NOT finalized** — either:
 *      a. A pending wildcard could not be finalized (trailing text is only
 *         separators with no wildcard content) → collect a property
 *         candidate for the wildcard's entity type.
 *      b. Trailing text remains that didn't match any part →
 *         attempt word-by-word matching of the current string part
 *         against that text (via `tryPartialStringMatch`).  If some
 *         leading words match they advance the consumed prefix; the
 *         next unmatched word is collected as a completion candidate.
 *         Candidates from shorter partial matches are automatically
 *         discarded when a longer match updates `maxPrefixLength`.
 *
 * During processing, whenever `maxPrefixLength` advances, all
 * previously accumulated fixed candidates are cleared.  Only candidates
 * whose prefix length equals the current maximum are kept.  This
 * ensures completions from shorter partial matches are discarded
 * when a longer (or exact) match consumed more input.
 *
 * ## Backward completion
 *
 * When `direction` is `"backward"`, the function backs up to the last
 * matched item (keyword, wildcard, or number) and offers it as a
 * completion — allowing the user to revise the most recently typed
 * element.  Range candidates handle the case where a wildcard's end
 * position is flexible (determined by other rules' `maxPrefixLength`).
 *
 * ## Output fields
 *
 * `matchedPrefixLength` tracks the furthest point consumed across all
 * states (via `updateMaxPrefixLength`).  This tells the caller where
 * the completable portion of the input ends, so it can position the
 * completion insertion point correctly (especially important for
 * non-space-separated scripts like CJK).
 *
 * `separatorMode` (a {@link SeparatorMode}) indicates what kind of
 * separator is needed between the content at `matchedPrefixLength` and the
 * completion text.  It is determined by the spacing rules (the per-rule
 * {@link CompiledSpacingMode}) between the last character of the matched
 * prefix and the first character of the completion.
 *
 * Architecture: docs/architecture/completion.md — §1 Grammar Matcher
 */

type FixedCandidate =
    | {
          kind: "string";
          completionText: string;
          needsSep: boolean;
          spacingMode: CompiledSpacingMode;
      }
    | {
          kind: "property";
          valueId: number;
          state: MatchState;
          needsSep: boolean;
          spacingMode: CompiledSpacingMode;
      };

type RangeCandidate =
    | {
          kind: "wildcardString";
          wildcardStart: number;
          nextPart: StringPart;
          spacingMode: CompiledSpacingMode;
      }
    | {
          kind: "wildcardProperty";
          wildcardStart: number;
          valueId: number;
          state: MatchState;
          spacingMode: CompiledSpacingMode;
      };

function computeNeedsSep(
    prefix: string,
    position: number,
    firstCompletionChar: string,
    spacingMode: CompiledSpacingMode,
): boolean {
    return (
        position > 0 &&
        spacingMode !== "none" &&
        requiresSeparator(
            prefix[position - 1],
            firstCompletionChar,
            spacingMode,
        )
    );
}

export function matchGrammarCompletion(
    grammar: Grammar,
    prefix: string,
    minPrefixLength?: number,
    direction?: "forward" | "backward",
): GrammarCompletionResult {
    debugCompletion(
        `Start completion for prefix ${direction ?? "forward"}: "${prefix}"`,
    );

    // Seed the work-list with one MatchState per top-level grammar rule.
    // matchState may push additional states (for nested rules, optional
    // parts, wildcard extensions, repeat groups) during processing.
    const pending = initialMatchState(grammar);

    // --- Two-Phase "Collect then Convert" Architecture ---
    //
    // The main loop (Phase A) collects lightweight candidate
    // descriptors (FixedCandidate / RangeCandidate, defined at
    // module scope) rather than immediately emitting final completion
    // strings and property objects.  A post-loop Phase B converts
    // surviving candidates into the output arrays.
    //
    // This decouples candidate *discovery* (which rule matched, at
    // what position) from candidate *materialization* (building the
    // GrammarCompletionProperty, computing separatorMode).  The split
    // is essential for backward completion: the main loop evaluates
    // every rule at the full prefix length, but the final completion
    // position (maxPrefixLength) is only known after ALL rules have
    // been processed.  Range candidates exploit this — they defer
    // the "where does the wildcard end?" decision until Phase B,
    // when maxPrefixLength is settled.
    //
    // fixedCandidates — single valid position, cleared whenever
    //     maxPrefixLength advances.  Produced by all three categories
    //     in both forward and backward modes.
    //
    // rangeCandidates — valid at any wildcard split in
    //     [wildcardStart+1, prefix.length], never cleared.  They
    //     arise in Category 2 backward when a wildcard absorbed
    //     all remaining input and the next part could match at
    //     a flexible position.  Processed in Phase B only under
    //     the same conditions the old retrigger required.
    //
    // Phase B also handles:
    //  • Global string deduplication via Set.
    //  • Range candidate gating (only under retrigger conditions).
    //  • Trailing-separator advancement (forward only).
    //  • directionSensitive recomputation for backed-up positions.
    const fixedCandidates: FixedCandidate[] = [];
    const rangeCandidates: RangeCandidate[] = [];
    let separatorMode: SeparatorMode | undefined;

    // Whether the accumulated completions form a closed set — if the
    // user types something not listed, no further completions can exist
    // beyond it.  Starts true and is set to false when property/wildcard
    // candidates are collected (entity values are external to the grammar).
    // Reset to true whenever maxPrefixLength advances (old candidates are
    // discarded, new batch starts fresh).
    let closedSet: boolean = true;

    // Track the furthest point the grammar consumed across all
    // states (including exact matches).  This tells the caller where
    // the "filter text" begins so it doesn't have to guess from
    // whitespace (which breaks for CJK and other non-space scripts).
    let maxPrefixLength = minPrefixLength ?? 0;

    // Whether direction influenced the accumulated results.  Reset
    // whenever maxPrefixLength advances (old candidates discarded).
    let directionSensitive = false;

    // Whether the matchedPrefixLength position is ambiguous — see
    // the openWildcard comment on GrammarCompletionResult for the
    // full definition of definite vs ambiguous positions.
    let openWildcard = false;

    // Whether a findPartialKeywordInWildcard match determined the
    // backed-up position.  When true, range candidate processing
    // is skipped because the partial keyword position reflects a
    // multi-word keyword boundary that a forward-mode evaluation
    // can't reconstruct (the wildcard would greedily absorb the
    // already-matched keyword words).
    let partialKeywordBackup = false;

    // Whether backward actually collected a backed-up candidate (via
    // collectBackwardCandidate or findPartialKeywordInWildcard).  When
    // false, backward fell through to forward behavior — range
    // candidate processing, the trailing-separator-advancement guard,
    // and the directionSensitive override are all skipped so the
    // result is identical to forward.
    let backwardEmitted = false;

    // Helper: update maxPrefixLength.  When it increases, all previously
    // accumulated fixed-point candidates from shorter matches are
    // irrelevant — clear them.  Range candidates are NOT cleared
    // because their valid position is a range that may include the
    // new maxPrefixLength.
    function updateMaxPrefixLength(prefixLength: number): void {
        if (prefixLength > maxPrefixLength) {
            maxPrefixLength = prefixLength;
            fixedCandidates.length = 0;
            separatorMode = undefined;
            closedSet = true;
            directionSensitive = false;
            openWildcard = false;
            partialKeywordBackup = false;
        }
    }

    // Helper: collect a property completion candidate at a given
    // prefix position.  Updates maxPrefixLength; skips if position
    // is below max.  The candidate is converted to a final
    // GrammarCompletionProperty in Phase B.
    function collectPropertyCandidate(
        state: MatchState,
        valueId: number,
        prefixPosition: number,
    ): void {
        updateMaxPrefixLength(prefixPosition);
        if (prefixPosition !== maxPrefixLength) return;
        const candidateNeedsSep = computeNeedsSep(
            prefix,
            prefixPosition,
            "a",
            state.spacingMode,
        );
        fixedCandidates.push({
            kind: "property",
            valueId,
            state: { ...state },
            needsSep: candidateNeedsSep,
            spacingMode: state.spacingMode,
        });
    }

    // Helper: collect a literal string completion candidate at a
    // given prefix position.  Updates maxPrefixLength; skips if
    // position is below max.  Converted in Phase B.
    function collectStringCandidate(
        state: MatchState,
        candidatePrefixLength: number,
        completionText: string,
    ): void {
        updateMaxPrefixLength(candidatePrefixLength);
        if (candidatePrefixLength !== maxPrefixLength) return;
        const candidateNeedsSep = computeNeedsSep(
            prefix,
            candidatePrefixLength,
            completionText[0],
            state.spacingMode,
        );
        fixedCandidates.push({
            kind: "string",
            completionText,
            needsSep: candidateNeedsSep,
            spacingMode: state.spacingMode,
        });
    }

    // Helper: backward completion — back up to the last matched item
    // (wildcard, literal word, or number).  If a wildcard was captured
    // after the last matched part, prefer it; otherwise back up to
    // the last matched part via tryPartialStringMatch (for strings)
    // or collectPropertyCandidate (for numbers).
    //
    // Sets openWildcard=true when backing up to a part that was
    // matched after a captured wildcard (afterWildcard) — that
    // position is ambiguous because the wildcard could extend.
    function collectBackwardCandidate(
        state: MatchState,
        savedWildcard: PendingWildcard | undefined,
    ): void {
        const wildcardStart = savedWildcard?.start;
        const partStart = state.lastMatchedPartInfo?.start;
        if (
            savedWildcard !== undefined &&
            savedWildcard.valueId !== undefined &&
            (partStart === undefined ||
                (wildcardStart !== undefined && wildcardStart >= partStart))
        ) {
            collectPropertyCandidate(
                state,
                savedWildcard.valueId,
                savedWildcard.start,
            );
            backwardEmitted = true;
        } else if (state.lastMatchedPartInfo !== undefined) {
            const info = state.lastMatchedPartInfo;
            if (info.type === "string") {
                const backResult = tryPartialStringMatch(
                    info.part,
                    prefix,
                    info.start,
                    state.spacingMode,
                    "backward",
                );
                if (backResult !== undefined) {
                    collectStringCandidate(
                        state,
                        backResult.consumedLength,
                        backResult.remainingText,
                    );
                    backwardEmitted = true;
                    if (info.afterWildcard) {
                        openWildcard = true;
                    }
                } else {
                    updateMaxPrefixLength(state.index);
                }
            } else {
                // Number part — offer property completion for the
                // number slot so the user can re-enter a value.
                collectPropertyCandidate(state, info.valueId, info.start);
                backwardEmitted = true;
                if (info.afterWildcard) {
                    openWildcard = true;
                }
            }
        }
    }

    // --- Main loop: process every pending state ---
    while (pending.length > 0) {
        const state = pending.pop()!;
        debugMatch(state, `resume state`);

        // Attempt to greedily match as many grammar parts as possible
        // against the prefix.  `matched` is true only when ALL parts in
        // the rule (including nested rules) were satisfied.  matchState
        // may also push new derivative states onto `pending` (e.g. for
        // alternative nested rules, optional-skip paths, wildcard
        // extensions, repeat iterations).
        const matched = matchState(state, prefix, pending);

        // Save the pending wildcard before finalizeState clears it.
        // Needed for backward completion of wildcards at the end of a rule.
        const savedPendingWildcard: PendingWildcard | undefined =
            state.pendingWildcard;

        // Snapshot the state BEFORE finalizeState mutates it.  When
        // backward backs up past a wildcard captured by finalizeState,
        // we need the pre-capture state so the property completion
        // does not include the backed-up wildcard's value.
        // Shallow copy is sufficient: finalizeState only reassigns
        // primitive fields (pendingWildcard, index) and appends to the
        // .values linked list.  The linked-list nodes themselves are
        // immutable once created, so the snapshot and the mutated state
        // share .values/.parent chains safely.
        const preFinalizeState: MatchState | undefined =
            savedPendingWildcard !== undefined ? { ...state } : undefined;

        // finalizeState does two things:
        //   1. If a wildcard is pending at the end, attempt to capture
        //      all remaining input as its value.
        //   2. Reject states that leave trailing non-separator characters
        //      un-consumed (those states don't represent valid parses).
        // It returns true when the state is "clean" — all input was
        // consumed (or only trailing separators remain).
        if (finalizeState(state, prefix)) {
            // Would backward produce different results than forward?
            // True when the prefix was fully consumed and there is a
            // matched part (string/number) or wildcard to back up to.
            const hasPartToReconsider =
                state.index >= prefix.length &&
                (savedPendingWildcard?.valueId !== undefined ||
                    state.lastMatchedPartInfo !== undefined);

            // --- Category 1: Exact match ---
            // All parts matched AND prefix was fully consumed.
            if (matched) {
                if (direction === "backward" && hasPartToReconsider) {
                    collectBackwardCandidate(
                        preFinalizeState ?? state,
                        savedPendingWildcard,
                    );
                } else {
                    debugCompletion("Matched. Nothing to complete.");
                    updateMaxPrefixLength(state.index);
                }
                if (hasPartToReconsider) {
                    directionSensitive = true;
                }
                continue;
            }

            // --- Category 2: Partial match (clean finalization) ---
            // matchState stopped at state.partIndex because it couldn't
            // match the next part against the (exhausted) prefix.
            // That next part is what we offer as a completion.
            const nextPart = state.parts[state.partIndex];

            if (direction === "backward" && hasPartToReconsider) {
                // When a wildcard absorbed text ending with a partial
                // keyword prefix (e.g. "Never b" where "b" prefixes
                // "by"), offer the keyword at the partial keyword
                // position instead of backing up to the wildcard start.
                // The partial keyword position has a higher
                // matchedPrefixLength and is more useful to the user.
                if (
                    savedPendingWildcard?.valueId !== undefined &&
                    nextPart.type === "string"
                ) {
                    const partialResult = findPartialKeywordInWildcard(
                        prefix,
                        savedPendingWildcard.start,
                        nextPart,
                        state.spacingMode,
                    );
                    if (partialResult !== undefined) {
                        collectStringCandidate(
                            state,
                            partialResult.position,
                            partialResult.completionWord,
                        );
                        openWildcard = true;
                        partialKeywordBackup = true;
                        backwardEmitted = true;
                    } else {
                        collectBackwardCandidate(
                            preFinalizeState ?? state,
                            savedPendingWildcard,
                        );
                    }
                } else {
                    collectBackwardCandidate(
                        preFinalizeState ?? state,
                        savedPendingWildcard,
                    );
                }
                // Save a range candidate for the wildcard-nextPart
                // split — the wildcard end is flexible and may match
                // the final maxPrefixLength determined by other rules.
                // Skip when partialKeywordBackup already found the
                // optimal position.
                if (
                    savedPendingWildcard?.valueId !== undefined &&
                    !partialKeywordBackup
                ) {
                    if (nextPart.type === "string") {
                        rangeCandidates.push({
                            kind: "wildcardString",
                            wildcardStart: savedPendingWildcard.start,
                            nextPart,
                            spacingMode: state.spacingMode,
                        });
                    } else if (
                        nextPart.type === "wildcard" ||
                        nextPart.type === "number"
                    ) {
                        rangeCandidates.push({
                            kind: "wildcardProperty",
                            wildcardStart: savedPendingWildcard.start,
                            valueId: savedPendingWildcard.valueId,
                            state: preFinalizeState ?? { ...state },
                            spacingMode: state.spacingMode,
                        });
                    }
                }
            } else {
                debugCompletion(
                    `Completing ${nextPart.type} part ${state.name}`,
                );
                if (nextPart.type === "string") {
                    const partial = tryPartialStringMatch(
                        nextPart,
                        prefix,
                        state.index,
                        state.spacingMode,
                        direction,
                    );
                    if (partial !== undefined) {
                        collectStringCandidate(
                            state,
                            partial.consumedLength,
                            partial.remainingText,
                        );
                        if (partial.directionSensitive) {
                            directionSensitive = true;
                            if (direction === "backward") {
                                backwardEmitted = true;
                            }
                        }
                    }
                } else {
                    debugCompletion(
                        `No completion for ${nextPart.type} part (handled by Category 3a or matchState expansion)`,
                    );
                }
                // A keyword completion at a position reached by
                // finalizing a wildcard at end-of-input: the position
                // is ambiguous (the wildcard could absorb more text).
                if (savedPendingWildcard?.valueId !== undefined) {
                    openWildcard = true;
                }
            }
            if (hasPartToReconsider) {
                directionSensitive = true;
            }
            // Note: non-string next parts (wildcard, number, rules) in
            // Category 2 don't produce completions here — wildcards are
            // handled by Category 3a (pending wildcard) and nested rules
            // are expanded by matchState into separate pending states.
        } else {
            // --- Category 3: finalizeState failed ---
            // Either (a) a pending wildcard couldn't capture meaningful
            // content, or (b) trailing non-separator text remains that
            // didn't match any grammar part.
            const pendingWildcard = state.pendingWildcard;

            if (
                pendingWildcard !== undefined &&
                pendingWildcard.valueId !== undefined
            ) {
                // --- Category 3a: Unfinalizable pending wildcard ---
                // The grammar reached a wildcard slot but it is
                // unfinalizable (capture region empty, separator-only,
                // or not yet started — e.g. prefix="play " with
                // wildcard starting at index 4).
                // Backward reconsidering is appropriate when:
                //  (a) the last matched part followed a captured
                //      wildcard — wildcard-keyword boundary fork, OR
                //  (b) the prefix was fully consumed before the
                //      wildcard started (state.index >= prefix.length)
                //      — the user hasn't typed into the wildcard yet
                //      and may want to reconsider the preceding part
                //      (e.g., alternation-prefix overlap:
                //      (play | player) <song>, input "play").
                const canReconsider3a =
                    state.lastMatchedPartInfo !== undefined &&
                    (state.lastMatchedPartInfo.afterWildcard ||
                        state.index >= prefix.length);
                if (direction === "backward" && canReconsider3a) {
                    // Backward: back up to the last matched keyword
                    // instead of offering property completion for the
                    // unfilled wildcard — the user hasn't started
                    // typing into the unfilled slot yet.
                    collectBackwardCandidate(state, undefined);
                } else {
                    // Forward (or backward with nothing to
                    // reconsider): report a property completion
                    // describing the wildcard's type so the caller can
                    // provide entity-specific suggestions.
                    debugCompletion("Completing wildcard part");
                    collectPropertyCandidate(
                        state,
                        pendingWildcard.valueId,
                        pendingWildcard.start,
                    );
                }
                if (canReconsider3a) {
                    directionSensitive = true;
                }
            } else if (!matched) {
                // --- Category 3b: Completion after consumed prefix ---
                // The grammar stopped at a string part it could not
                // match.  Report the string part as a completion
                // candidate regardless of any trailing text — the
                // caller can use matchedPrefixLength to determine how
                // much of the input was successfully consumed and
                // filter completions by any trailing text beyond that
                // point.  Candidates from shorter partial matches are
                // automatically discarded when a longer match updates
                // maxPrefixLength.
                const currentPart = state.parts[state.partIndex];
                if (
                    currentPart !== undefined &&
                    currentPart.type === "string"
                ) {
                    const partial = tryPartialStringMatch(
                        currentPart,
                        prefix,
                        state.index,
                        state.spacingMode,
                        direction,
                    );
                    if (partial !== undefined) {
                        collectStringCandidate(
                            state,
                            partial.consumedLength,
                            partial.remainingText,
                        );
                        if (partial.directionSensitive) {
                            directionSensitive = true;
                            if (direction === "backward") {
                                backwardEmitted = true;
                            }
                        }
                    }
                }
            }
        }
    }

    // --- Phase B: Convert candidates to final completions/properties ---
    //
    // Fixed candidates are converted directly — they are already
    // guaranteed to be at maxPrefixLength (candidates at shorter
    // positions were discarded when maxPrefixLength advanced).
    //
    // Range candidates are only converted when the "retrigger"
    // conditions are met (see the range-candidate block below).
    //
    // Global string deduplication: multiple rules (or repeat-
    // expansion states of the same rule) can produce the same
    // completion text at the same maxPrefixLength.  Showing
    // duplicates in the menu is unhelpful, so we deduplicate
    // globally.
    const completions = new Set<string>();
    const properties: GrammarCompletionProperty[] = [];

    for (const c of fixedCandidates) {
        if (c.kind === "string") {
            completions.add(c.completionText);
            separatorMode = mergeSeparatorMode(
                separatorMode,
                c.needsSep,
                c.spacingMode,
            );
        } else {
            const completionProperty = getGrammarCompletionProperty(
                c.state,
                c.valueId,
            );
            if (completionProperty !== undefined) {
                properties.push(completionProperty);
                closedSet = false;
                separatorMode = mergeSeparatorMode(
                    separatorMode,
                    c.needsSep,
                    c.spacingMode,
                );
            }
        }
    }

    // Range candidates replace the old two-pass backward retrigger
    // (which recursively called matchGrammarCompletion(forward) at
    // the backed-up position).  Each range candidate records a
    // wildcard-to-nextPart relationship from Category 2 backward;
    // here we check whether maxPrefixLength falls inside the
    // candidate's valid range and whether the wildcard text at that
    // split is well-formed (via getWildcardStr).  If so, we run
    // tryPartialStringMatch forward at maxPrefixLength to produce
    // the completion — exactly what the old forward re-invocation
    // would have done for that rule's wildcard-keyword boundary.
    //
    // Gating: range candidates are only processed under the same
    // conditions the old retrigger required — backward actually
    // backed up, no openWildcard (ambiguous boundary would cause
    // forward to re-parse with different greedy wildcards), and no
    // partialKeywordBackup (forward can't reconstruct the keyword
    // word boundary because the wildcard absorbs the consumed words).
    if (
        direction === "backward" &&
        backwardEmitted &&
        maxPrefixLength < prefix.length &&
        !partialKeywordBackup &&
        !openWildcard
    ) {
        for (const c of rangeCandidates) {
            if (maxPrefixLength <= c.wildcardStart) continue;
            if (
                getWildcardStr(
                    prefix,
                    c.wildcardStart,
                    maxPrefixLength,
                    c.spacingMode,
                ) === undefined
            ) {
                continue;
            }
            if (c.kind === "wildcardString") {
                const partial = tryPartialStringMatch(
                    c.nextPart,
                    prefix,
                    maxPrefixLength,
                    c.spacingMode,
                    "forward",
                );
                if (
                    partial !== undefined &&
                    !completions.has(partial.remainingText)
                ) {
                    completions.add(partial.remainingText);
                    const candidateNeedsSep = computeNeedsSep(
                        prefix,
                        maxPrefixLength,
                        partial.remainingText[0],
                        c.spacingMode,
                    );
                    separatorMode = mergeSeparatorMode(
                        separatorMode,
                        candidateNeedsSep,
                        c.spacingMode,
                    );
                    openWildcard = true;
                }
            } else {
                const completionProperty = getGrammarCompletionProperty(
                    c.state,
                    c.valueId,
                );
                if (completionProperty !== undefined) {
                    properties.push(completionProperty);
                    closedSet = false;
                    const candidateNeedsSep = computeNeedsSep(
                        prefix,
                        maxPrefixLength,
                        "a",
                        c.spacingMode,
                    );
                    separatorMode = mergeSeparatorMode(
                        separatorMode,
                        candidateNeedsSep,
                        c.spacingMode,
                    );
                    openWildcard = true;
                }
            }
        }
    }

    // Advance past trailing separators so the reported prefix length
    // includes any trailing whitespace the user typed.  This makes
    // completion trailing-space-sensitive: "play music " reports
    // matchedPrefixLength=11 (with the space) rather than 10.
    //
    // When advancing, demote separatorMode to "optional" — the
    // trailing space is already consumed, so no additional separator
    // is required between the anchor and the completion text.
    //
    // Skip advancement when backward backed up (backwardEmitted):
    // the backed-up position P is where backward intentionally wants
    // completions to anchor.  Advancing P past trailing separators
    // would move the anchor forward, defeating the backup.
    if (!backwardEmitted) {
        const advanced = consumeTrailingSeparators(prefix, maxPrefixLength);
        if (advanced > maxPrefixLength) {
            maxPrefixLength = advanced;
            separatorMode = "optional";
        }
    }

    // Recompute directionSensitive for the backed-up case.
    //
    // During the main loop, directionSensitive is accumulated at
    // the *full* prefix length — but when backward backed up, the
    // effective completion position is maxPrefixLength (< prefix.
    // length), and directionSensitive must reflect THAT position.
    // The old retrigger got this for free: its forward call at P
    // naturally evaluated directionSensitive at P.
    //
    // Heuristic: at P > 0 at least one keyword was matched before
    // the completion point, so hasPartToReconsider is true in a
    // forward pass at P → directionSensitive.  At P = 0 nothing
    // was matched → not direction-sensitive.
    //
    // Guard: if minPrefixLength filtered out all candidates, the
    // result is empty regardless of direction → not sensitive.
    if (
        direction === "backward" &&
        backwardEmitted &&
        maxPrefixLength < prefix.length &&
        !partialKeywordBackup &&
        !openWildcard
    ) {
        directionSensitive =
            maxPrefixLength > 0 &&
            (completions.size > 0 || properties.length > 0);
    }

    const result: GrammarCompletionResult = {
        completions: [...completions],
        properties,
        matchedPrefixLength: maxPrefixLength,
        separatorMode,
        closedSet,
        directionSensitive,
        openWildcard,
    };
    debugCompletion(`Completed. ${JSON.stringify(result)}`);
    return result;
}

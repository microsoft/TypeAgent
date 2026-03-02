// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SpacingMode, ValueNode } from "./grammarRuleParser.js";
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

const debugMatchRaw = registerDebug("typeagent:grammar:match");
const debugCompletion = registerDebug("typeagent:grammar:completion");

// Treats spaces and punctuation as word separators
const separatorRegExpStr = "\\s\\p{P}";
const separatorRegExp = new RegExp(`[${separatorRegExpStr}]+`, "yu");
const wildcardTrimRegExp = new RegExp(
    `[${separatorRegExpStr}]*(.+?)[${separatorRegExpStr}]*$`,
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
    // Fast path: all ASCII letters are Latin-script (boundary required).
    // ASCII digits and punctuation/space fall through to return false here
    // (digits are handled separately by digitRe, punctuation/space never need a boundary).
    const code = c.charCodeAt(0);
    if (code < 128) {
        return (code >= 65 && code <= 90) || (code >= 97 && code <= 122); // A-Z, a-z
    }
    return wordBoundaryScriptRe.test(c);
}
function needsSeparatorInAutoMode(a: string, b: string): boolean {
    if (digitRe.test(a) && digitRe.test(b)) {
        return true;
    }
    return isWordBoundaryScript(a) && isWordBoundaryScript(b);
}
function requiresSeparator(a: string, b: string, mode: SpacingMode): boolean {
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

function isBoundarySatisfied(
    request: string,
    index: number,
    mode: SpacingMode,
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
            // the outer boundary.  "none" enforces zero-width flex-space
            // *between* tokens (handled by the regex builder in
            // matchStringPart), but must not reject a match simply because a
            // literal space from an escaped character (e.g. "\ ") happens to
            // sit at the boundary.
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
    | { node: ValueNode | undefined; valueIds: ValueIdNode | undefined };

type MatchedValueNode = {
    valueId: number;
    value: MatchedValue;
    wildcard: boolean;
    prev: MatchedValueNode | undefined;
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
    value: ValueNode | undefined; // the value to be assigned after finishing the nested rule.
    partIndex: number; // the part index after the nested rule.
    variable: string | undefined;
    valueIds: ValueIdNode | undefined | null; // null means we don't need any value
    parent: ParentMatchState | undefined;
    repeatPartIndex?: number | undefined; // defined for ()* / )+ — holds the part index to loop back to
    spacingMode: SpacingMode; // parent rule's spacingMode, restored in MatchState on return from nested rule
};
type MatchState = {
    // Current context
    name: string; // For debugging
    parts: GrammarPart[];
    value: ValueNode | undefined; // the value to be assigned after finishing the current rule if the rule has only one part.
    partIndex: number;
    valueIds?: ValueIdNode | undefined | null; // null means we don't need any value

    // Match state
    nextValueId: number;
    values?: MatchedValueNode | undefined;
    parent?: ParentMatchState | undefined;

    nestedLevel: number; // for debugging

    inRepeat?: boolean | undefined; // true when re-entering a repeat group after a successful match

    spacingMode: SpacingMode; // active spacing mode for this rule

    index: number;
    pendingWildcard?:
        | {
              readonly start: number;
              readonly valueId: number | undefined;
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
    values: MatchedValueNode | undefined,
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

    let matchedValueNode: MatchedValueNode | undefined = values;
    while (
        matchedValueNode !== undefined &&
        matchedValueNode.valueId !== valueId
    ) {
        matchedValueNode = matchedValueNode.prev;
    }
    if (matchedValueNode === undefined) {
        if (partialValueId !== undefined) {
            // Partial match, missing variable is ok
            return undefined;
        }
        throw new Error(
            `Internal error: Missing value for variable: ${name} id: ${valueId} property: ${propertyName}`,
        );
    }

    const value = matchedValueNode.value;
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

        if (matchedValueNode.wildcard) {
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
    values: MatchedValueNode | undefined,
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
    node: ValueNode | undefined,
    valueIds: ValueIdNode | undefined,
    values: MatchedValueNode | undefined,
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

function getWildcardStr(
    request: string,
    start: number,
    end: number,
    spacingMode?: SpacingMode,
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
    state.index = newIndex;
    return true;
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
    // In "none" mode no leading separator is consumed; the match must start
    // exactly at the current position (or, for wildcards, at whatever index
    // the global scan finds the pattern text).
    const regExpStr =
        state.spacingMode === "none"
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
        state.spacingMode === "none"
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

            addValue(state, part.variable, n);
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
        state.spacingMode === "none"
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

    addValue(state, part.variable, n);
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

    state.pendingWildcard = {
        valueId: addValueId(state, part.variable, part.typeName),
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
};

function getGrammarCompletionProperty(
    state: MatchState,
    valueId: number,
): GrammarCompletionProperty | undefined {
    const temp = { ...state };
    if (temp.valueIds === null) {
        // valueId would have been undefined
        throw new Error(
            "Internal Error: state for getGrammarCompletionProperty should not have valueIds be null",
        );
    }
    const wildcardPropertyNames: string[] = [];

    while (finalizeNestedRule(temp, undefined, true)) {}
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
 * Check if the remaining input text is a case-insensitive prefix of a rule's
 * string part. Used for completions when the user has partially typed a keyword.
 * For example, prefix "p" should match and complete "play".
 */
function isPartialPrefixOfStringPart(
    prefix: string,
    index: number,
    part: StringPart,
): boolean {
    // Get the remaining text after any leading separators
    const remaining = prefix.slice(index).trimStart().toLowerCase();
    if (remaining.length === 0) {
        return false; // No partial text - handled by the normal completion path
    }
    const partText = part.value.join(" ").toLowerCase();
    return partText.startsWith(remaining) && remaining.length < partText.length;
}

export function matchGrammarCompletion(
    grammar: Grammar,
    prefix: string,
): GrammarCompletionResult {
    debugCompletion(`Start completion for prefix: "${prefix}"`);
    const pending = initialMatchState(grammar);
    const completions: string[] = [];
    const properties: GrammarCompletionProperty[] = [];
    while (pending.length > 0) {
        const state = pending.pop()!;
        debugMatch(state, `resume state`);
        const matched = matchState(state, prefix, pending);

        if (finalizeState(state, prefix)) {
            if (matched) {
                debugCompletion("Matched. Nothing to complete.");
                // Matched exactly, nothing to complete.
                continue;
            }
            // Completion with the current part
            const nextPart = state.parts[state.partIndex];

            debugCompletion(`Completing ${nextPart.type} part ${state.name}`);
            if (nextPart.type === "string") {
                debugCompletion(
                    `Adding completion text: "${nextPart.value.join(" ")}"`,
                );
                completions.push(nextPart.value.join(" "));
            }
        } else {
            // We can't finalize the state because of empty pending wildcard
            // or because there's trailing unmatched text.
            const pendingWildcard = state.pendingWildcard;
            if (
                pendingWildcard !== undefined &&
                pendingWildcard.valueId !== undefined
            ) {
                debugCompletion("Completing wildcard part");
                const completionProperty = getGrammarCompletionProperty(
                    state,
                    pendingWildcard.valueId,
                );
                if (completionProperty !== undefined) {
                    debugCompletion(
                        `Adding completion property: ${JSON.stringify(completionProperty)}`,
                    );
                    properties.push(completionProperty);
                }
            } else if (!matched) {
                // matchState failed on a string part and there's trailing text.
                // Check if the remaining input is a partial prefix of the
                // current string part (e.g. "p" is a prefix of "play").
                const currentPart = state.parts[state.partIndex];
                if (
                    currentPart !== undefined &&
                    currentPart.type === "string" &&
                    isPartialPrefixOfStringPart(
                        prefix,
                        state.index,
                        currentPart,
                    )
                ) {
                    const fullText = currentPart.value.join(" ");
                    debugCompletion(
                        `Adding partial prefix completion: "${fullText}"`,
                    );
                    completions.push(fullText);
                }
            }
        }
    }

    const result = {
        completions,
        properties,
    };
    debugCompletion(`Completed. ${JSON.stringify(result)}`);
    return result;
}

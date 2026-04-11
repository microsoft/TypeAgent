// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CompiledSpacingMode, CompiledValueNode } from "./grammarTypes.js";
import { evaluateValueExpr } from "./grammarValueExprEvaluator.js";
import registerDebug from "debug";
// REVIEW: switch to RegExp.escape() when it becomes available.
import escapeMatch from "regexp.escape";
import {
    Grammar,
    GrammarPart,
    RulesPart,
    StringPart,
    StringPartRegExpEntry,
    VarNumberPart,
    VarStringPart,
} from "./grammarTypes.js";

// Separator mode for completion results.  Structurally identical to
// SeparatorMode from @typeagent/agent-sdk (command.ts); independently
// defined here so actionGrammar does not depend on agentSdk.  Keep
// both definitions in sync.
export type SeparatorMode =
    | "space"
    | "spacePunctuation"
    | "optionalSpacePunctuation"
    | "optionalSpace"
    | "none"
    | "autoSpacePunctuation";

const debugMatchRaw = registerDebug("typeagent:grammar:match");

// Treats spaces and punctuation as word separators
export const separatorRegExpStr = "\\s\\p{P}";
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
export function requiresSeparator(
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

export function isBoundarySatisfied(
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
export type PendingWildcard = {
    readonly start: number;
    readonly valueId: number | undefined;
};

export type MatchState = {
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
    // (see afterWildcard on GrammarCompletionResult in grammarCompletion.ts).
    lastMatchedPartInfo?:
        | {
              readonly type: "string";
              readonly start: number;
              readonly part: StringPart;
              readonly afterWildcard: boolean;
              readonly matchedSpacingMode: CompiledSpacingMode;
          }
        | {
              readonly type: "number";
              readonly start: number;
              readonly valueId: number;
              readonly afterWildcard: boolean;
              readonly matchedSpacingMode: CompiledSpacingMode;
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

export function createValue(
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

            for (const elem of node.value) {
                if (elem.type === "spread") {
                    // Spread: evaluate the argument and merge into the object.
                    const inner = createValue(
                        elem.argument,
                        valueIds,
                        values,
                        propertyName,
                        wildcardPropertyNames,
                        partialValueId,
                        stat,
                    );
                    if (inner === undefined) {
                        // Partial match — the spread argument's variable
                        // hasn't been captured yet.  Skip silently.
                    } else if (typeof inner === "object") {
                        Object.assign(obj, inner);
                    } else {
                        throw new Error(
                            `Internal error: spread argument must produce an object, got ${typeof inner}`,
                        );
                    }
                } else if (elem.value === null) {
                    // Shorthand form: { k } means { k: k }
                    obj[elem.key] = createValueForVariable(
                        elem.key,
                        valueIds,
                        values,
                        propertyName ? `${propertyName}.${elem.key}` : elem.key,
                        wildcardPropertyNames,
                        partialValueId,
                        stat,
                    );
                } else {
                    obj[elem.key] = createValue(
                        elem.value,
                        valueIds,
                        values,
                        propertyName ? `${propertyName}.${elem.key}` : elem.key,
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
                if (v.type === "spreadElement") {
                    // Spread: evaluate the argument and flatten into the array.
                    const inner = createValue(
                        v.argument,
                        valueIds,
                        values,
                        propertyName
                            ? `${propertyName}.${index}`
                            : index.toString(),
                        wildcardPropertyNames,
                        partialValueId,
                        stat,
                    );
                    if (Array.isArray(inner)) {
                        arr.push(...inner);
                    } else {
                        arr.push(inner);
                    }
                } else {
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
        default: {
            // Expression node (binaryExpression, unaryExpression, etc.).
            // All expression node types are handled by evaluateValueExpr,
            // which throws on unknown types — no silent fallthrough risk.
            // The evalBase callback routes base nodes (literal, variable,
            // object, array) back through createValue so variable resolution
            // and wildcard extraction work correctly.
            return evaluateValueExpr(node, (baseNode) =>
                createValue(
                    baseNode,
                    valueIds,
                    values,
                    propertyName,
                    wildcardPropertyNames,
                    partialValueId,
                    stat,
                ),
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
export function getWildcardStr(
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

export function nextNonSeparatorIndex(request: string, index: number) {
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
export function finalizeState(state: MatchState, request: string) {
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

export function finalizeNestedRule(
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
    regExp: RegExp,
    request: string,
    part: StringPart,
    state: MatchState,
    pending: MatchState[],
) {
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
            // Assign default string value for single-part rules without
            // an explicit value expression — same logic as the non-wildcard
            // path in matchStringPartWithoutWildcard.  Without this, a
            // pending wildcard from a parent rule that leaks into a
            // single-part child rule would bypass the default value
            // assignment and cause "No value assign to variable" at
            // finalizeNestedRule time.
            if (
                state.value === undefined &&
                state.parts.length === 1 &&
                state.valueIds !== null
            ) {
                addValue(state, undefined, part.value.join(" "));
            }
            state.lastMatchedPartInfo = {
                type: "string",
                start: wildcardEnd,
                part,
                afterWildcard: true,
                matchedSpacingMode: state.spacingMode,
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

function matchStringPartWithoutWildcard(
    regExp: RegExp,
    request: string,
    part: StringPart,
    state: MatchState,
) {
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
        matchedSpacingMode: state.spacingMode,
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
export function leadingSpacingMode(state: MatchState): CompiledSpacingMode {
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

/**
 * Build the regex pattern string for a StringPart given the spacing mode and
 * whether leading separators should be suppressed ("none" leading mode).
 */
function buildStringPartRegExpStr(
    part: StringPart,
    spacingMode: CompiledSpacingMode,
    leadingIsNone: boolean,
): string {
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
            spacingMode === "none"
                ? ""
                : requiresSeparator(
                        // Invariant: segments are always non-empty (guaranteed by the parser).
                        part.value[i - 1].at(-1)!,
                        part.value[i][0],
                        spacingMode,
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
    return leadingIsNone ? joined : `[${separatorRegExpStr}]*?${joined}`;
}

/**
 * Get or create cached RegExp objects for a StringPart.  The cache key
 * is derived from (spacingMode, leadingIsNone) — for the same StringPart
 * and spacing configuration, the compiled regex is reused across calls.
 */
function getStringPartRegExp(
    part: StringPart,
    spacingMode: CompiledSpacingMode,
    leadingIsNone: boolean,
): StringPartRegExpEntry {
    const key = `${spacingMode ?? "auto"}:${leadingIsNone}`;
    if (part.regexpCache === undefined) {
        part.regexpCache = new Map();
    }
    let entry = part.regexpCache.get(key);
    if (entry === undefined) {
        const regExpStr = buildStringPartRegExpStr(
            part,
            spacingMode,
            leadingIsNone,
        );
        entry = {
            global: new RegExp(regExpStr, "iug"),
            sticky: new RegExp(regExpStr, "iuy"),
        };
        part.regexpCache.set(key, entry);
    }
    return entry;
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
    const leadingIsNone = leadingSpacingMode(state) === "none";
    const entry = getStringPartRegExp(part, state.spacingMode, leadingIsNone);
    return state.pendingWildcard !== undefined
        ? matchStringPartWithWildcard(
              entry.global,
              request,
              part,
              state,
              pending,
          )
        : matchStringPartWithoutWildcard(entry.sticky, request, part, state);
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
                    matchedSpacingMode: state.spacingMode,
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
            matchedSpacingMode: state.spacingMode,
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

export function matchState(
    state: MatchState,
    request: string,
    pending: MatchState[],
) {
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

export function initialMatchState(grammar: Grammar): MatchState[] {
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

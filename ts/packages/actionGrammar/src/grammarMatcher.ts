// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ValueNode } from "./grammarRuleParser.js";
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

const separatedRegExp = /[^\s\p{P}][\s\p{P}]|[\s\p{P}]./uy;
function isSeparated(request: string, index: number) {
    if (index === 0 || index === request.length) {
        return true;
    }
    separatedRegExp.lastIndex = index - 1;
    return separatedRegExp.test(request);
}

type MatchedValue =
    | string
    | number
    | undefined
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
            let v: ValueIdNode | undefined = valueIds;
            while (v !== undefined && v.name !== node.name) {
                v = v.prev;
            }
            if (v === undefined) {
                if (partialValueId !== undefined) {
                    // Partial match, missing variable is ok
                    return undefined;
                }
                throw new Error(
                    `Internal error: No value for variable '${node.name}'. Values: ${JSON.stringify(valueIds)}'`,
                );
            }

            return createMatchedValue(
                v,
                values,
                propertyName,
                wildcardPropertyNames,
                partialValueId,
                stat,
            );
        }
    }
}

function getWildcardStr(request: string, start: number, end: number) {
    const wildcardRegexp = new RegExp(
        `[${separatorRegExpStr}]*(.+?)[${separatorRegExpStr}]*$`,
        "yu",
    );

    const string = request.substring(start, end);
    wildcardRegexp.lastIndex = 0;
    const match = wildcardRegexp.exec(string);
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
    const wildcardStr = getWildcardStr(request, wildcardStart, wildcardEnd);
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

function addValue(state: MatchState, name: string, matchedValue: MatchedValue) {
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

function finalizeNestedRule(state: MatchState, partial: boolean = false) {
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
        if (!isSeparated(request, newIndex)) {
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
    if (!isSeparated(request, newIndex)) {
        debugMatch(
            state,
            `Rejected non-separated matched string ${part.value.join(" ")}`,
        );
        return false;
    }

    debugMatch(state, `Matched string ${part.value.join(" ")} to ${newIndex}`);
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
    // REVIEW: better separator policy
    const regExpStr = `[${separatorRegExpStr}]*?${part.value.map(escapeMatch).join(`[${separatorRegExpStr}]+`)}`;
    return state.pendingWildcard !== undefined
        ? matchStringPartWithWildcard(regExpStr, request, part, state, pending)
        : matchStringPartWithoutWildcard(regExpStr, request, part, state);
}

const matchNumberPartWithWildcardRegExp =
    /[\s\p{P}]*?(0o[0-7]+|0x[0-9a-f]+|0b[01]+|([+-]?[0-9]+)(\.[0-9]+)?(e[+-]?[1-9][0-9]*)?)/giu;
function matchVarNumberPartWithWildcard(
    request: string,
    state: MatchState,
    part: VarNumberPart,
    pending: MatchState[],
) {
    const curr = state.index;
    matchNumberPartWithWildcardRegExp.lastIndex = curr;
    while (true) {
        const match = matchNumberPartWithWildcardRegExp.exec(request);
        if (match === null) {
            return false;
        }
        const n = Number(match[1]);
        if (isNaN(n)) {
            continue;
        }

        const wildcardEnd = match.index;
        const newIndex = wildcardEnd + match[0].length;

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
function matchVarNumberPartWithoutWildcard(
    request: string,
    state: MatchState,
    part: VarNumberPart,
) {
    const curr = state.index;
    matchNumberPartRegexp.lastIndex = curr;
    const m = matchNumberPartRegexp.exec(request);
    if (m === null) {
        return false;
    }
    const n = Number(m[1]);
    if (isNaN(n)) {
        return false;
    }

    const newIndex = curr + m[0].length;
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
            if (!finalizeNestedRule(state)) {
                // Finish matching this state.
                return true;
            }
            continue;
        }

        const part = parts[partIndex];
        debugMatch(
            state,
            `matching type=${JSON.stringify(part.type)} pendingWildcard=${JSON.stringify(state.pendingWildcard)}`,
        );

        if (part.optional) {
            // queue up skipping optional
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

                // queue up the other rules (backwards to search in the original order)
                for (let i = rules.length - 1; i > 0; i--) {
                    pending.push({
                        ...state,
                        name: getNestedStateName(state, part, i),
                        parts: rules[i].parts,
                        value: rules[i].value,
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

    while (finalizeNestedRule(temp, true)) {}
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
            // We can't finalize the state because of empty pending wildcard.
            // Return a completion property.
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

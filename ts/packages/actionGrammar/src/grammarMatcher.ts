// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ValueNode } from "./grammarRuleParser.js";
import registerDebug from "debug";
// REVIEW: switch to RegExp.escape() when it becomes available.
import escapeMatch from "regexp.escape";
import {
    Grammar,
    GrammarRule,
    StringPart,
    VarNumberPart,
    VarStringPart,
} from "./grammarTypes.js";

const debugMatch = registerDebug("typeagent:grammar:match");
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
    prev?: ValueIdNode | undefined;
};

type NestedMatchState = {
    name: string; // For debugging
    rule: GrammarRule;
    partIndex: number;
    variable: string | undefined;
    valueIds: ValueIdNode | undefined;
    prev: NestedMatchState | undefined;
};
type MatchState = {
    // Current context
    name: string; // For debugging
    rule: GrammarRule;
    partIndex: number;
    valueIds?: ValueIdNode | undefined;

    // Match state
    nextValueId: number;
    values?: MatchedValueNode | undefined;
    nested?: NestedMatchState | undefined;

    index: number;
    pendingWildcard?:
        | {
              readonly start: number;
              readonly valueId: number;
          }
        | undefined;
};

function getMatchedValueNode(
    valueId: number,
    values: MatchedValueNode | undefined,
): MatchedValueNode {
    let v: MatchedValueNode | undefined = values;
    while (v !== undefined && v.valueId !== valueId) {
        v = v.prev;
    }
    if (v === undefined) {
        throw new Error(`Internal error: Missing value for ${valueId}`);
    }
    return v;
}

type GrammarMatchStat = {
    matchedValueCount: number;
    wildcardCharCount: number;
    entityWildcardPropertyNames: string[];
};
export type GrammarMatchResult = GrammarMatchStat & {
    match: unknown;
};

function createValue(
    stat: GrammarMatchStat,
    node: ValueNode | undefined,
    valueIds: ValueIdNode | undefined,
    values: MatchedValueNode | undefined,
): unknown {
    if (node === undefined) {
        if (valueIds === undefined) {
            throw new Error("Internal error: default matched values");
        }
        if (valueIds.prev !== undefined) {
            throw new Error(
                `Internal error: No value definitions for multiple values`,
            );
        }
        const valueNode = getMatchedValueNode(valueIds.valueId, values);
        const value = valueNode.value;
        if (typeof value === "object") {
            return createValue(stat, value.node, value.valueIds, values);
        }
        return value;
    }

    switch (node.type) {
        case "literal":
            return node.value;
        case "object": {
            const obj: Record<string, any> = {};

            for (const [k, v] of Object.entries(node.value)) {
                obj[k] = createValue(stat, v, valueIds, values);
            }
            return obj;
        }
        case "array": {
            const arr: any[] = [];
            for (const v of node.value) {
                arr.push(createValue(stat, v, valueIds, values));
            }
            return arr;
        }
        case "variable": {
            let v: ValueIdNode | undefined = valueIds;
            while (v !== undefined && v.name !== node.name) {
                v = v.prev;
            }
            if (v === undefined) {
                throw new Error(
                    `Internal error: No value for variable '${node.name}. Values: ${JSON.stringify(valueIds)}'`,
                );
            }
            const valueNode = getMatchedValueNode(v.valueId, values);
            const value = valueNode.value;
            if (typeof value === "object") {
                return createValue(stat, value.node, value.valueIds, values);
            }

            // undefined means optional, don't count
            if (value !== undefined) {
                stat.matchedValueCount++;
            }

            if (valueNode.wildcard) {
                if (typeof value !== "string") {
                    throw new Error(
                        `Internal error: Wildcard has non-string value for variable '${node.name}'`,
                    );
                }
                stat.wildcardCharCount += value.length;
            }

            return value;
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
    if (match === null) {
        debugMatch(`Empty wildcard match at ${start} to ${end}`);
        return undefined;
    }

    return match[1];
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
    addValueWithId(state, valueId, wildcardStr, true);
    return true;
}

function addValueId(state: MatchState, name: string | undefined) {
    const valueId = state.nextValueId++;
    state.valueIds = { name, valueId, prev: state.valueIds };
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
    addValueWithId(state, valueId, matchedValue, false);
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

function finalizeMatch(
    state: MatchState,
    request: string,
    results: GrammarMatchResult[],
) {
    if (state.pendingWildcard !== undefined) {
        const value = getWildcardStr(
            request,
            state.pendingWildcard.start,
            request.length,
        );
        if (value === undefined) {
            return;
        }
        state.index = request.length;
        addValueWithId(state, state.pendingWildcard.valueId, value, true);
    }
    if (state.index < request.length) {
        // Detect trailing separators
        const nonSepIndex = nextNonSeparatorIndex(request, state.index);
        if (nonSepIndex < request.length) {
            debugMatch(
                `Reject with trailing non-separator text at ${nonSepIndex}: ${request.slice(
                    nonSepIndex,
                )}`,
            );
            return;
        }

        debugMatch(
            `Consume trailing separators at ${state.index} to ${request.length}}`,
        );
    }
    debugMatch(
        `Matched at end of input. Matched ids: ${JSON.stringify(state.valueIds)}, values: ${JSON.stringify(state.values)}'`,
    );

    const matchResult: GrammarMatchResult = {
        match: undefined,
        matchedValueCount: 0,
        wildcardCharCount: 0,
        entityWildcardPropertyNames: [], // TODO
    };
    matchResult.match = createValue(
        matchResult,
        state.rule.value,
        state.valueIds,
        state.values,
    );
    results.push(matchResult);
}

function finalizeNestedRule(state: MatchState) {
    const nested = state.nested;
    if (nested !== undefined) {
        debugMatch(`Pop nested rule at expr index ${nested.partIndex}`);

        // Reuse state
        const { valueIds: matchedValues, rule } = state;

        state.nested = nested.prev;
        const valueIds = state.valueIds;
        state.valueIds = nested.valueIds;
        if (matchedValues === undefined && rule.value === undefined) {
            if (nested.variable) {
                // Should be detected by the parser
                throw new Error(
                    `Internal error: No value assign to variable '${nested.variable}'`,
                );
            }
        } else {
            addValue(state, nested.variable, {
                node: rule.value,
                valueIds,
            });
        }
        state.name = nested.name;
        state.rule = nested.rule;
        state.partIndex = nested.partIndex;
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
                `  Rejected non-separated matched string '${part.value.join(" ")}' at ${wildcardEnd}`,
            );
            continue;
        }

        if (captureWildcard(state, request, wildcardEnd, newIndex, pending)) {
            debugMatch(
                `  Matched string '${part.value.join(" ")}' at ${wildcardEnd}`,
            );
            return true;
        }
        debugMatch(
            `  Rejected matched string '${part.value.join(" ")}' at ${wildcardEnd} with empty wildcard`,
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
            `  Rejected non-separated matched string ${part.value.join(" ")} at ${curr}`,
        );
        return false;
    }

    debugMatch(
        `  Matched string ${part.value.join(" ")} at ${curr} to ${newIndex}`,
    );
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
        `  Checking string expr "${part.value.join(" ")}" at ${state.index} with${state.pendingWildcard ? "" : "out"} wildcard`,
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
            debugMatch(`  Matched number at ${wildcardEnd} to ${newIndex}`);

            addValue(state, part.variable, n);
            return true;
        }
        debugMatch(
            `  Rejected match number at ${wildcardEnd} to ${newIndex} with empty wildcard`,
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
    debugMatch(`  Matched number at ${curr} to ${newIndex}`);

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
        `  Checking number expr at ${state.index} with${state.pendingWildcard ? "" : "out"} wildcard`,
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
        valueId: addValueId(state, part.variable),
        start: state.index,
    };
    return true;
}

function matchState(state: MatchState, request: string, pending: MatchState[]) {
    while (true) {
        const { rule, partIndex } = state;
        if (partIndex >= rule.parts.length) {
            if (!finalizeNestedRule(state)) {
                // Finish matching this state.
                return true;
            }
            continue;
        }

        const part = rule.parts[partIndex];
        debugMatch(
            ` State ${state.name}{${partIndex}}: @${state.index}, type=${JSON.stringify(part.type)} pendingWildcard=${JSON.stringify(state.pendingWildcard)}`,
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
                debugMatch(
                    `  Expanding ${rules.length} rules at ${state.index}`,
                );
                const nested: NestedMatchState = {
                    name: state.name,
                    variable: part.variable,
                    rule: state.rule,
                    partIndex: state.partIndex + 1,
                    valueIds: state.valueIds,
                    prev: state.nested,
                };
                // Update the current state to consider the first nested rule.
                state.name = part.name
                    ? `<${part.name}>[0]`
                    : `${state.name}{${partIndex}}[0]`;
                state.rule = rules[0];
                state.partIndex = 0;
                state.valueIds = undefined;
                state.nested = nested;

                // queue up the other rules (backwards to search in the original order)
                for (let i = rules.length - 1; i > 0; i--) {
                    pending.push({
                        ...state,
                        name: part.name
                            ? `<${part.name}>[${i}]`
                            : `${state.name}{${partIndex}}[${i}]`,
                        rule: rules[i],
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
            rule: r,
            partIndex: 0,
            index: 0,
            nextValueId: 0,
        }))
        .reverse();
}
function matchRules(grammar: Grammar, request: string): GrammarMatchResult[] {
    const pending = initialMatchState(grammar);
    const results: GrammarMatchResult[] = [];
    while (pending.length > 0) {
        const state = pending.pop()!;
        debugMatch(
            `Start state ${state.name}{${state.partIndex}}: @${state.index}`,
        );
        if (matchState(state, request, pending)) {
            finalizeMatch(state, request, results);
        }
    }

    return results;
}

export type GrammarCompletionProperty = {
    match: unknown;
    propertyNames: string[];
};

export type GrammarCompletionResult = {
    completions: string[];
    properties?: GrammarCompletionProperty[] | undefined;
};

function partialMatchRules(
    grammar: Grammar,
    request: string,
): GrammarCompletionResult {
    const pending = initialMatchState(grammar);
    const completions: string[] = [];
    while (pending.length > 0) {
        const state = pending.pop()!;
        debugMatch(
            `Start state ${state.name}{${state.partIndex}}: @${state.index}`,
        );
        if (!matchState(state, request, pending)) {
            const nonSepIndex = nextNonSeparatorIndex(request, state.index);
            if (nonSepIndex !== request.length) {
                // There are not matched non-separator characters left
                debugCompletion(
                    `  Rejecting completion at ${state.name} with non-separator text at ${nonSepIndex}`,
                );
                continue;
            }
            const nextPart = state.rule.parts[state.partIndex];
            switch (nextPart.type) {
                case "string":
                    debugCompletion(
                        `  Completing string part ${state.name}: ${nextPart.value.join(" ")}`,
                    );
                    completions.push(...nextPart.value);
                    break;
            }
        }
    }

    return {
        completions,
    };
}
export function matchGrammar(grammar: Grammar, request: string) {
    return matchRules(grammar, request);
}

export function matchGrammarCompletion(
    grammar: Grammar,
    requestPrefix: string,
): GrammarCompletionResult {
    return partialMatchRules(grammar, requestPrefix);
}

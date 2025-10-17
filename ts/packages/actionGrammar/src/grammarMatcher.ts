// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ValueNode } from "./grammarRuleParser.js";
import registerDebug from "debug";
// REVIEW: switch to RegExp.escape() when it becomes available.
import escapeMatch from "regexp.escape";
import { Grammar, GrammarRule } from "./grammarTypes.js";

const debugMatch = registerDebug("typeagent:grammar:match");

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

function getMatchedValue(
    valueId: ValueIdNode,
    values: MatchedValueNode | undefined,
): MatchedValue | undefined {
    let v: MatchedValueNode | undefined = values;
    while (v !== undefined && v.valueId !== valueId.valueId) {
        v = v.prev;
    }
    return v?.value;
}

function createValue(
    node: ValueNode | undefined,
    valueIds: ValueIdNode | undefined,
    values: MatchedValueNode | undefined,
): any {
    if (node === undefined) {
        if (valueIds === undefined) {
            throw new Error("Internal error: default matched values");
        }
        if (valueIds.prev !== undefined) {
            throw new Error(
                `Internal error: No value definitions for multiple values`,
            );
        }
        const value = getMatchedValue(valueIds, values);
        if (typeof value === "object") {
            return createValue(value.node, value.valueIds, values);
        }
        return value;
    }

    switch (node.type) {
        case "literal":
            return node.value;
        case "object": {
            const obj: Record<string, any> = {};

            for (const [k, v] of Object.entries(node.value)) {
                obj[k] = createValue(v, valueIds, values);
            }
            return obj;
        }
        case "array": {
            const arr: any[] = [];
            for (const v of node.value) {
                arr.push(createValue(v, valueIds, values));
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
            const value = getMatchedValue(v, values);
            if (typeof value === "object") {
                return createValue(value.node, value.valueIds, values);
            }
            return value;
        }
    }
}

function captureWildcard(request: string, start: number, end: number) {
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

function createCaptureWildcardState(
    state: MatchState,
    request: string,
    wildcardEnd: number,
    newIndex: number,
) {
    const { start: wildcardStart, valueId } = state.pendingWildcard!;
    const wildcard = captureWildcard(request, wildcardStart, wildcardEnd);
    if (wildcard === undefined) {
        return undefined;
    }
    const newState = { ...state };
    newState.index = newIndex;
    newState.pendingWildcard = undefined;
    addValueWithId(newState, valueId, wildcard);
    return newState;
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
) {
    state.values = {
        valueId,
        value: matchedValue,
        prev: state.values,
    };
}

function addValue(
    state: MatchState,
    name: string | undefined,
    matchedValue: MatchedValue,
) {
    const valueId = addValueId(state, name);
    addValueWithId(state, valueId, matchedValue);
}

function finalizeRule(
    state: MatchState,
    request: string,
    results: any[],
    pending: MatchState[],
) {
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
        pending.push(state);
        return;
    }
    if (state.pendingWildcard !== undefined) {
        const value = captureWildcard(
            request,
            state.pendingWildcard.start,
            request.length,
        );
        if (value === undefined) {
            return;
        }
        state.index = request.length;
        addValueWithId(state, state.pendingWildcard.valueId, value);
    }
    if (state.index < request.length) {
        // Detect trailing separators
        separatorRegExp.lastIndex = state.index;
        const match = separatorRegExp.exec(request);
        if (match === null || state.index + match[0].length < request.length) {
            const trailing = match
                ? state.index + match[0].length
                : state.index;
            debugMatch(
                `Reject with trailing text at ${trailing}: ${request.slice(trailing)}`,
            );
            return;
        }
        debugMatch(
            `Consume trailing separators at ${state.index} to ${state.index + match[0].length}`,
        );
    }
    debugMatch(
        `Matched at end of input. Matched ids: ${JSON.stringify(state.valueIds)}, values: ${JSON.stringify(state.values)}'`,
    );
    results.push(createValue(state.rule.value, state.valueIds, state.values));
}

type MatchResult = any;
function matchRules(grammar: Grammar, request: string): MatchResult[] {
    const pending: MatchState[] = grammar.rules.map((r, i) => ({
        name: `<Start>[${i}]`,
        rule: r,
        partIndex: 0,
        index: 0,
        nextValueId: 0,
    }));
    const results: MatchResult[] = [];
    while (pending.length > 0) {
        const state = pending.shift()!;
        const { rule, partIndex } = state;
        if (partIndex >= rule.parts.length) {
            finalizeRule(state, request, results, pending);
            continue;
        }

        const part = rule.parts[partIndex];
        const curr = state.index;
        debugMatch(
            `State ${state.name}{${partIndex}}: @${curr}, type=${JSON.stringify(part.type)} pendingWildcard=${JSON.stringify(state.pendingWildcard)}`,
        );
        state.partIndex++;
        switch (part.type) {
            case "string":
                debugMatch(
                    `  Checking string expr "${part.value.join(" ")}" at ${curr} with${state.pendingWildcard ? "" : "out"} wildcard`,
                );
                // REVIEW: better separator policy
                const regExpStr = `[${separatorRegExpStr}]*?${part.value.map(escapeMatch).join(`[${separatorRegExpStr}]+`)}`;
                if (state.pendingWildcard !== undefined) {
                    const regExp = new RegExp(regExpStr, "iug");
                    regExp.lastIndex = curr;
                    while (true) {
                        const match = regExp.exec(request);
                        if (match === null) {
                            break;
                        }
                        const wildcardEnd = match.index;
                        const newIndex = wildcardEnd + match[0].length;
                        if (!isSeparated(request, newIndex)) {
                            debugMatch(
                                `  Rejected non-separated matched string ${part.value.join(" ")} at ${wildcardEnd}`,
                            );
                            continue;
                        }
                        debugMatch(
                            `  Matched string ${part.value.join(" ")} at ${wildcardEnd}`,
                        );
                        const newState = createCaptureWildcardState(
                            state,
                            request,
                            wildcardEnd,
                            newIndex,
                        );
                        if (newState !== undefined) {
                            // Add value for wildcard
                            pending.push(newState);
                        }
                        // continue to look for possible longer matches
                    }
                } else {
                    const regExp = new RegExp(regExpStr, "iuy");
                    regExp.lastIndex = curr;
                    const match = regExp.exec(request);
                    if (match !== null) {
                        const newIndex = curr + match[0].length;
                        if (isSeparated(request, newIndex)) {
                            debugMatch(
                                `  Matched string ${part.value.join(" ")} at ${curr} to ${newIndex}`,
                            );
                            // Reuse state
                            state.index = newIndex;
                            pending.push(state);
                        } else {
                            debugMatch(
                                `  Rejected non-separated matched string ${part.value.join(" ")} at ${curr}`,
                            );
                        }
                    }
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
                    partIndex: state.partIndex,
                    valueIds: state.valueIds,
                    prev: state.nested,
                };
                let i = 0;
                for (const rule of rules) {
                    pending.push({
                        name: part.name
                            ? `<${part.name}>[${i}]`
                            : `${state.name}{${partIndex}}[${i}]`,
                        rule,
                        partIndex: 0,

                        nextValueId: state.nextValueId,
                        values: state.values,
                        nested,

                        index: curr,
                        pendingWildcard: state.pendingWildcard,
                    });
                    i++;
                }
                if (part.optional) {
                    // Reuse state
                    if (part.variable) {
                        addValue(state, part.variable, undefined);
                    }
                    pending.push(state);
                }
                break;
            }
            case "number":
                if (part.optional) {
                    const newState = { ...state };
                    addValue(newState, part.variable, undefined);
                    pending.push(newState);
                }
                debugMatch(
                    `  Checking number expr at ${curr} with${state.pendingWildcard ? "" : "out"} wildcard`,
                );
                if (state.pendingWildcard !== undefined) {
                    const regexp =
                        /[\s\p{P}]*?(0o[0-7]+|0x[0-9a-f]+|0b[01]+|([+-]?[0-9]+)(\.[0-9]+)?(e[+-]?[1-9][0-9]*)?)/giu;
                    regexp.lastIndex = curr;
                    while (true) {
                        const match = regexp.exec(request);
                        if (match === null) {
                            break;
                        }
                        const n = Number(match[1]);
                        if (isNaN(n)) {
                            continue;
                        }

                        const wildcardEnd = match.index;
                        const newIndex = wildcardEnd + match[0].length;
                        debugMatch(
                            `  Matched number at ${wildcardEnd} to ${newIndex}`,
                        );
                        const newState = createCaptureWildcardState(
                            state,
                            request,
                            wildcardEnd,
                            newIndex,
                        );
                        if (newState !== undefined) {
                            addValue(newState, part.variable, n);
                            pending.push(newState);
                        }
                        // continue to look for possible longer matches
                    }
                } else {
                    const regexp =
                        /[\s\p{P}]*?(0o[0-7]+|0x[0-9a-f]+|0b[01]+|([+-]?[0-9]+)(\.[0-9]+)?(e[+-]?[1-9][0-9]*)?)/iuy;
                    regexp.lastIndex = curr;
                    const m = regexp.exec(request);
                    if (m === null) {
                        continue;
                    }
                    const n = Number(m[1]);
                    if (isNaN(n)) {
                        continue;
                    }
                    const newIndex = curr + m[0].length;
                    debugMatch(`  Matched number at ${curr} to ${newIndex}`);
                    state.index = newIndex;
                    addValue(state, part.variable, n);
                    pending.push(state);
                }

                break;
            case "wildcard":
                if (part.optional) {
                    const newState = { ...state };
                    addValue(newState, part.variable, undefined);
                    pending.push(newState);
                }
                // string variable, wildcard
                if (state.pendingWildcard !== undefined) {
                    // Disallow two wildcards in a row
                    continue;
                }
                // Reuse state
                state.pendingWildcard = {
                    valueId: addValueId(state, part.variable),
                    start: state.index,
                };
                pending.push(state);
                break;
        }
    }

    return results;
}

export function matchGrammar(grammar: Grammar, request: string) {
    return matchRules(grammar, request);
}

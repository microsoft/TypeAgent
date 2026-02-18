// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { NFA, NFATransition } from "./nfa.js";
import {
    GrammarCompletionResult,
    GrammarCompletionProperty,
} from "./grammarMatcher.js";
import registerDebug from "debug";

const debugCompletion = registerDebug("typeagent:nfa:completion");

/**
 * Determine whether a wildcard transition is "checked"
 * (has a type constraint beyond plain string/wildcard).
 */
function isCheckedWildcard(trans: NFATransition): boolean {
    return (
        trans.checked === true ||
        (trans.typeName !== undefined &&
            trans.typeName !== "string" &&
            trans.typeName !== "wildcard")
    );
}

/**
 * Compute the epsilon closure of a set of state IDs.
 * Returns all NFA state IDs reachable via epsilon transitions.
 * This is a simplified version — no environment tracking needed for completions.
 */
function simpleEpsilonClosure(nfa: NFA, stateIds: number[]): number[] {
    const visited = new Set<number>();
    const queue = [...stateIds];

    while (queue.length > 0) {
        const id = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);

        const state = nfa.states[id];
        if (!state) continue;

        for (const trans of state.transitions) {
            if (trans.type === "epsilon" && !visited.has(trans.to)) {
                queue.push(trans.to);
            }
        }
    }

    return Array.from(visited);
}

/**
 * Walk the NFA consuming complete tokens.
 * Returns the set of NFA state IDs reachable after consuming all tokens.
 *
 * Token transitions take priority over wildcards: if ANY state in the
 * current set has a token transition matching the current word, wildcard
 * transitions are suppressed for that step.  Wildcards only fire when
 * no token transition matches — this prevents wildcard self-loops from
 * polluting completions once a grammar keyword (like "by") is reached.
 */
function walkPrefixTokens(nfa: NFA, tokens: string[]): number[] {
    // Start with epsilon closure of start state
    let currentStates = simpleEpsilonClosure(nfa, [nfa.startState]);
    debugCompletion(
        `  walkPrefix: start epsilon closure: [${currentStates.join(", ")}] (${currentStates.length} states)`,
    );

    for (const token of tokens) {
        const tokenMatched: number[] = [];
        const wildcardMatched: number[] = [];
        const lowerToken = token.toLowerCase();

        for (const stateId of currentStates) {
            const state = nfa.states[stateId];
            if (!state) continue;

            for (const trans of state.transitions) {
                if (trans.type === "token" && trans.tokens) {
                    if (
                        trans.tokens.some(
                            (t) => t.toLowerCase() === lowerToken,
                        )
                    ) {
                        debugCompletion(
                            `  walkPrefix: state ${stateId} --[${trans.tokens.join("|")}]--> ${trans.to} (token matched "${token}")`,
                        );
                        tokenMatched.push(trans.to);
                    }
                } else if (trans.type === "wildcard") {
                    debugCompletion(
                        `  walkPrefix: state ${stateId} --*${trans.variable || ""}:${trans.typeName || "any"}--> ${trans.to} (wildcard candidate "${token}")`,
                    );
                    wildcardMatched.push(trans.to);
                }
            }
        }

        // Prefer token transitions; fall back to wildcard only when no token matches
        const nextStates =
            tokenMatched.length > 0 ? tokenMatched : wildcardMatched;

        if (nextStates.length === 0) {
            debugCompletion(
                `  walkPrefix: no transitions matched "${token}" — dead end`,
            );
            return [];
        }

        debugCompletion(
            `  walkPrefix: "${token}" → ${tokenMatched.length > 0 ? "token" : "wildcard"} path (${nextStates.length} targets)`,
        );
        currentStates = simpleEpsilonClosure(nfa, nextStates);
        debugCompletion(
            `  walkPrefix: after "${token}" epsilon closure: [${currentStates.join(", ")}] (${currentStates.length} states)`,
        );
    }

    return currentStates;
}

/**
 * Property completion info collected from checked wildcard transitions.
 * Built from compile-time annotations on the transition itself.
 */
interface PropertyCompletion {
    actionName: string;
    propertyPath: string;
    variable: string;
    typeName?: string | undefined;
}

/**
 * From a set of reachable states, explore the immediate next completions.
 *
 * Returns minimal (next token only) completions — not maximal multi-token paths.
 * The shell filters locally by partial token; the NFA returns all possibilities.
 *
 * Rules:
 * - Token transitions: return the immediate next token (all of them — shell filters)
 * - Checked wildcard: property completion (entity values from agent)
 * - Unchecked wildcard: drop thread
 */
function exploreCompletions(
    nfa: NFA,
    reachableStates: number[],
): { completions: string[]; properties: PropertyCompletion[] } {
    const completions = new Set<string>();
    const properties: PropertyCompletion[] = [];

    debugCompletion(
        `  exploreCompletions: ${reachableStates.length} reachable states`,
    );

    // For each reachable state, check for nested rule entry annotations
    // (these represent property completions from nested rules references)
    for (const stateId of reachableStates) {
        const state = nfa.states[stateId];
        if (!state) continue;

        if (state.completionActionName && state.completionPropertyPath) {
            debugCompletion(
                `  exploreCompletions: state ${stateId} → nested rule property: action=${state.completionActionName}, path=${state.completionPropertyPath}`,
            );
            properties.push({
                actionName: state.completionActionName,
                propertyPath: state.completionPropertyPath,
                variable: "",
            });
        }
    }

    // For each reachable state, look at outgoing transitions
    for (const stateId of reachableStates) {
        const state = nfa.states[stateId];
        if (!state) continue;

        for (const trans of state.transitions) {
            if (trans.type === "epsilon") {
                // Epsilons are already handled by the closure — skip
                continue;
            }

            if (trans.type === "wildcard") {
                if (isCheckedWildcard(trans)) {
                    debugCompletion(
                        `  exploreCompletions: state ${stateId} → checked wildcard var=${trans.variable}, action=${trans.actionName}, path=${trans.propertyPath}`,
                    );
                    if (trans.actionName && trans.propertyPath) {
                        properties.push({
                            actionName: trans.actionName,
                            propertyPath: trans.propertyPath,
                            variable: trans.variable ?? "",
                            typeName: trans.typeName,
                        });
                    }
                } else {
                    debugCompletion(
                        `  exploreCompletions: state ${stateId} → unchecked wildcard (dropped)`,
                    );
                }
                continue;
            }

            if (trans.type === "token" && trans.tokens) {
                // Token transition — return all tokens (shell filters locally)
                for (const tok of trans.tokens) {
                    debugCompletion(
                        `  exploreCompletions: state ${stateId} → token "${tok}"`,
                    );
                    completions.add(tok);
                }
            }
        }
    }

    return {
        completions: Array.from(completions),
        properties,
    };
}

/**
 * Compute completions for a sequence of complete tokens using the NFA.
 *
 * Callers always provide whole tokens — completions are requested only at
 * token boundaries (after a space).  The shell filters locally by any
 * partial token the user is still typing.
 *
 * Algorithm:
 * 1. If tokens is empty, return completions from the start state
 * 2. Walk NFA consuming all tokens
 * 3. From reachable states, gather:
 *    - Token transitions: all immediate next tokens
 *    - Checked wildcards: property completions (entity values from agent)
 *    - Unchecked wildcards: dropped
 *
 * @param nfa The compiled NFA
 * @param tokens Array of complete tokens (empty = start state)
 * @returns Completion result with string completions and property completions
 */
export function computeNFACompletions(
    nfa: NFA,
    tokens: string[],
): GrammarCompletionResult {
    debugCompletion(
        `\n=== NFA Completion for tokens: [${tokens.map((t) => `"${t}"`).join(", ")}] ===`,
    );

    // Determine reachable states: start state for empty tokens, or walk
    let reachableStates: number[];
    if (tokens.length === 0) {
        debugCompletion(`  empty tokens — using start state`);
        reachableStates = simpleEpsilonClosure(nfa, [nfa.startState]);
    } else {
        reachableStates = walkPrefixTokens(nfa, tokens);
    }

    debugCompletion(
        `  reachable states: [${reachableStates.join(", ")}] (${reachableStates.length} states)`,
    );

    if (reachableStates.length === 0) {
        debugCompletion(`  → no reachable states, returning empty`);
        return { completions: [] };
    }

    // Explore completions from reachable states
    const { completions, properties } = exploreCompletions(
        nfa,
        reachableStates,
    );

    debugCompletion(
        `  completions: [${completions.map((c) => `"${c}"`).join(", ")}]`,
    );
    debugCompletion(
        `  properties: [${properties.map((p) => `${p.actionName}.${p.propertyPath}`).join(", ")}]`,
    );

    const uniqueCompletions = deduplicateCompletions(completions);

    debugCompletion(
        `  → returning ${uniqueCompletions.length} unique completions, ${properties.length} properties\n`,
    );

    const result: GrammarCompletionResult = {
        completions: uniqueCompletions,
    };
    const grammarProperties = buildGrammarProperties(nfa, properties);
    if (grammarProperties.length > 0) {
        result.properties = grammarProperties;
    }
    return result;
}

/**
 * Build GrammarCompletionProperty objects from PropertyCompletion info.
 * Uses the NFA's schema name (nfa.name) and the transition's actionName/propertyPath
 * to construct the match object that grammarStore.ts expects.
 */
function buildGrammarProperties(
    nfa: NFA,
    properties: PropertyCompletion[],
): GrammarCompletionProperty[] {
    if (properties.length === 0) return [];

    // Deduplicate by actionName + propertyPath
    const seen = new Set<string>();
    const result: GrammarCompletionProperty[] = [];

    for (const prop of properties) {
        const key = `${prop.actionName}:${prop.propertyPath}`;
        if (seen.has(key)) continue;
        seen.add(key);

        // Construct the match object in the format grammarStore.ts expects:
        // { actionName, parameters: {} }
        // The actual parameter values don't matter for completion —
        // only actionName and the propertyNames are used downstream.
        result.push({
            match: {
                actionName: prop.actionName,
                parameters: {},
            },
            propertyNames: [prop.propertyPath],
        });
    }

    return result;
}

/**
 * Deduplicate completions (case-insensitive).
 */
function deduplicateCompletions(completions: string[]): string[] {
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const c of completions) {
        const lower = c.toLowerCase();
        if (!seen.has(lower)) {
            seen.add(lower);
            unique.push(c);
        }
    }
    return unique;
}

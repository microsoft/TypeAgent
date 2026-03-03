// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { NFA, NFATransition } from "./nfa.js";
import {
    DFA,
    DFABuilder,
    DFAExecutionContext,
    DFAWildcardTransition,
} from "./dfa.js";

/**
 * Compile an NFA to a DFA using subset construction.
 *
 * The DFA structure is used for two purposes:
 *   1. getDFACompletions — deterministic prefix traversal + completion metadata
 *   2. matchDFA — delegates value computation to matchNFA(dfa.sourceNFA, tokens)
 *
 * Because value computation is handled by the NFA interpreter at match time,
 * slot operations (preOps/postOps/consumeOp/actionValue) are NOT computed here.
 * The compiler records only what is needed for state traversal and completions:
 *   - transitions: token → targetState, wildcardTransition, phraseSetTransitions
 *   - captureInfo on wildcardTransitions: variable/typeName/checked/actionName/propertyPath
 *   - context.ruleIndex: for grouping completions by grammar rule
 *   - state.accepting: for prefix-complete detection
 */
export function compileNFAToDFA(nfa: NFA, name?: string): DFA {
    const builder = new DFABuilder();

    // Collect split candidates from NFA states (sorted longest-first)
    const allSplitCandidates = new Set<string>();
    for (const state of nfa.states) {
        if (state.splitCandidates) {
            for (const c of state.splitCandidates) allSplitCandidates.add(c);
        }
    }

    // Bootstrap: epsilon closure from the NFA start state
    const initialContext: DFAExecutionContext = {
        nfaStateIds: new Set([nfa.startState]),
        priority: {
            fixedStringPartCount: 0,
            checkedWildcardCount: 0,
            uncheckedWildcardCount: 0,
        },
    };

    const initialContexts = epsilonClosure(nfa, [initialContext]);
    const startState = builder.createState(initialContexts);

    const worklist: number[] = [startState];
    const processed = new Set<number>();
    const acceptingStates = new Set<number>();
    const nfaAcceptingStates = new Set(nfa.acceptingStates);

    while (worklist.length > 0) {
        const dfaStateId = worklist.shift()!;
        if (processed.has(dfaStateId)) continue;
        processed.add(dfaStateId);

        const dfaState = builder.getState(dfaStateId);
        if (!dfaState) continue;

        // Mark accepting if any NFA state in any context is accepting
        for (const ctx of dfaState.contexts) {
            for (const nfaStateId of ctx.nfaStateIds) {
                if (nfaAcceptingStates.has(nfaStateId)) {
                    acceptingStates.add(dfaStateId);
                    builder.markAccepting(dfaStateId, nfaAcceptingStates);
                    break;
                }
            }
            if (acceptingStates.has(dfaStateId)) break;
        }

        // Compute and wire up transitions
        const transitions = computeTransitions(nfa, dfaState.contexts);

        for (const [token, info] of transitions.tokenTransitions) {
            const targetStateId = builder.createState(info.targetContexts);
            builder.addTransition(dfaStateId, token, targetStateId);
            if (!processed.has(targetStateId)) worklist.push(targetStateId);
        }

        if (transitions.wildcardTransition) {
            const { targetContexts, captureInfo } =
                transitions.wildcardTransition;
            const targetStateId = builder.createState(targetContexts);
            builder.addWildcardTransition(
                dfaStateId,
                targetStateId,
                captureInfo,
            );
            if (!processed.has(targetStateId)) worklist.push(targetStateId);
        }

        for (const pst of transitions.phraseSetTransitions ?? []) {
            const targetStateId = builder.createState(pst.targetContexts);
            builder.addPhraseSetTransition(
                dfaStateId,
                pst.matcherName,
                targetStateId,
            );
            if (!processed.has(targetStateId)) worklist.push(targetStateId);
        }
    }

    const splitCandidates =
        allSplitCandidates.size > 0
            ? Array.from(allSplitCandidates).sort((a, b) => b.length - a.length)
            : undefined;

    const dfa = builder.build(
        startState,
        acceptingStates,
        name,
        splitCandidates,
    );
    // Store NFA reference so matchDFA can use thread-based value computation
    dfa.sourceNFA = nfa;
    // Free execution contexts — match-time data now lives directly on DFAState
    DFABuilder.compact(dfa);
    return dfa;
}

/**
 * Compute the epsilon closure of a set of execution contexts.
 *
 * Follows epsilon transitions to find all reachable NFA states without
 * consuming input.  Only ruleIndex is propagated — slot operations and
 * priority counters are not tracked because matchDFA delegates value
 * computation to matchNFA.
 */
function epsilonClosure(
    nfa: NFA,
    contexts: DFAExecutionContext[],
): DFAExecutionContext[] {
    const result: DFAExecutionContext[] = [];
    // Key: sorted NFA state IDs + ruleIndex (to keep distinct rules separate for completion grouping)
    const visited = new Set<string>();

    const queue = [...contexts];
    while (queue.length > 0) {
        const ctx = queue.shift()!;

        const key = `${Array.from(ctx.nfaStateIds).sort().join(",")}-${ctx.ruleIndex ?? ""}`;
        if (visited.has(key)) continue;
        visited.add(key);
        result.push(ctx);

        for (const nfaStateId of ctx.nfaStateIds) {
            const nfaState = nfa.states[nfaStateId];
            if (!nfaState) continue;

            // Propagate rule index from the NFA state if not already set
            const ruleIndex =
                ctx.ruleIndex !== undefined
                    ? ctx.ruleIndex
                    : nfaState.ruleIndex;

            for (const trans of nfaState.transitions) {
                if (trans.type !== "epsilon") continue;

                const targetState = nfa.states[trans.to];
                const newContext: DFAExecutionContext = {
                    nfaStateIds: new Set([trans.to]),
                    priority: {
                        fixedStringPartCount: 0,
                        checkedWildcardCount: 0,
                        uncheckedWildcardCount: 0,
                    },
                };

                if (ruleIndex !== undefined) {
                    newContext.ruleIndex = ruleIndex;
                } else if (targetState?.ruleIndex !== undefined) {
                    newContext.ruleIndex = targetState.ruleIndex;
                }

                queue.push(newContext);
            }
        }
    }

    return result;
}

/**
 * Transition result — no slot operations, just state routing and completion metadata.
 */
interface TransitionResult {
    tokenTransitions: Map<string, { targetContexts: DFAExecutionContext[] }>;

    wildcardTransition?: {
        targetContexts: DFAExecutionContext[];
        /** Completion metadata: variable name, type, checked flag, property path */
        captureInfo: DFAWildcardTransition["captureInfo"];
    };

    phraseSetTransitions?: Array<{
        matcherName: string;
        targetContexts: DFAExecutionContext[];
    }>;
}

/**
 * Compute all outgoing transitions from a DFA state's execution contexts.
 *
 * Groups NFA transitions by token/wildcard/phraseSet.  No slot operations
 * are computed — the DFA is used for state traversal and completions only.
 */
function computeTransitions(
    nfa: NFA,
    contexts: DFAExecutionContext[],
): TransitionResult {
    // token → raw target contexts (before epsilon closure)
    const tokenTargetsRaw = new Map<string, DFAExecutionContext[]>();

    // wildcard sources
    const wildcardSources: Array<{
        context: DFAExecutionContext;
        transition: NFATransition;
    }> = [];

    // phraseSet matcherName → raw target contexts
    const phraseSetTargetsRaw = new Map<string, DFAExecutionContext[]>();

    for (const ctx of contexts) {
        for (const nfaStateId of ctx.nfaStateIds) {
            const nfaState = nfa.states[nfaStateId];
            if (!nfaState) continue;

            for (const trans of nfaState.transitions) {
                if (trans.type === "token" && trans.tokens) {
                    for (const token of trans.tokens) {
                        if (!tokenTargetsRaw.has(token)) {
                            tokenTargetsRaw.set(token, []);
                        }
                        const newCtx: DFAExecutionContext = {
                            nfaStateIds: new Set([trans.to]),
                            priority: {
                                fixedStringPartCount: 0,
                                checkedWildcardCount: 0,
                                uncheckedWildcardCount: 0,
                            },
                        };
                        if (ctx.ruleIndex !== undefined) {
                            newCtx.ruleIndex = ctx.ruleIndex;
                        }
                        tokenTargetsRaw.get(token)!.push(newCtx);
                    }
                } else if (trans.type === "wildcard") {
                    wildcardSources.push({ context: ctx, transition: trans });
                } else if (trans.type === "phraseSet" && trans.matcherName) {
                    const mn = trans.matcherName;
                    if (!phraseSetTargetsRaw.has(mn)) {
                        phraseSetTargetsRaw.set(mn, []);
                    }
                    const newCtx: DFAExecutionContext = {
                        nfaStateIds: new Set([trans.to]),
                        priority: {
                            fixedStringPartCount: 0,
                            checkedWildcardCount: 0,
                            uncheckedWildcardCount: 0,
                        },
                    };
                    if (ctx.ruleIndex !== undefined) {
                        newCtx.ruleIndex = ctx.ruleIndex;
                    }
                    phraseSetTargetsRaw.get(mn)!.push(newCtx);
                }
            }
        }
    }

    // Token transitions — apply epsilon closure
    const tokenTransitions = new Map<
        string,
        { targetContexts: DFAExecutionContext[] }
    >();
    for (const [token, rawCtxs] of tokenTargetsRaw) {
        tokenTransitions.set(token, {
            targetContexts: epsilonClosure(nfa, rawCtxs),
        });
    }

    // Wildcard transition — merge all sources into one, build captureInfo
    let wildcardTransition: TransitionResult["wildcardTransition"];
    if (wildcardSources.length > 0) {
        const rawTargets: DFAExecutionContext[] = [];
        // Keyed by "variable:typeName" to deduplicate capture entries
        const captureMap = new Map<
            string,
            DFAWildcardTransition["captureInfo"][number]
        >();

        for (const { context, transition } of wildcardSources) {
            const isChecked =
                transition.checked === true ||
                !!(
                    transition.typeName &&
                    transition.typeName !== "string" &&
                    transition.typeName !== "wildcard"
                );

            const newCtx: DFAExecutionContext = {
                nfaStateIds: new Set([transition.to]),
                priority: {
                    fixedStringPartCount: 0,
                    checkedWildcardCount: 0,
                    uncheckedWildcardCount: 0,
                },
            };
            if (context.ruleIndex !== undefined) {
                newCtx.ruleIndex = context.ruleIndex;
            }
            rawTargets.push(newCtx);

            // Build captureInfo entry (variable/typeName/checked + property path for completions)
            const captureKey = `${transition.variable ?? ""}:${transition.typeName ?? "string"}`;
            if (!captureMap.has(captureKey)) {
                const entry: DFAWildcardTransition["captureInfo"][number] = {
                    variable: transition.variable ?? "",
                    checked: isChecked,
                    contextIndices: [], // unused — kept for type compatibility
                };
                if (transition.typeName !== undefined) {
                    entry.typeName = transition.typeName;
                }
                if (transition.actionName !== undefined) {
                    entry.actionName = transition.actionName;
                }
                if (transition.propertyPath !== undefined) {
                    entry.propertyPath = transition.propertyPath;
                }
                captureMap.set(captureKey, entry);
            }
        }

        wildcardTransition = {
            targetContexts: epsilonClosure(nfa, rawTargets),
            captureInfo: Array.from(captureMap.values()),
        };
    }

    // PhraseSet transitions — apply epsilon closure
    const phraseSetTransitions: TransitionResult["phraseSetTransitions"] = [];
    for (const [matcherName, rawCtxs] of phraseSetTargetsRaw) {
        phraseSetTransitions.push({
            matcherName,
            targetContexts: epsilonClosure(nfa, rawCtxs),
        });
    }

    const result: TransitionResult = { tokenTransitions };
    if (wildcardTransition !== undefined) {
        result.wildcardTransition = wildcardTransition;
    }
    if (phraseSetTransitions.length > 0) {
        result.phraseSetTransitions = phraseSetTransitions;
    }
    return result;
}

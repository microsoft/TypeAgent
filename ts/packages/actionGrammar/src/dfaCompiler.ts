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
 * Compile an NFA to a DFA using subset construction
 *
 * This preserves:
 * - Priority information for rule ranking
 * - Variable bindings for captures
 * - Completion support for prefix matching
 *
 * The DFA is deterministic but tracks multiple execution contexts
 * to maintain information from all possible NFA paths.
 */
export function compileNFAToDFA(nfa: NFA, name?: string): DFA {
    const builder = new DFABuilder();

    // Start with epsilon closure of NFA start state
    const initialContext: DFAExecutionContext = {
        nfaStateIds: new Set([nfa.startState]),
        captures: new Map(),
        priority: {
            fixedStringPartCount: 0,
            checkedWildcardCount: 0,
            uncheckedWildcardCount: 0,
        },
        ruleIndex: undefined,
    };

    const initialContexts = epsilonClosure(nfa, [initialContext]);
    const startState = builder.createState(initialContexts);

    // Work queue for DFA states to process
    const worklist: number[] = [startState];
    const processed = new Set<number>();
    const acceptingStates = new Set<number>();

    // NFA accepting states set for priority computation
    const nfaAcceptingStates = new Set(nfa.acceptingStates);

    while (worklist.length > 0) {
        const dfaStateId = worklist.shift()!;

        if (processed.has(dfaStateId)) {
            continue;
        }
        processed.add(dfaStateId);

        const dfaState = builder.getState(dfaStateId);
        if (!dfaState) continue;

        // Check if this is an accepting state
        const hasAcceptingState = dfaState.contexts.some((ctx) =>
            Array.from(ctx.nfaStateIds).some((id) =>
                nfaAcceptingStates.has(id),
            ),
        );

        if (hasAcceptingState) {
            acceptingStates.add(dfaStateId);
            builder.markAccepting(dfaStateId, nfaAcceptingStates);
        }

        // Compute transitions from this DFA state
        const transitions = computeTransitions(nfa, dfaState.contexts);

        // Add token transitions
        for (const [token, targetContexts] of transitions.tokenTransitions) {
            const targetStateId = builder.createState(targetContexts);
            builder.addTransition(dfaStateId, token, targetStateId);

            if (!processed.has(targetStateId)) {
                worklist.push(targetStateId);
            }
        }

        // Add wildcard transition if present
        if (transitions.wildcardTransition) {
            const { targetContexts, captureInfo } =
                transitions.wildcardTransition;
            const targetStateId = builder.createState(targetContexts);
            builder.addWildcardTransition(
                dfaStateId,
                targetStateId,
                captureInfo,
            );

            if (!processed.has(targetStateId)) {
                worklist.push(targetStateId);
            }
        }
    }

    return builder.build(startState, acceptingStates, name);
}

/**
 * Compute epsilon closure of a set of execution contexts
 *
 * Follows epsilon transitions to find all reachable NFA states
 * without consuming input
 */
function epsilonClosure(
    nfa: NFA,
    contexts: DFAExecutionContext[],
): DFAExecutionContext[] {
    const result: DFAExecutionContext[] = [];
    const visited = new Map<string, DFAExecutionContext>(); // key -> context

    const queue = [...contexts];

    while (queue.length > 0) {
        const ctx = queue.shift()!;

        // Create key for this context based on NFA states and priority
        const key = `${Array.from(ctx.nfaStateIds).sort().join(",")}-${ctx.priority.fixedStringPartCount}-${ctx.priority.checkedWildcardCount}-${ctx.priority.uncheckedWildcardCount}`;

        if (visited.has(key)) {
            continue;
        }
        visited.set(key, ctx);
        result.push(ctx);

        // Follow epsilon transitions from all NFA states in this context
        for (const nfaStateId of ctx.nfaStateIds) {
            const nfaState = nfa.states[nfaStateId];
            if (!nfaState) continue;

            // Pick up rule index from this state if present
            const ruleIndex =
                ctx.ruleIndex !== undefined
                    ? ctx.ruleIndex
                    : nfaState.ruleIndex;

            for (const trans of nfaState.transitions) {
                if (trans.type === "epsilon") {
                    // Get target state to check for rule index
                    const targetState = nfa.states[trans.to];

                    // Create new context with epsilon transition target
                    const newContext: DFAExecutionContext = {
                        nfaStateIds: new Set([trans.to]),
                        captures: new Map(ctx.captures),
                        priority: { ...ctx.priority },
                    };

                    // Propagate or pick up rule index
                    if (ruleIndex !== undefined) {
                        newContext.ruleIndex = ruleIndex;
                    } else if (targetState?.ruleIndex !== undefined) {
                        newContext.ruleIndex = targetState.ruleIndex;
                    }

                    queue.push(newContext);
                }
            }
        }
    }

    return result;
}

/**
 * Result of computing transitions from a DFA state
 */
interface TransitionResult {
    /** Token-specific transitions */
    tokenTransitions: Map<string, DFAExecutionContext[]>;

    /** Wildcard transition (if any) */
    wildcardTransition?: {
        targetContexts: DFAExecutionContext[];
        captureInfo: DFAWildcardTransition["captureInfo"];
    };
}

/**
 * Compute all transitions from a set of execution contexts
 *
 * Groups NFA transitions by token and computes target contexts
 */
function computeTransitions(
    nfa: NFA,
    contexts: DFAExecutionContext[],
): TransitionResult {
    const tokenTransitions = new Map<string, DFAExecutionContext[]>();
    const wildcardContexts: Array<{
        context: DFAExecutionContext;
        transition: NFATransition;
    }> = [];

    // Process each execution context
    for (let ctxIndex = 0; ctxIndex < contexts.length; ctxIndex++) {
        const ctx = contexts[ctxIndex];

        // Process each NFA state in this context
        for (const nfaStateId of ctx.nfaStateIds) {
            const nfaState = nfa.states[nfaStateId];
            if (!nfaState) continue;

            // Process each transition from this NFA state
            for (const trans of nfaState.transitions) {
                if (trans.type === "token" && trans.tokens) {
                    // Token transition - add to token map
                    for (const token of trans.tokens) {
                        if (!tokenTransitions.has(token)) {
                            tokenTransitions.set(token, []);
                        }

                        // Create new context after consuming this token
                        const newContext: DFAExecutionContext = {
                            nfaStateIds: new Set([trans.to]),
                            captures: new Map(ctx.captures),
                            priority: {
                                ...ctx.priority,
                                fixedStringPartCount:
                                    ctx.priority.fixedStringPartCount + 1,
                            },
                        };

                        // Propagate rule index
                        if (ctx.ruleIndex !== undefined) {
                            newContext.ruleIndex = ctx.ruleIndex;
                        }

                        tokenTransitions.get(token)!.push(newContext);
                    }
                } else if (trans.type === "wildcard") {
                    // Wildcard transition - collect for later processing
                    wildcardContexts.push({
                        context: ctx,
                        transition: trans,
                    });
                }
            }
        }
    }

    // Apply epsilon closure to all token transitions
    for (const [token, targetContexts] of tokenTransitions) {
        tokenTransitions.set(token, epsilonClosure(nfa, targetContexts));
    }

    // Process wildcard transitions
    let wildcardTransition: TransitionResult["wildcardTransition"];
    if (wildcardContexts.length > 0) {
        const targetContexts: DFAExecutionContext[] = [];
        const captureInfo: DFAWildcardTransition["captureInfo"] = [];

        for (const { context, transition } of wildcardContexts) {
            // Determine if this wildcard is checked
            const isChecked =
                transition.checked === true ||
                !!(transition.typeName && transition.typeName !== "string");

            // Create new context after consuming wildcard
            const newContext: DFAExecutionContext = {
                nfaStateIds: new Set([transition.to]),
                captures: new Map(context.captures),
                priority: {
                    fixedStringPartCount: context.priority.fixedStringPartCount,
                    checkedWildcardCount: isChecked
                        ? context.priority.checkedWildcardCount + 1
                        : context.priority.checkedWildcardCount,
                    uncheckedWildcardCount: isChecked
                        ? context.priority.uncheckedWildcardCount
                        : context.priority.uncheckedWildcardCount + 1,
                },
            };

            // Propagate rule index
            if (context.ruleIndex !== undefined) {
                newContext.ruleIndex = context.ruleIndex;
            }

            // Update captures if variable is bound
            if (transition.variable) {
                const captureInfo: { variable: string; typeName?: string } = {
                    variable: transition.variable,
                };
                if (transition.typeName !== undefined) {
                    captureInfo.typeName = transition.typeName;
                }
                newContext.captures.set(transition.variable, captureInfo);
            }

            targetContexts.push(newContext);

            // Track capture info for this wildcard
            if (transition.variable) {
                const wildcardCapture: {
                    variable: string;
                    typeName?: string;
                    checked: boolean;
                    contextIndices: number[];
                } = {
                    variable: transition.variable,
                    checked: isChecked,
                    contextIndices: [targetContexts.length - 1],
                };
                if (transition.typeName !== undefined) {
                    wildcardCapture.typeName = transition.typeName;
                }
                captureInfo.push(wildcardCapture);
            }
        }

        wildcardTransition = {
            targetContexts: epsilonClosure(nfa, targetContexts),
            captureInfo,
        };
    }

    const result: TransitionResult = {
        tokenTransitions,
    };
    if (wildcardTransition !== undefined) {
        result.wildcardTransition = wildcardTransition;
    }
    return result;
}

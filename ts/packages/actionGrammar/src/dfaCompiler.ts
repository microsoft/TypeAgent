// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { NFA, NFATransition } from "./nfa.js";
import {
    DFA,
    DFABuilder,
    DFAExecutionContext,
    DFAWildcardTransition,
    DFASlotOperation,
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
        priority: {
            fixedStringPartCount: 0,
            checkedWildcardCount: 0,
            uncheckedWildcardCount: 0,
        },
        ruleIndex: undefined,
        slotOps: [],
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
        let isAccepting = false;
        for (const ctx of dfaState.contexts) {
            for (const nfaStateId of ctx.nfaStateIds) {
                if (nfaAcceptingStates.has(nfaStateId)) {
                    isAccepting = true;
                    break;
                }
            }
            if (isAccepting) break;
        }

        if (isAccepting) {
            acceptingStates.add(dfaStateId);
            builder.markAccepting(dfaStateId, nfaAcceptingStates);

            // Now get the action value from the BEST PRIORITY context
            const markedState = builder.getState(dfaStateId);
            const bestPriorityCtx = markedState?.bestPriority;
            let bestContext: DFAExecutionContext | undefined;
            let bestNfaAcceptState: number | undefined;

            if (bestPriorityCtx !== undefined) {
                bestContext = dfaState.contexts[bestPriorityCtx.contextIndex];
                // Find the accepting NFA state in this context
                if (bestContext) {
                    for (const nfaStateId of bestContext.nfaStateIds) {
                        if (nfaAcceptingStates.has(nfaStateId)) {
                            bestNfaAcceptState = nfaStateId;
                            break;
                        }
                    }
                }
            }

            // Get action value from the best context's NFA state or its rule index
            let actionValue: any = undefined;
            let slotCount: number | undefined;
            let debugSlotMap: Map<string, number> | undefined;

            if (bestNfaAcceptState !== undefined) {
                const nfaState = nfa.states[bestNfaAcceptState];
                actionValue = nfaState?.actionValue;
                slotCount = nfaState?.slotCount;
                debugSlotMap = nfaState?.slotMap;
            }

            // If no direct actionValue, try getting from rule index
            if (actionValue === undefined && bestContext?.ruleIndex !== undefined) {
                actionValue = nfa.actionValues?.[bestContext.ruleIndex];
            }

            // Fallback to debugSlotMap from context if not on NFA state
            if (!debugSlotMap && bestContext?.debugSlotMap) {
                debugSlotMap = bestContext.debugSlotMap;
            }

            builder.setAcceptingStateInfo(
                dfaStateId,
                actionValue,
                slotCount,
                debugSlotMap,
            );
        }

        // Compute transitions from this DFA state
        const transitions = computeTransitions(nfa, dfaState.contexts);

        // Add token transitions with slot operations
        for (const [token, transInfo] of transitions.tokenTransitions) {
            const targetStateId = builder.createState(transInfo.targetContexts);
            builder.addTransition(
                dfaStateId,
                token,
                targetStateId,
                transInfo.preOps.length > 0 ? transInfo.preOps : undefined,
                transInfo.postOps.length > 0 ? transInfo.postOps : undefined,
            );

            if (!processed.has(targetStateId)) {
                worklist.push(targetStateId);
            }
        }

        // Add wildcard transition if present
        if (transitions.wildcardTransition) {
            const { targetContexts, captureInfo, preOps, consumeOp, postOps } =
                transitions.wildcardTransition;
            const targetStateId = builder.createState(targetContexts);
            builder.addWildcardTransition(
                dfaStateId,
                targetStateId,
                captureInfo,
                preOps.length > 0 ? preOps : undefined,
                consumeOp,
                postOps.length > 0 ? postOps : undefined,
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
 * without consuming input.
 *
 * Tracks slot operations encountered during closure:
 * - pushEnv: When entering a state with slotCount (nested rule entry)
 * - evalAndWriteToParent: When following an epsilon with writeToParent (nested rule exit)
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

        // Create key for this context based on NFA states, priority, and slot ops count
        // Include slot ops length to distinguish contexts with different accumulated operations
        const slotOpsKey = ctx.slotOps ? ctx.slotOps.length : 0;
        const key = `${Array.from(ctx.nfaStateIds).sort().join(",")}-${ctx.priority.fixedStringPartCount}-${ctx.priority.checkedWildcardCount}-${ctx.priority.uncheckedWildcardCount}-${slotOpsKey}`;

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

            // Check if this state has slot info (rule entry point)
            // and add pushEnv operation if we don't already have one for this state
            let newSlotOps = ctx.slotOps ? [...ctx.slotOps] : [];
            if (nfaState.slotCount !== undefined && nfaState.slotCount > 0) {
                // Check if we've already pushed env for this rule
                const alreadyPushed = newSlotOps.some(
                    op => op.type === "pushEnv" && op.slotCount === nfaState.slotCount
                );
                if (!alreadyPushed) {
                    const pushOp: DFASlotOperation = {
                        type: "pushEnv",
                        slotCount: nfaState.slotCount,
                    };
                    if (nfaState.parentSlotIndex !== undefined) {
                        pushOp.parentSlotIndex = nfaState.parentSlotIndex;
                    }
                    newSlotOps.push(pushOp);
                }
            }

            // Pick up debug slot map
            let debugSlotMap = ctx.debugSlotMap;
            if (nfaState.slotMap) {
                debugSlotMap = new Map(nfaState.slotMap);
            }

            for (const trans of nfaState.transitions) {
                if (trans.type === "epsilon") {
                    // Get target state to check for rule index
                    const targetState = nfa.states[trans.to];

                    // Clone slot ops for this path
                    let pathSlotOps = [...newSlotOps];

                    // Check for writeToParent on this epsilon transition (nested rule exit)
                    if (trans.writeToParent && trans.valueToWrite !== undefined) {
                        pathSlotOps.push({
                            type: "evalAndWriteToParent",
                            valueExpr: trans.valueToWrite,
                        });
                        // After writing to parent, pop the environment
                        pathSlotOps.push({
                            type: "popEnv",
                        });
                    }

                    // Create new context with epsilon transition target
                    const newContext: DFAExecutionContext = {
                        nfaStateIds: new Set([trans.to]),
                        priority: { ...ctx.priority },
                        slotOps: pathSlotOps,
                    };

                    // Propagate debug slot map
                    if (debugSlotMap) {
                        newContext.debugSlotMap = debugSlotMap;
                    }

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
    /** Token-specific transitions with slot operations */
    tokenTransitions: Map<string, {
        targetContexts: DFAExecutionContext[];
        preOps: DFASlotOperation[];
        postOps: DFASlotOperation[];
    }>;

    /** Wildcard transition (if any) */
    wildcardTransition?: {
        targetContexts: DFAExecutionContext[];
        captureInfo: DFAWildcardTransition["captureInfo"];
        preOps: DFASlotOperation[];
        consumeOp?: DFASlotOperation;
        postOps: DFASlotOperation[];
    };
}

/**
 * Compute all transitions from a set of execution contexts
 *
 * Groups NFA transitions by token and computes target contexts.
 * Tracks slot operations:
 * - preOps: From context.slotOps (accumulated during epsilon closure before this point)
 * - consumeOp: For wildcard transitions, the slot write operation
 * - postOps: From epsilon closure after consuming the token
 */
function computeTransitions(
    nfa: NFA,
    contexts: DFAExecutionContext[],
): TransitionResult {
    // Map token -> { contexts, preOps from source contexts }
    const tokenTransitionsRaw = new Map<string, {
        targetContexts: DFAExecutionContext[];
        preOps: DFASlotOperation[];
    }>();

    const wildcardContexts: Array<{
        context: DFAExecutionContext;
        transition: NFATransition;
        preOps: DFASlotOperation[];
    }> = [];

    // Process each execution context
    for (let ctxIndex = 0; ctxIndex < contexts.length; ctxIndex++) {
        const ctx = contexts[ctxIndex];
        // Collect preOps from this context's accumulated slot operations
        const ctxPreOps = ctx.slotOps ? [...ctx.slotOps] : [];

        // Process each NFA state in this context
        for (const nfaStateId of ctx.nfaStateIds) {
            const nfaState = nfa.states[nfaStateId];
            if (!nfaState) continue;

            // Process each transition from this NFA state
            for (const trans of nfaState.transitions) {
                if (trans.type === "token" && trans.tokens) {
                    // Token transition - add to token map
                    for (const token of trans.tokens) {
                        if (!tokenTransitionsRaw.has(token)) {
                            tokenTransitionsRaw.set(token, {
                                targetContexts: [],
                                preOps: [],
                            });
                        }

                        const entry = tokenTransitionsRaw.get(token)!;

                        // Create new context after consuming this token
                        const newContext: DFAExecutionContext = {
                            nfaStateIds: new Set([trans.to]),
                            priority: {
                                ...ctx.priority,
                                fixedStringPartCount:
                                    ctx.priority.fixedStringPartCount + 1,
                            },
                            slotOps: [], // Reset slot ops for post-consume epsilon closure
                        };

                        // Propagate rule index
                        if (ctx.ruleIndex !== undefined) {
                            newContext.ruleIndex = ctx.ruleIndex;
                        }

                        // Propagate debug slot map
                        if (ctx.debugSlotMap) {
                            newContext.debugSlotMap = ctx.debugSlotMap;
                        }

                        entry.targetContexts.push(newContext);

                        // Merge preOps (deduplicate if same ops already present)
                        for (const op of ctxPreOps) {
                            if (!entry.preOps.some(existing => slotOpsEqual(existing, op))) {
                                entry.preOps.push(op);
                            }
                        }
                    }
                } else if (trans.type === "wildcard") {
                    // Wildcard transition - collect for later processing
                    wildcardContexts.push({
                        context: ctx,
                        transition: trans,
                        preOps: ctxPreOps,
                    });
                }
            }
        }
    }

    // Apply epsilon closure to all token transitions and extract postOps
    const tokenTransitions = new Map<string, {
        targetContexts: DFAExecutionContext[];
        preOps: DFASlotOperation[];
        postOps: DFASlotOperation[];
    }>();

    for (const [token, entry] of tokenTransitionsRaw) {
        const closedContexts = epsilonClosure(nfa, entry.targetContexts);

        // Collect postOps from the epsilon closure results
        const postOps: DFASlotOperation[] = [];
        for (const ctx of closedContexts) {
            if (ctx.slotOps) {
                for (const op of ctx.slotOps) {
                    if (!postOps.some(existing => slotOpsEqual(existing, op))) {
                        postOps.push(op);
                    }
                }
            }
        }

        tokenTransitions.set(token, {
            targetContexts: closedContexts,
            preOps: entry.preOps,
            postOps,
        });
    }

    // Process wildcard transitions
    let wildcardTransition: TransitionResult["wildcardTransition"];
    if (wildcardContexts.length > 0) {
        const targetContexts: DFAExecutionContext[] = [];
        // Track which wildcard transition created each context (before epsilon closure)
        const contextSources: Array<{
            variable: string;
            typeName: string | undefined;
            checked: boolean;
            slotIndex: number | undefined;
            appendToSlot: boolean | undefined;
        }> = [];

        // Collect all preOps from wildcard source contexts
        const allPreOps: DFASlotOperation[] = [];

        // Determine the consumeOp (slot write for the wildcard)
        let consumeOp: DFASlotOperation | undefined;

        for (const { context, transition, preOps } of wildcardContexts) {
            // Determine if this wildcard is checked
            const isChecked =
                transition.checked === true ||
                !!(transition.typeName && transition.typeName !== "string");

            // Create new context after consuming wildcard
            const newContext: DFAExecutionContext = {
                nfaStateIds: new Set([transition.to]),
                priority: {
                    fixedStringPartCount: context.priority.fixedStringPartCount,
                    checkedWildcardCount: isChecked
                        ? context.priority.checkedWildcardCount + 1
                        : context.priority.checkedWildcardCount,
                    uncheckedWildcardCount: isChecked
                        ? context.priority.uncheckedWildcardCount
                        : context.priority.uncheckedWildcardCount + 1,
                },
                slotOps: [], // Reset for post-consume epsilon closure
            };

            // Propagate rule index
            if (context.ruleIndex !== undefined) {
                newContext.ruleIndex = context.ruleIndex;
            }

            // Propagate debug slot map
            if (context.debugSlotMap) {
                newContext.debugSlotMap = context.debugSlotMap;
            }

            targetContexts.push(newContext);

            // Track what variable this context should capture
            contextSources.push({
                variable: transition.variable || "",
                typeName: transition.typeName,
                checked: isChecked,
                slotIndex: transition.slotIndex,
                appendToSlot: transition.appendToSlot,
            });

            // Merge preOps
            for (const op of preOps) {
                if (!allPreOps.some(existing => slotOpsEqual(existing, op))) {
                    allPreOps.push(op);
                }
            }

            // Build consumeOp from the wildcard transition
            if (transition.slotIndex !== undefined && !consumeOp) {
                consumeOp = {
                    type: "writeSlot",
                    slotIndex: transition.slotIndex,
                    append: transition.appendToSlot,
                    debugVariable: transition.variable,
                };
            }
        }

        // Apply epsilon closure to get final target contexts
        const finalTargetContexts = epsilonClosure(nfa, targetContexts);

        // Collect postOps from epsilon closure results
        const allPostOps: DFASlotOperation[] = [];
        for (const ctx of finalTargetContexts) {
            if (ctx.slotOps) {
                for (const op of ctx.slotOps) {
                    if (!allPostOps.some(existing => slotOpsEqual(existing, op))) {
                        allPostOps.push(op);
                    }
                }
            }
        }

        // Build captureInfo for completions/debugging
        // Track by slotIndex now instead of matching captures map
        const captureInfoMap = new Map<string, {
            variable: string;
            typeName?: string;
            checked: boolean;
            slotIndex?: number;
            contextIndices: number[];
        }>();

        for (let finalIndex = 0; finalIndex < finalTargetContexts.length; finalIndex++) {
            // Match by index since we maintain order through epsilon closure
            const sourceIndex = finalIndex % contextSources.length;
            const source = contextSources[sourceIndex];
            if (!source.variable) continue;

            // Create unique key for variable+typeName combination
            const captureKey = `${source.variable}:${source.typeName || "string"}`;

            if (!captureInfoMap.has(captureKey)) {
                const info: {
                    variable: string;
                    typeName?: string;
                    checked: boolean;
                    slotIndex?: number;
                    contextIndices: number[];
                } = {
                    variable: source.variable,
                    checked: source.checked,
                    contextIndices: [],
                };
                if (source.typeName !== undefined) {
                    info.typeName = source.typeName;
                }
                if (source.slotIndex !== undefined) {
                    info.slotIndex = source.slotIndex;
                }
                captureInfoMap.set(captureKey, info);
            }
            const info = captureInfoMap.get(captureKey)!;
            // Only add this index if not already present
            if (!info.contextIndices.includes(finalIndex)) {
                info.contextIndices.push(finalIndex);
            }
        }

        const captureInfo = Array.from(captureInfoMap.values());

        // Build the wildcard transition object, only including consumeOp if defined
        const wildcardTransitionData: TransitionResult["wildcardTransition"] = {
            targetContexts: finalTargetContexts,
            captureInfo,
            preOps: allPreOps,
            postOps: allPostOps,
        };
        if (consumeOp !== undefined) {
            wildcardTransitionData!.consumeOp = consumeOp;
        }
        wildcardTransition = wildcardTransitionData;
    }

    const result: TransitionResult = {
        tokenTransitions,
    };
    if (wildcardTransition !== undefined) {
        result.wildcardTransition = wildcardTransition;
    }
    return result;
}

/**
 * Check if two slot operations are equal (for deduplication)
 */
function slotOpsEqual(a: DFASlotOperation, b: DFASlotOperation): boolean {
    if (a.type !== b.type) return false;
    if (a.slotCount !== b.slotCount) return false;
    if (a.parentSlotIndex !== b.parentSlotIndex) return false;
    if (a.slotIndex !== b.slotIndex) return false;
    if (a.append !== b.append) return false;
    // For valueExpr, do a simple reference equality (deep equality would be expensive)
    if (a.valueExpr !== b.valueExpr) return false;
    return true;
}

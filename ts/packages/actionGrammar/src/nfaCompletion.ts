// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { NFA } from "./nfa.js";
import {
    GrammarCompletionResult,
    GrammarCompletionProperty,
    spacingModeToSeparatorMode,
} from "./grammarCompletion.js";
import { CompiledSpacingMode } from "./grammarTypes.js";
import { tokenizeRequestWithOffsets } from "./nfaMatcher.js";
import registerDebug from "debug";

const debugCompletion = registerDebug("typeagent:nfa:completion");

/**
 * Check whether `token` is a non-empty prefix of any outgoing token transition
 * from the given state set (case-insensitive).  Used by `walkPrefixTokens` to
 * decide whether an unmatched final input token should be treated as a partial
 * keyword (the user still typing) versus a dead-end.
 */
function isPrefixOfAnyOutgoingToken(
    nfa: NFA,
    stateIds: number[],
    token: string,
): boolean {
    if (token.length === 0) return false;
    const lowerToken = token.toLowerCase();
    for (const id of stateIds) {
        const state = nfa.states[id];
        if (!state) continue;
        for (const trans of state.transitions) {
            if (trans.type !== "token" || !trans.tokens) continue;
            for (const gt of trans.tokens) {
                if (
                    gt.length > lowerToken.length &&
                    gt.toLowerCase().startsWith(lowerToken)
                ) {
                    return true;
                }
            }
        }
    }
    return false;
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
interface WalkResult {
    states: number[];
    /** Number of input tokens fully consumed by the walk. */
    consumed: number;
    tookWildcard: boolean;
    /**
     * The character position in the original input string where the walk's
     * last successful grammar transition ended.  When a step matched a
     * multi-input-token span (grammar token with internal whitespace), this
     * advances past all input tokens of the span.  0 when no tokens were
     * consumed.
     */
    endPos: number;
    /**
     * For each grammar STEP (one per walker iteration; a multi-input-token
     * match counts as ONE step), the state set the walk was in *before*
     * that step.  Used by backward direction to rewind to the position
     * preceding the last step.
     */
    prevStatesPerStep: number[][];
    /**
     * Per step, whether the transition taken was a wildcard match.  Length
     * == number of steps (not number of consumed input tokens).
     */
    stepIsWildcard: boolean[];
    /**
     * Per step, the input-string position where THAT step's match ends.
     * Used by backward rewind: rewinding off step K backs up to
     * `endPosPerStep[K - 1]` (or 0 when K==0).
     */
    endPosPerStep: number[];
    /**
     * Per step, the captured slot from a wildcard step (if any).  When a
     * wildcard transition with `propertyPath` annotation fires, its captured
     * text and target propertyPath are recorded here.  Token steps and
     * unannotated wildcard steps have `undefined`.  Used to populate
     * already-bound values in property-completion `match` objects (e.g.
     * `{ name: "hello" }` when completing `artist` after "play hello by").
     */
    capturedSlotsPerStep: (CapturedSlot | undefined)[];
}

/** A wildcard step's captured value, keyed by its rule-value property path. */
interface CapturedSlot {
    propertyPath: string;
    text: string;
}

function walkPrefixTokens(
    nfa: NFA,
    tokens: string[],
    starts?: number[],
    inputLength?: number,
): WalkResult {
    // Legacy callers (token-only entry point) don't have character offsets;
    // synthesize them assuming single-space separators.  matchedPrefixLength
    // is not meaningful in that mode, but endPos still needs to advance.
    if (starts === undefined) {
        let cursor = 0;
        const synth: number[] = [];
        for (const t of tokens) {
            synth.push(cursor);
            cursor += t.length + 1; // +1 for assumed space
        }
        starts = synth;
        inputLength = cursor > 0 ? cursor - 1 : 0;
    }
    if (inputLength === undefined) {
        inputLength = tokens.reduce((s, t) => s + t.length + 1, 0);
    }
    // Start with epsilon closure of start state
    let currentStates = simpleEpsilonClosure(nfa, [nfa.startState]);
    debugCompletion(
        `  walkPrefix: start epsilon closure: [${currentStates.join(", ")}] (${currentStates.length} states)`,
    );

    let consumed = 0;
    let tookWildcard = false;
    let endPos = 0;
    const prevStatesPerStep: number[][] = [];
    const stepIsWildcard: boolean[] = [];
    const endPosPerStep: number[] = [];
    const capturedSlotsPerStep: (CapturedSlot | undefined)[] = [];
    while (consumed < tokens.length) {
        const token = tokens[consumed];
        const tokenMatched: number[] = [];
        const wildcardMatched: number[] = [];
        const lowerToken = token.toLowerCase();
        // Capture the matched display token's length so the caller can
        // compute matchedPrefixLength precisely.  Default to the input
        // token's length when no display info is available.
        let matchedDisplayLength = token.length;
        // Most grammar transitions consume one input token.  A grammar
        // token with internal whitespace (escape-space authoring, e.g.
        // `hello world`) consumes a span of multiple consecutive input
        // tokens (`hello`, `world`).
        let matchedInputTokenCount = 1;

        for (const stateId of currentStates) {
            const state = nfa.states[stateId];
            if (!state) continue;

            for (const trans of state.transitions) {
                if (trans.type === "token" && trans.tokens) {
                    // Try single-token match first (the common case).
                    let matchIdx = trans.tokens.findIndex(
                        (t) => t.toLowerCase() === lowerToken,
                    );
                    let spanConsumed = 1;
                    // Then try multi-token match for grammar tokens
                    // containing internal whitespace (escape-space).
                    if (matchIdx === -1) {
                        for (let gi = 0; gi < trans.tokens.length; gi++) {
                            const gt = trans.tokens[gi];
                            if (!/\s/.test(gt)) continue;
                            const wordCount = gt
                                .split(/\s+/)
                                .filter(Boolean).length;
                            if (
                                wordCount < 2 ||
                                consumed + wordCount > tokens.length
                            ) {
                                continue;
                            }
                            const inputSpan = tokens
                                .slice(consumed, consumed + wordCount)
                                .map((t) => t.toLowerCase())
                                .join(" ");
                            if (inputSpan === gt.toLowerCase()) {
                                matchIdx = gi;
                                spanConsumed = wordCount;
                                break;
                            }
                        }
                    }
                    if (matchIdx !== -1) {
                        debugCompletion(
                            `  walkPrefix: state ${stateId} --[${trans.tokens.join("|")}]--> ${trans.to} (token matched, span=${spanConsumed})`,
                        );
                        tokenMatched.push(trans.to);
                        const displayTok =
                            trans.displayTokens?.[matchIdx] ??
                            trans.tokens[matchIdx];
                        matchedDisplayLength = displayTok.length;
                        matchedInputTokenCount = spanConsumed;
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
            // No transition matched this token.  Two recoverable cases let
            // us return completions from the last successful frontier
            // instead of a flat dead end:
            //  (a) The token is a partial prefix of some grammar token
            //      reachable from the frontier — the user is still typing
            //      this word (canonical's tryPartialStringMatch).
            //  (b) Prior tokens were already consumed AND this is the LAST
            //      input token — the user typed something not in the
            //      grammar; canonical's "Category 3b" still surfaces what
            //      would be valid here so the user can correct.
            // We only enter these for the LAST input token; intermediate
            // dead ends are genuine mismatches and return [].
            const isLastToken = consumed === tokens.length - 1;
            const isPrefix = isPrefixOfAnyOutgoingToken(
                nfa,
                currentStates,
                token,
            );
            const recoverable = isLastToken && (isPrefix || consumed > 0);
            if (recoverable) {
                debugCompletion(
                    `  walkPrefix: "${token}" recovered at depth ${consumed} (prefix=${isPrefix}, prior-consumed=${consumed > 0})`,
                );
                return {
                    states: currentStates,
                    consumed,
                    tookWildcard,
                    endPos,
                    prevStatesPerStep,
                    stepIsWildcard,
                    endPosPerStep,
                    capturedSlotsPerStep,
                };
            }
            debugCompletion(
                `  walkPrefix: no transitions matched "${token}" — dead end at depth ${consumed}`,
            );
            return {
                states: [],
                consumed,
                tookWildcard,
                endPos,
                prevStatesPerStep,
                stepIsWildcard,
                endPosPerStep,
                capturedSlotsPerStep,
            };
        }

        // Record whether this step was a wildcard match (used for
        // afterWildcard tri-state at the result level and backward direction).
        const isWildcardStep =
            tokenMatched.length === 0 && wildcardMatched.length > 0;
        if (isWildcardStep) {
            tookWildcard = true;
        }
        prevStatesPerStep.push(currentStates);
        stepIsWildcard.push(isWildcardStep);
        // When this step is a wildcard, look at the wildcard transitions that
        // could have fired and capture the first one carrying a propertyPath
        // annotation along with the input text it consumed.  Loop self-
        // transitions don't carry propertyPath (see nfaCompiler), so only the
        // initial entry transition contributes a capture — multi-token
        // wildcard captures truncate to the first token in this MVP.
        let stepCapture: CapturedSlot | undefined;
        if (isWildcardStep) {
            outer: for (const sid of currentStates) {
                const st = nfa.states[sid];
                if (!st) continue;
                for (const t of st.transitions) {
                    if (t.type === "wildcard" && t.propertyPath !== undefined) {
                        stepCapture = {
                            propertyPath: t.propertyPath,
                            text: token,
                        };
                        break outer;
                    }
                }
            }
        }
        capturedSlotsPerStep.push(stepCapture);
        // Compute the input position where this step ends.  For token
        // matches: span start + grammar display length (capped at input
        // length).  For wildcard matches: end of the (single) input token
        // consumed.
        const spanStart = starts[consumed];
        if (isWildcardStep) {
            endPos = spanStart + token.length;
        } else {
            endPos = Math.min(spanStart + matchedDisplayLength, inputLength);
        }
        endPosPerStep.push(endPos);

        debugCompletion(
            `  walkPrefix: "${token}" → ${tokenMatched.length > 0 ? "token" : "wildcard"} path (${nextStates.length} targets, span=${matchedInputTokenCount})`,
        );
        currentStates = simpleEpsilonClosure(nfa, nextStates);
        consumed += isWildcardStep ? 1 : matchedInputTokenCount;
        debugCompletion(
            `  walkPrefix: consumed=${consumed} endPos=${endPos} epsilon closure: [${currentStates.join(", ")}] (${currentStates.length} states)`,
        );
    }

    return {
        states: currentStates,
        consumed,
        tookWildcard,
        endPos,
        prevStatesPerStep,
        stepIsWildcard,
        endPosPerStep,
        capturedSlotsPerStep,
    };
}

/**
 * Property completion info collected from checked wildcard transitions.
 * Built from compile-time annotations on the transition itself.
 */
interface PropertyCompletion {
    /** Present only when the rule's value is an ActionExpression. */
    actionName?: string | undefined;
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
): {
    completions: string[];
    properties: PropertyCompletion[];
    /**
     * Per-token-transition spacing modes encountered.  Maps each output
     * completion string to the spacing mode of the rule that contributes
     * it.  When the same completion arises from multiple rules with
     * different spacing modes, the *strongest* (most-restrictive) mode
     * is recorded so per-group partitioning errs on the side of requiring
     * a separator.  Used by `finalizeCompletionResult` to emit per-group
     * `separatorMode`.
     */
    completionSpacingModes: Map<string, CompiledSpacingMode | undefined>;
    /**
     * True when the frontier has at least one wildcard transition —
     * regardless of whether that wildcard carries action/propertyPath
     * annotations.  Drives `closedSet=false` (the set isn't closed since
     * the user can keep filling the wildcard) and suppresses forward
     * auto-rewind (the wildcard IS a valid continuation, even without
     * a surfaced property).
     */
    hasFrontierWildcard: boolean;
} {
    const completions = new Set<string>();
    const properties: PropertyCompletion[] = [];
    const completionSpacingModes = new Map<
        string,
        CompiledSpacingMode | undefined
    >();
    let hasFrontierWildcard = false;

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
                // Any wildcard at the frontier signals an open continuation
                // (user can supply free-form input here).  This flag drives
                // closedSet=false and suppresses forward auto-rewind.
                hasFrontierWildcard = true;
                // Surface a property completion when the wildcard carries
                // action/propertyPath annotations.  The `isChecked` flag
                // controls *matching* (entity validation), not completion
                // eligibility — checked entity slots and free-form wildcards
                // alike surface as properties when the enclosing rule's
                // action references the variable.
                if (trans.propertyPath !== undefined) {
                    debugCompletion(
                        `  exploreCompletions: state ${stateId} → wildcard var=${trans.variable}, action=${trans.actionName ?? "<none>"}, path=${trans.propertyPath}`,
                    );
                    const entry: PropertyCompletion = {
                        propertyPath: trans.propertyPath,
                        variable: trans.variable ?? "",
                    };
                    if (trans.actionName) {
                        entry.actionName = trans.actionName;
                    }
                    if (trans.typeName) {
                        entry.typeName = trans.typeName;
                    }
                    properties.push(entry);
                } else {
                    debugCompletion(
                        `  exploreCompletions: state ${stateId} → wildcard without action/propertyPath (open frontier, no property surfaced)`,
                    );
                }
                continue;
            }

            if (trans.type === "token" && trans.tokens) {
                // Token transition — return display tokens (original grammar
                // form, e.g. "hello,") when available, else normalized tokens
                // (lowercased + punctuation-stripped) as fallback.  Shell
                // filters locally by user-typed partial.
                const displayList = trans.displayTokens ?? trans.tokens;
                for (const tok of displayList) {
                    debugCompletion(
                        `  exploreCompletions: state ${stateId} → token "${tok}"`,
                    );
                    completions.add(tok);
                    // Record spacing mode per completion.  When the same
                    // completion arises with different modes, keep the
                    // most restrictive (required > optional > auto/none).
                    const existing = completionSpacingModes.get(tok);
                    const incoming = trans.spacingMode;
                    completionSpacingModes.set(
                        tok,
                        mergeSpacingModes(existing, incoming),
                    );
                }
            }
        }
    }

    return {
        completions: Array.from(completions),
        properties,
        completionSpacingModes,
        hasFrontierWildcard,
    };
}

/**
 * Merge two spacing modes, preferring the most restrictive (= demanding
 * more separator).  Used when the same completion string arises from
 * multiple rules with different spacing modes — we err toward requiring
 * a separator so a stricter rule isn't accidentally relaxed.
 */
function mergeSpacingModes(
    a: CompiledSpacingMode | undefined,
    b: CompiledSpacingMode | undefined,
): CompiledSpacingMode | undefined {
    if (a === undefined) return b;
    if (b === undefined) return a;
    // Order of restrictiveness: required > optional > auto (undefined) > none
    const rank = (m: CompiledSpacingMode | undefined): number =>
        m === "required" ? 3 : m === "optional" ? 2 : m === "none" ? 0 : 1;
    return rank(a) >= rank(b) ? a : b;
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
        reachableStates = walkPrefixTokens(nfa, tokens).states;
    }

    debugCompletion(
        `  reachable states: [${reachableStates.join(", ")}] (${reachableStates.length} states)`,
    );

    if (reachableStates.length === 0) {
        debugCompletion(`  → no reachable states, returning empty`);
        return {
            groups: [],
            directionSensitive: false,
            afterWildcard: "none",
        };
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
        groups: [
            {
                completions: uniqueCompletions,
                // NFA does not track per-rule spacing modes, so use
                // auto mode — the consumer resolves per-item based on
                // the character pair (last input char, first completion char).
                separatorMode: "autoSpacePunctuation",
            },
        ],
        directionSensitive: false,
        // TODO: The NFA path does not yet track wildcard-at-EOI states.
        // If NFA grammars gain wildcard support, this should be computed
        // dynamically like the DFA path in grammarCompletion.ts.
        afterWildcard: "none",
    };
    const grammarProperties = buildGrammarProperties(nfa, properties, []);
    if (grammarProperties.length > 0) {
        result.properties = grammarProperties;
    }
    return result;
}

/**
 * Compute completions for a raw input string and record how far through the
 * input the grammar consumed (`matchedPrefixLength`).  This is the entry
 * point that supports the canonical's positional-completion contract: the
 * shell uses `matchedPrefixLength` to decide where to insert completions.
 *
 * Internally tokenizes with offset tracking, walks the NFA, then converts
 * the last-consumed-token's end offset to a character index in the original
 * input.  If zero tokens were consumed, `matchedPrefixLength` is 0.
 *
 * Layer 1 (forward) + Layer 4 (backward) of the completion port.
 *
 * **Forward** returns completions reachable from the position the walk
 * stopped at.  **Backward** rewinds to the state just *before* the last
 * fully-consumed input token, so the completions surface that token (or
 * the wildcard that absorbed it) as a re-offer.  The user can then edit
 * the last word in place.
 *
 * Matches the canonical's direction semantics described in
 * grammarCompletion.ts (the directionSensitive field + tryCollectBackwardCandidate).
 */
export function computeNFACompletionsFromInput(
    nfa: NFA,
    input: string,
    direction?: "forward" | "backward",
): GrammarCompletionResult {
    const { tokens, starts } = tokenizeRequestWithOffsets(input);

    debugCompletion(
        `\n=== NFA Completion (positional, ${direction ?? "forward"}) input="${input}" tokens=[${tokens
            .map((t) => `"${t}"`)
            .join(", ")}] ===`,
    );

    // Empty input → start state, matchedPrefixLength = 0.
    if (tokens.length === 0) {
        const reachable = simpleEpsilonClosure(nfa, [nfa.startState]);
        return finalizeCompletionResult(nfa, reachable, 0, false);
    }

    const walk = walkPrefixTokens(nfa, tokens, starts, input.length);
    const {
        states,
        consumed,
        tookWildcard,
        endPos,
        prevStatesPerStep,
        stepIsWildcard,
        endPosPerStep,
        capturedSlotsPerStep,
    } = walk;
    // `consumed` here is INPUT-TOKEN count.  `stepCount` is GRAMMAR-STEP
    // count (these differ for multi-input-token spans).
    const stepCount = prevStatesPerStep.length;

    // matchedPrefixLength (forward): position past the last fully-consumed
    // grammar step.  `endPos` is tracked by the walker (handles
    // single-token, escape-space multi-token, and wildcard cases uniformly).
    const forwardMatchedPrefixLength = consumed > 0 ? endPos : 0;

    // Trailing-separator detection: canonical's notion is "the input has
    // a separator (whitespace OR sentence punctuation) past where the
    // grammar's match ended".  Mirror that by checking whether the input
    // extends past `forwardMatchedPrefixLength` and the trailing char is
    // a separator.  This correctly handles "play music " (trailing
    // space), "play music," (trailing comma), and "set:" (colon was
    // consumed AS PART of the grammar's `set:` keyword — no trailing).
    const trailingChar =
        forwardMatchedPrefixLength < input.length
            ? input.charAt(forwardMatchedPrefixLength)
            : "";
    const hasTrailingSeparator =
        consumed > 0 &&
        trailingChar.length > 0 &&
        /[\s\p{P}]/u.test(trailingChar);

    const canRewind =
        consumed > 0 && !hasTrailingSeparator && prevStatesPerStep.length > 0;

    // Helper: build the rewound result.  matchedPrefixLength backs up to
    // the END of the previous token (or 0 if rewinding off the first
    // token), so the user can "delete the separator + retype the last
    // word" with the position pinned just past the prior word.
    const buildRewound = (): GrammarCompletionResult => {
        // Rewind by one GRAMMAR STEP (which may have spanned multiple
        // input tokens for escape-space matches).
        const lastStepIdx = stepCount - 1;
        const rewoundStates = prevStatesPerStep[lastStepIdx];
        const rewoundPrefixLength =
            lastStepIdx > 0 ? endPosPerStep[lastStepIdx - 1] : 0;
        const rewoundTookWildcard = stepIsWildcard
            .slice(0, lastStepIdx)
            .some(Boolean);
        const rewoundCaptures = collectCaptures(
            capturedSlotsPerStep.slice(0, lastStepIdx),
        );
        debugCompletion(
            `  rewind: step ${lastStepIdx} states=[${rewoundStates.join(", ")}] mpl=${rewoundPrefixLength} (was wildcard step? ${stepIsWildcard[lastStepIdx]})`,
        );
        return finalizeCompletionResult(
            nfa,
            rewoundStates,
            rewoundPrefixLength,
            rewoundTookWildcard,
            rewoundCaptures,
        );
    };

    // Backward direction: always rewind when possible.
    if (direction === "backward" && canRewind) {
        return buildRewound();
    }

    // Forward direction: if the walk fully consumed all input but the
    // frontier offers nothing more (grammar is exactly matched), the
    // canonical also backs up — "exact match backs up to last term".
    // We test this by exploring the forward frontier and seeing if any
    // completions/properties result; if not, rewind.
    if (direction !== "backward" && canRewind) {
        const exhaustedAllInput = consumed === tokens.length;
        if (exhaustedAllInput) {
            const probe = exploreCompletions(nfa, states);
            const probeProps = buildGrammarProperties(
                nfa,
                probe.properties,
                [],
            );
            const noContinuation =
                probe.completions.length === 0 && probeProps.length === 0;
            if (noContinuation) {
                return buildRewound();
            }
        }
    }

    return finalizeCompletionResult(
        nfa,
        states,
        forwardMatchedPrefixLength,
        tookWildcard,
        collectCaptures(capturedSlotsPerStep),
    );
}

/** Collect all defined captures from a step-indexed array. */
function collectCaptures(
    perStep: (CapturedSlot | undefined)[],
): CapturedSlot[] {
    const result: CapturedSlot[] = [];
    for (const c of perStep) {
        if (c) result.push(c);
    }
    return result;
}

/**
 * Shared finalization step.  Builds the GrammarCompletionResult from a
 * reachable-state set and a recorded matchedPrefixLength.
 */
function finalizeCompletionResult(
    nfa: NFA,
    reachableStates: number[],
    matchedPrefixLength: number,
    tookWildcard: boolean,
    capturedSlots: CapturedSlot[] = [],
): GrammarCompletionResult {
    // directionSensitive: per canonical (grammarCompletion.ts:1690),
    // `matchedPrefixLength > 0` is the signal — any prefix consumption
    // means backward would back up to a preceding part, producing
    // different results than forward.
    const directionSensitive = matchedPrefixLength > 0;

    // afterWildcard: "all" when the walk reached the frontier through a
    // wildcard transition; "none" otherwise.  The "some" tri-state arises
    // only when results from multiple rules are merged; this single-pass
    // NFA walk produces only "none"/"all".
    const afterWildcard: "none" | "some" | "all" = tookWildcard
        ? "all"
        : "none";

    if (reachableStates.length === 0) {
        // Dead-end walks have no completions and no properties — the
        // continuation set is empty, which is trivially closed.
        return {
            groups: [],
            matchedPrefixLength,
            closedSet: true,
            directionSensitive,
            afterWildcard,
        };
    }

    const { completions, properties, completionSpacingModes } =
        exploreCompletions(nfa, reachableStates);
    const uniqueCompletions = deduplicateCompletions(completions);

    const grammarProperties = buildGrammarProperties(
        nfa,
        properties,
        capturedSlots,
    );
    // closedSet: the listed completions are exhaustive iff no property
    // completion arises at the frontier.  A frontier wildcard without
    // action annotations doesn't surface a property, and the canonical's
    // test corpus treats that case as `closedSet=true` — the wildcard's
    // "openness" only matters when it's user-fillable via a property.
    const closedSet = grammarProperties.length === 0;

    // Partition completions into per-spacing-mode groups so the result
    // mirrors canonical's per-group `separatorMode`.  Completions that
    // never had a spacing mode recorded (e.g. arose from a path the
    // walker took before the per-transition tagging caught up) fall into
    // the auto group.
    const byMode = new Map<string, string[]>();
    for (const comp of uniqueCompletions) {
        const mode = completionSpacingModes.get(comp);
        const sepMode = spacingModeToSeparatorMode(mode);
        const bucket = byMode.get(sepMode) ?? [];
        bucket.push(comp);
        byMode.set(sepMode, bucket);
    }
    const groups: { completions: string[]; separatorMode: any }[] = [];
    for (const [sepMode, comps] of byMode) {
        groups.push({ completions: comps, separatorMode: sepMode });
    }

    const result: GrammarCompletionResult = {
        groups,
        matchedPrefixLength,
        closedSet,
        directionSensitive,
        afterWildcard,
    };
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
    capturedSlots: CapturedSlot[],
): GrammarCompletionProperty[] {
    if (properties.length === 0) return [];

    // Deduplicate by actionName + propertyPath
    const seen = new Set<string>();
    const result: GrammarCompletionProperty[] = [];

    for (const prop of properties) {
        const key = `${prop.actionName ?? ""}:${prop.propertyPath}`;
        if (seen.has(key)) continue;
        seen.add(key);

        // Build the match object.  For action grammars the canonical shape
        // is `{ actionName, parameters: {} }`; for plain object values
        // (e.g. `<R> = ... -> { name, artist }`) it's an empty object.
        // Then overlay any captured slot values from earlier in the walk
        // (e.g. after "play hello by", $(name) was captured → match has
        // `name: "hello"` while $(artist) is the completion target).  The
        // slot currently being completed is excluded from the overlay.
        const match: Record<string, any> = prop.actionName
            ? { actionName: prop.actionName, parameters: {} }
            : {};
        for (const capture of capturedSlots) {
            if (capture.propertyPath === prop.propertyPath) continue;
            setPathValue(match, capture.propertyPath, capture.text);
        }

        result.push({
            match,
            propertyNames: [prop.propertyPath],
            separatorMode: "autoSpacePunctuation",
        });
    }

    return result;
}

/**
 * Assign `value` at a dotted path inside `obj`, creating intermediate plain
 * objects as needed.  Existing values at intermediate keys are preserved
 * only when they're plain objects; conflicting non-object values are
 * overwritten (this is a best-effort completion preview, not authoritative).
 */
function setPathValue(
    obj: Record<string, any>,
    path: string,
    value: any,
): void {
    const parts = path.split(".");
    let cursor: Record<string, any> = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        const k = parts[i];
        const existing = cursor[k];
        if (
            existing === undefined ||
            existing === null ||
            typeof existing !== "object"
        ) {
            cursor[k] = {};
        }
        cursor = cursor[k];
    }
    cursor[parts[parts.length - 1]] = value;
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

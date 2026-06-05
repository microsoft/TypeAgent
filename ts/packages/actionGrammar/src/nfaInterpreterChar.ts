// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import { NFA, NFATransition } from "./nfa.js";
import {
    Environment,
    SlotValue,
    createEnvironment,
    setSlotValue,
    evaluateExpression,
    cloneEnvironment,
    deepCloneEnvironment,
} from "./environment.js";
import { globalEntityRegistry } from "./entityRegistry.js";
import {
    isBoundarySatisfied,
    needsSeparatorInAutoMode,
} from "./grammarMatcher.js";
import { CompiledSpacingMode } from "./grammarTypes.js";
import { NFAMatchResult, sortNFAMatches } from "./nfaInterpreter.js";
import { parseNumberToken } from "./nfaMatcher.js";

const debugChar = registerDebug("typeagent:nfa:char");

/**
 * NFA char-based matcher (Phase 1 of nfa-char-based-rewrite plan).
 *
 * Operates on character positions in the request string instead of a
 * pre-tokenized array.  This eliminates a class of bugs where the
 * tokenizer's `\S+` split + trailing-punct strip collapses information the
 * grammar needs (separator characters, trailing punct on alternates,
 * character-class boundaries).
 *
 * Initial coverage (this commit):
 *   - token transitions (literal display-text match against raw chars)
 *   - wildcard transitions (deferred capture, finalized at next fixed text)
 *   - entity-validator wildcards (single-position validate)
 *   - epsilon closure (env/actionValue/ruleIndex threading)
 *   - accept-state trailing-content check
 *
 * Not yet:
 *   - phraseSet transitions
 *   - multi-token entity validators (CalendarTime etc.)
 *   - number-typed wildcards with leading-sep tolerance
 *   - prefix-split / on-demand morpheme splitting
 */

const SEPARATOR_CLASS_STR = "\\s\\p{P}";
const TRAILING_SEP_RE = /[\s\p{P}]+$/u;
const LEADING_SEP_RE = /^[\s\p{P}]+/u;
const TRAILING_WS_RE = /\s+$/u;
const LEADING_WS_RE = /^\s+/u;

// Canonical-equivalent number sticky regex — leading [\s\p{P}]*? (lazy)
// followed by extended-format number literal.  Use the `none`-mode variant
// (no leading sep) when the rule's spacing mode is `none`.
const STICKY_NUMBER_RE =
    /[\s\p{P}]*?(0o[0-7]+|0x[0-9a-f]+|0b[01]+|([+-]?[0-9]+)(\.[0-9]+)?(e[+-]?[1-9][0-9]*)?)/iuy;
const STICKY_NUMBER_NOSEP_RE =
    /(0o[0-7]+|0x[0-9a-f]+|0b[01]+|([+-]?[0-9]+)(\.[0-9]+)?(e[+-]?[1-9][0-9]*)?)/iuy;

/**
 * Trim a captured wildcard span per the wildcard's type and spacing mode.
 *
 * - `none` spacing: no trim — separator chars belong to the capture value.
 * - number-typed: trim leading/trailing whitespace ONLY.  We must not trim
 *   `\p{P}` because `-` and `+` are punctuation and form a valid number's
 *   sign character.
 * - otherwise: full canonical trim (whitespace + punctuation on both ends).
 */
function trimWildcardCapture(
    captured: string,
    typeName: string | undefined,
    spacingMode: CompiledSpacingMode | undefined,
): string {
    if (spacingMode === "none") return captured;
    if (typeName === "number") {
        return captured.replace(LEADING_WS_RE, "").replace(TRAILING_WS_RE, "");
    }
    return captured.replace(LEADING_SEP_RE, "").replace(TRAILING_SEP_RE, "");
}

// Per-display-token regex cache (keyed by `${displayText}${spacingMode}`).
// The pattern is `^[leadingSep]<escapedDisplayText>` with case-insensitive Unicode.
const literalMatchRegexCache = new Map<
    string,
    { sticky: RegExp; leadingIsRequired: boolean; leadingIsAuto: boolean }
>();

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildLiteralStickyRegex(
    displayText: string,
    spacingMode: CompiledSpacingMode | undefined,
    isLeading: boolean,
    leadingMode: CompiledSpacingMode | undefined,
): { sticky: RegExp; leadingIsRequired: boolean; leadingIsAuto: boolean } {
    const cacheKey = `${displayText}|${spacingMode ?? "auto"}|${isLeading ? "L" : "I"}|${leadingMode ?? "auto"}`;
    const cached = literalMatchRegexCache.get(cacheKey);
    if (cached) return cached;

    let leadingSep: string;
    let leadingIsRequired = false;
    let leadingIsAuto = false;

    if (isLeading) {
        // Rule-leading position: separator at a rule's first part follows
        // canonical's `buildStringPartRegExpStr` — `[\s\p{P}]*?` for every
        // mode EXCEPT `none`, which forbids any leading separator.  The
        // mode here is `leadingMode` (canonical's `leadingSpacingMode`):
        // parent's mode for the first part of a nested rule, otherwise
        // the rule's own mode.
        leadingSep =
            leadingMode === "none" ? "" : `[${SEPARATOR_CLASS_STR}]*?`;
    } else {
    switch (spacingMode) {
        case "none":
            leadingSep = "";
            break;
        case "required":
            leadingSep = `[${SEPARATOR_CLASS_STR}]+`;
            leadingIsRequired = true;
            break;
        case "optional":
            leadingSep = `[${SEPARATOR_CLASS_STR}]*`;
            break;
        case undefined:
            // auto — caller must adjust at call time based on prev char.
            // We default to the optional pattern; auto-mode required-sep is
            // enforced separately when prev-char check rejects.
            leadingSep = `[${SEPARATOR_CLASS_STR}]*`;
            leadingIsAuto = true;
            break;
        default:
            leadingSep = `[${SEPARATOR_CLASS_STR}]*`;
            break;
    }
    }

    const pattern = `${leadingSep}${escapeRegex(displayText)}`;
    const entry = {
        sticky: new RegExp(pattern, "iuy"),
        leadingIsRequired,
        leadingIsAuto,
    };
    literalMatchRegexCache.set(cacheKey, entry);
    return entry;
}

function buildLiteralGlobalRegex(
    displayText: string,
    spacingMode: CompiledSpacingMode | undefined,
): RegExp {
    let leadingSep: string;
    switch (spacingMode) {
        case "none":
            leadingSep = "";
            break;
        case "required":
            leadingSep = `[${SEPARATOR_CLASS_STR}]+`;
            break;
        case "optional":
        case undefined:
        default:
            leadingSep = `[${SEPARATOR_CLASS_STR}]*?`;
            break;
    }
    return new RegExp(`${leadingSep}${escapeRegex(displayText)}`, "iug");
}

interface PendingWildcardChar {
    start: number;
    transition: NFATransition;
}

interface SpacingStackFrame {
    cur: CompiledSpacingMode | undefined;
    parent: CompiledSpacingMode | undefined;
    atFirst: boolean;
}

export interface NFACharThreadState {
    stateId: number;
    charPos: number;
    path: number[];
    fixedStringPartCount: number;
    checkedWildcardCount: number;
    uncheckedWildcardCount: number;
    ruleIndex?: number | undefined;
    actionValue?: any | undefined;
    environment?: Environment | undefined;
    slotMap?: Map<string, number> | undefined;
    pendingWildcard?: PendingWildcardChar | undefined;
    // Most recent active spacing mode (carried from the last token/wildcard
    // transition's `spacingMode`).  Used at accept time to reject trailing
    // content under `none` mode and to trim wildcard captures.
    currentSpacingMode?: CompiledSpacingMode | undefined;
    // Parent rule's effective leading mode at the time we entered the
    // current rule (canonical's `leadingSpacingMode` snapshot).  Consulted
    // at the rule's first-part position; ignored elsewhere.
    parentSpacingMode?: CompiledSpacingMode | undefined;
    // True between rule entry (enterRule epsilon) and the first non-epsilon
    // transition fired since.  Mirrors canonical's `partIndex === 0` check.
    atFirstPart?: boolean | undefined;
    // Stack of saved (cur, parent, atFirst) frames — pushed on enterRule,
    // popped on exitRule / writeToParent / popEnvironment.
    spacingStack?: SpacingStackFrame[] | undefined;
}

function makeInitialThread(nfa: NFA): NFACharThreadState {
    return {
        stateId: nfa.startState,
        charPos: 0,
        path: [nfa.startState],
        fixedStringPartCount: 0,
        checkedWildcardCount: 0,
        uncheckedWildcardCount: 0,
    };
}

/**
 * Char-based epsilon closure.
 *
 * Mirrors the token-based epsilonClosure (nfaInterpreter.ts) but operates
 * on NFACharThreadState.  Manages environment creation on rule entry,
 * writeToParent / popEnvironment epsilon transitions, and rule-level
 * actionValue threading.
 */
function epsilonClosureChar(
    nfa: NFA,
    states: NFACharThreadState[],
): NFACharThreadState[] {
    const result: NFACharThreadState[] = [];
    const visited = new Set<string>();
    const queue = [...states];

    while (queue.length > 0) {
        const state = queue.shift()!;
        const nfaState = nfa.states[state.stateId];
        if (!nfaState) continue;

        const currentRuleIndex =
            nfaState.ruleIndex !== undefined
                ? nfaState.ruleIndex
                : state.ruleIndex;

        let currentEnvironment = state.environment;
        let currentSlotMap = state.slotMap;

        if (nfaState.slotMap && nfaState.slotCount !== undefined) {
            currentEnvironment = createEnvironment(
                nfaState.slotCount,
                state.environment,
                nfaState.parentSlotIndex,
                nfaState.slotMap,
                nfaState.actionValue,
            );
            currentSlotMap = nfaState.slotMap;
        }

        let currentActionValue = state.actionValue;
        if (nfaState.actionValue !== undefined && nfaState.slotMap) {
            currentActionValue = nfaState.actionValue;
        } else if (nfaState.actionValue !== undefined && !state.environment) {
            currentActionValue = nfaState.actionValue;
        }

        // Dedup: a thread reaching the same NFA state at the same char
        // position with same priority counts and pending-wildcard shape is
        // a duplicate.  Slot-value dedup is omitted here for simplicity —
        // can revisit if thread explosion is observed.
        const pwKey = state.pendingWildcard
            ? `pw${state.pendingWildcard.start}`
            : "";
        const key = `${state.stateId}-${state.charPos}-${state.fixedStringPartCount}-${state.checkedWildcardCount}-${state.uncheckedWildcardCount}-${pwKey}`;
        if (visited.has(key)) continue;
        visited.add(key);

        const frozenEnvironment = currentEnvironment
            ? deepCloneEnvironment(currentEnvironment)
            : undefined;

        const updated: NFACharThreadState = {
            ...state,
            ruleIndex: currentRuleIndex,
            actionValue: currentActionValue,
            environment: frozenEnvironment,
            slotMap: currentSlotMap,
        };
        result.push(updated);

        for (const trans of nfaState.transitions) {
            if (trans.type !== "epsilon") continue;

            let newEnvironment = currentEnvironment;
            let newSlotMap = currentSlotMap;
            let newActionValue = currentActionValue;
            let newCurrentSpacingMode = state.currentSpacingMode;
            let newParentSpacingMode = state.parentSpacingMode;
            let newAtFirstPart = state.atFirstPart;
            let newSpacingStack = state.spacingStack;

            const isExit =
                trans.exitRule ||
                (trans.writeToParent &&
                    trans.valueToWrite &&
                    currentEnvironment &&
                    currentEnvironment.parent &&
                    currentEnvironment.parentSlotIndex !== undefined) ||
                (trans.popEnvironment &&
                    currentEnvironment &&
                    currentEnvironment.parent);

            if (
                trans.writeToParent &&
                trans.valueToWrite &&
                currentEnvironment &&
                currentEnvironment.parent &&
                currentEnvironment.parentSlotIndex !== undefined
            ) {
                try {
                    const evaluatedValue = evaluateExpression(
                        trans.valueToWrite,
                        currentEnvironment,
                    );
                    const clonedParent = deepCloneEnvironment(
                        currentEnvironment.parent,
                    );
                    setSlotValue(
                        clonedParent,
                        currentEnvironment.parentSlotIndex,
                        evaluatedValue,
                    );
                    newEnvironment = clonedParent;
                } catch {
                    newEnvironment = currentEnvironment.parent;
                }
                if (newEnvironment?.slotMap) {
                    newSlotMap = newEnvironment.slotMap;
                }
                if (newEnvironment?.actionValue !== undefined) {
                    newActionValue = newEnvironment.actionValue;
                }
            } else if (
                trans.popEnvironment &&
                currentEnvironment &&
                currentEnvironment.parent
            ) {
                newEnvironment = currentEnvironment.parent;
                if (newEnvironment?.slotMap) {
                    newSlotMap = newEnvironment.slotMap;
                }
                if (newEnvironment?.actionValue !== undefined) {
                    newActionValue = newEnvironment.actionValue;
                }
            }

            if (isExit) {
                // Pop the spacing-mode stack to restore the parent rule's
                // modes.  Canonical's ParentMatchState saves
                // `partIndex: state.partIndex + 1` — after restoration,
                // the parent has moved PAST the nested-ref position, so
                // it's no longer at first part regardless of what the
                // frame recorded.
                if (newSpacingStack && newSpacingStack.length > 0) {
                    const top = newSpacingStack[newSpacingStack.length - 1];
                    newCurrentSpacingMode = top.cur;
                    newParentSpacingMode = top.parent;
                    newAtFirstPart = false;
                    newSpacingStack = newSpacingStack.slice(0, -1);
                } else {
                    newCurrentSpacingMode = undefined;
                    newParentSpacingMode = undefined;
                    newAtFirstPart = false;
                }
            } else if (trans.enterRuleSet) {
                // Push current frame; set the new rule's modes.  The
                // child's leadingSpacingMode (canonical) is the parent's
                // effective leading mode at the time of entry: parent's
                // own saved leading IF the parent is itself a nested
                // rule sitting at its first part, otherwise the parent's
                // own current mode.
                const parentIsNested =
                    (state.spacingStack?.length ?? 0) >= 2;
                const effectiveLeading =
                    state.atFirstPart && parentIsNested
                        ? state.parentSpacingMode
                        : state.currentSpacingMode;
                const frame: SpacingStackFrame = {
                    cur: state.currentSpacingMode,
                    parent: state.parentSpacingMode,
                    atFirst: state.atFirstPart ?? false,
                };
                newSpacingStack = newSpacingStack
                    ? [...newSpacingStack, frame]
                    : [frame];
                newCurrentSpacingMode = trans.enterRule;
                newParentSpacingMode = effectiveLeading;
                newAtFirstPart = true;
            }

            queue.push({
                stateId: trans.to,
                charPos: state.charPos,
                path: [...updated.path, trans.to],
                fixedStringPartCount: updated.fixedStringPartCount,
                checkedWildcardCount: updated.checkedWildcardCount,
                uncheckedWildcardCount: updated.uncheckedWildcardCount,
                ruleIndex: currentRuleIndex,
                actionValue: newActionValue,
                environment: newEnvironment,
                slotMap: newSlotMap,
                pendingWildcard: state.pendingWildcard,
                currentSpacingMode: newCurrentSpacingMode,
                parentSpacingMode: newParentSpacingMode,
                atFirstPart: newAtFirstPart,
                spacingStack: newSpacingStack,
            });
        }
    }

    return result;
}

/**
 * Sticky number match at state.charPos for a number-typed wildcard.
 * Mirrors canonical `matchVarNumberPartWithoutWildcard`.
 */
function tryStickyNumber(
    request: string,
    state: NFACharThreadState,
    trans: NFATransition,
): NFACharThreadState | undefined {
    // Use the runtime spacing-stack mode rather than the compiler-inherited
    // transition mode (see comment in tryLiteralMatch).
    const spacingMode = state.currentSpacingMode;
    const re = spacingMode === "none" ? STICKY_NUMBER_NOSEP_RE : STICKY_NUMBER_RE;
    re.lastIndex = state.charPos;
    const m = re.exec(request);
    if (m === null) return undefined;
    const newCharPos = state.charPos + m[0].length;
    if (!isBoundarySatisfied(request, newCharPos, spacingMode)) return undefined;
    const n = Number(m[1]);
    if (Number.isNaN(n)) return undefined;

    let newEnv = state.environment;
    if (trans.slotIndex !== undefined && state.environment) {
        newEnv = cloneEnvironment(state.environment);
        setSlotValue(
            newEnv,
            trans.slotIndex,
            n as SlotValue,
            trans.appendToSlot ?? false,
        );
    }

    return {
        stateId: trans.to,
        charPos: newCharPos,
        path: [...state.path, trans.to],
        fixedStringPartCount: state.fixedStringPartCount,
        checkedWildcardCount: state.checkedWildcardCount + 1,
        uncheckedWildcardCount: state.uncheckedWildcardCount,
        ruleIndex: state.ruleIndex,
        actionValue: state.actionValue,
        environment: newEnv,
        slotMap: state.slotMap,
        pendingWildcard: undefined,
        currentSpacingMode: state.currentSpacingMode,
        parentSpacingMode: state.parentSpacingMode,
        atFirstPart: false,
        spacingStack: state.spacingStack,
    };
}

// Global-mode number scan (canonical's matchVarNumberPartWithWildcard).
// Lazy leading-sep so the wildcard's tail can include or omit separator
// chars depending on what was captured.
const GLOBAL_NUMBER_RE =
    /[\s\p{P}]*?(0o[0-7]+|0x[0-9a-f]+|0b[01]+|([+-]?[0-9]+)(\.[0-9]+)?(e[+-]?[1-9][0-9]*)?)/giu;
const GLOBAL_NUMBER_NOSEP_RE =
    /(0o[0-7]+|0x[0-9a-f]+|0b[01]+|([+-]?[0-9]+)(\.[0-9]+)?(e[+-]?[1-9][0-9]*)?)/giu;

/**
 * Scan forward for a number while a wildcard is pending.  The captured
 * wildcard span is `request[pending.start..numberMatch.index]`; the number
 * itself becomes the value for the number wildcard's slot.
 */
function tryNumberWithPendingWildcard(
    request: string,
    state: NFACharThreadState,
    trans: NFATransition,
): NFACharThreadState | undefined {
    const pending = state.pendingWildcard!;
    const spacingMode = state.currentSpacingMode;
    const re =
        spacingMode === "none" ? GLOBAL_NUMBER_NOSEP_RE : GLOBAL_NUMBER_RE;
    re.lastIndex = state.charPos;
    let m: RegExpExecArray | null;
    while ((m = re.exec(request)) !== null) {
        const wildcardEnd = m.index;
        const newCharPos = m.index + m[0].length;
        if (!isBoundarySatisfied(request, newCharPos, spacingMode)) continue;
        const n = Number(m[1]);
        if (Number.isNaN(n)) continue;

        // Validate the wildcard capture span (non-empty after trim).
        const captured = request.substring(pending.start, wildcardEnd);
        const trimmed = trimWildcardCapture(
            captured,
            pending.transition.typeName,
            spacingMode,
        );
        if (trimmed.length === 0) continue;

        // Finalize the pending wildcard.
        const fin = finalizeWildcardCapture(state, pending.transition, trimmed);
        if (!fin.ok) continue;

        // Write the number into its slot.
        let env = fin.environment;
        if (trans.slotIndex !== undefined && env) {
            env = cloneEnvironment(env);
            setSlotValue(
                env,
                trans.slotIndex,
                n as SlotValue,
                trans.appendToSlot ?? false,
            );
        }

        // Tally the wildcard counts: prior pending wildcard (+1 of its kind)
        // and number wildcard (+1 checked).
        const pwt = pending.transition;
        const priorChecked =
            pwt.checked === true ||
            (pwt.typeName !== undefined &&
                pwt.typeName !== "string" &&
                pwt.typeName !== "wildcard");

        return {
            stateId: trans.to,
            charPos: newCharPos,
            path: [...state.path, trans.to],
            fixedStringPartCount: state.fixedStringPartCount,
            checkedWildcardCount:
                state.checkedWildcardCount + (priorChecked ? 1 : 0) + 1,
            uncheckedWildcardCount:
                state.uncheckedWildcardCount + (priorChecked ? 0 : 1),
            ruleIndex: state.ruleIndex,
            actionValue: state.actionValue,
            environment: env,
            slotMap: state.slotMap,
            pendingWildcard: undefined,
            currentSpacingMode: state.currentSpacingMode,
            parentSpacingMode: state.parentSpacingMode,
            atFirstPart: false,
            spacingStack: state.spacingStack,
        };
    }
    return undefined;
}

/**
 * Try to match a transition's literal token against the request at
 * `state.charPos`.  Returns the new thread (advanced past the match) or
 * undefined.  If the thread has a pending wildcard, scans forward in the
 * request to find ANY position where the literal matches, capturing the
 * span [pendingWildcard.start, matchStart] as the wildcard value.
 */
function tryLiteralMatch(
    request: string,
    state: NFACharThreadState,
    trans: NFATransition,
    candidate: string,
    longerWildcardSpawn: NFACharThreadState[],
): NFACharThreadState | undefined {
    // Use the runtime spacing-stack mode rather than the compiler-inherited
    // transition spacingMode.  The stack reflects the rule's TRUE mode at
    // runtime (compiler inheritance fuses parent's mode into child's
    // transitions, which breaks Cluster B parent-child nesting cases).
    const spacingMode = state.currentSpacingMode;
    const pending = state.pendingWildcard;

    if (pending !== undefined) {
        // Wildcard-capture path: scan forward for the literal.
        const re = buildLiteralGlobalRegex(candidate, spacingMode);
        re.lastIndex = state.charPos;
        while (true) {
            const m = re.exec(request);
            if (m === null) return undefined;
            const wildcardEnd = m.index;
            const newCharPos = m.index + m[0].length;
            if (!isBoundarySatisfied(request, newCharPos, spacingMode)) {
                continue;
            }
            // Check captured wildcard is non-empty (after trim per spacing).
            const captured = request.substring(pending.start, wildcardEnd);
            const trimmed = trimWildcardCapture(
                captured,
                pending.transition.typeName,
                spacingMode,
            );
            if (trimmed.length === 0) {
                continue;
            }

            // Queue a longer-wildcard alternative — same thread but with
            // re.lastIndex advanced so the next iteration searches further.
            // We model this by emitting an extra alternative thread that
            // re-tries from `newCharPos` (re continues from m.index+1 in JS
            // when match is zero-length; here we just push a clone and let
            // the outer loop continue iterating).  Simplification for now:
            // spawn ONE longer alternative by advancing past this match.
            const longerThread: NFACharThreadState = {
                ...state,
                charPos: m.index + Math.max(1, m[0].length),
            };
            longerWildcardSpawn.push(longerThread);

            // Finalize capture into pending wildcard's slot.
            const fin = finalizeWildcardCapture(
                state,
                pending.transition,
                trimmed,
            );
            if (!fin.ok) {
                // Capture failed validation/conversion — try a longer span.
                continue;
            }

            return advanceThread(state, trans, newCharPos, fin.environment, {
                clearPendingWildcard: true,
                wildcardCharsConsumed: wildcardEnd - pending.start,
            });
        }
    }

    // No pending wildcard: sticky match at exact charPos.
    // "Leading" position = the first part of the current rule (canonical's
    // `partIndex === 0`).  Tracked via thread.atFirstPart, set on rule
    // entry and cleared after the first literal/wildcard advances.
    const isLeading = state.atFirstPart === true;
    // Effective leading mode: for a nested rule's first part, canonical's
    // `leadingSpacingMode(state)` returns the parent's snapshot; for a
    // top-level (or non-first) part it returns the rule's own mode.
    // "nested" = the current rule is itself a nested rule (has a parent
    // rule on the spacing stack BEYOND the top-level entry frame).
    const nested = (state.spacingStack?.length ?? 0) >= 2;
    const leadingMode =
        isLeading && nested ? state.parentSpacingMode : spacingMode;
    const { sticky, leadingIsAuto } = buildLiteralStickyRegex(
        candidate,
        spacingMode,
        isLeading,
        leadingMode,
    );
    sticky.lastIndex = state.charPos;
    const m = sticky.exec(request);
    if (m === null) return undefined;
    const newCharPos = state.charPos + m[0].length;
    if (!isBoundarySatisfied(request, newCharPos, spacingMode)) {
        return undefined;
    }
    // When entering a child rule from a parent in `required` mode at a
    // non-start position, the inter-rule boundary must contain at least
    // one separator char.  Canonical enforces this post-match via
    // `isBoundarySatisfied(request, parentIndex, "required")` after
    // entering the child.  We mirror that here: if the parent's saved
    // mode is `required`, the charPos was non-zero, and the leading
    // regex consumed zero separator chars, reject.
    if (
        isLeading &&
        nested &&
        state.parentSpacingMode === "required" &&
        state.charPos > 0
    ) {
        const consumedSepLen = m[0].length - candidate.length;
        if (consumedSepLen === 0) {
            return undefined;
        }
    }
    // In auto mode at non-zero charPos: required-sep check between prev char
    // and the first literal char.
    if (leadingIsAuto && state.charPos > 0) {
        // The sticky regex permitted ZERO separator chars between charPos
        // and the literal.  In auto mode, that's only legal if the
        // adjacency doesn't require a separator.
        const prevChar = request[state.charPos - 1];
        const firstLitChar = candidate[0];
        const consumedSepLen = m[0].length - candidate.length;
        if (
            consumedSepLen === 0 &&
            prevChar !== undefined &&
            firstLitChar !== undefined &&
            needsSeparatorInAutoMode(prevChar, firstLitChar)
        ) {
            return undefined;
        }
    }

    return advanceThread(state, trans, newCharPos, state.environment, {
        clearPendingWildcard: false,
        wildcardCharsConsumed: 0,
    });
}

/**
 * Returns `ok: false` when the captured span fails the wildcard's type
 * validation/conversion (caller should discard the branch).  Otherwise
 * `ok: true` with the new env to attach (cloned for thread isolation when
 * a slot was written; otherwise the existing env unchanged).
 */
function finalizeWildcardCapture(
    state: NFACharThreadState,
    wildcardTrans: NFATransition,
    captured: string,
): { ok: true; environment: Environment | undefined } | { ok: false } {
    let slotValue: SlotValue = captured;

    if (wildcardTrans.typeName) {
        if (wildcardTrans.typeName === "number") {
            const n = parseNumberToken(captured);
            if (n === undefined) return { ok: false };
            slotValue = n;
        } else {
            const validator = globalEntityRegistry.getValidator(
                wildcardTrans.typeName,
            );
            if (validator) {
                if (!validator.validate(captured)) return { ok: false };
            }
            // Unknown typeName (no validator) is treated as a wildcard with
            // no constraints — matches canonical behavior for user-defined
            // type aliases that aren't registered as entities.
            const converter = globalEntityRegistry.getConverter(
                wildcardTrans.typeName,
            );
            if (converter) {
                const converted = converter.convert(captured);
                if (converted === undefined) return { ok: false };
                slotValue = converted as SlotValue;
            }
        }
    }

    if (
        wildcardTrans.slotIndex === undefined ||
        state.environment === undefined
    ) {
        return { ok: true, environment: state.environment };
    }
    const newEnv = cloneEnvironment(state.environment);
    setSlotValue(
        newEnv,
        wildcardTrans.slotIndex,
        slotValue,
        wildcardTrans.appendToSlot ?? false,
    );
    return { ok: true, environment: newEnv };
}

function advanceThread(
    state: NFACharThreadState,
    trans: NFATransition,
    newCharPos: number,
    newEnvironment: Environment | undefined,
    opts: { clearPendingWildcard: boolean; wildcardCharsConsumed: number },
): NFACharThreadState {
    const isWildcardFinalize = opts.clearPendingWildcard;
    let checked = state.checkedWildcardCount;
    let unchecked = state.uncheckedWildcardCount;
    if (isWildcardFinalize && state.pendingWildcard) {
        const wt = state.pendingWildcard.transition;
        const isChecked =
            wt.checked === true ||
            (wt.typeName !== undefined &&
                wt.typeName !== "string" &&
                wt.typeName !== "wildcard");
        if (isChecked) checked++;
        else unchecked++;
    }
    return {
        stateId: trans.to,
        charPos: newCharPos,
        path: [...state.path, trans.to],
        fixedStringPartCount: state.fixedStringPartCount + 1,
        checkedWildcardCount: checked,
        uncheckedWildcardCount: unchecked,
        ruleIndex: state.ruleIndex,
        actionValue: state.actionValue,
        environment: newEnvironment,
        slotMap: state.slotMap,
        pendingWildcard: opts.clearPendingWildcard
            ? undefined
            : state.pendingWildcard,
        currentSpacingMode: state.currentSpacingMode,
        parentSpacingMode: state.parentSpacingMode,
        atFirstPart: false,
        spacingStack: state.spacingStack,
    };
}

/**
 * Process a single thread's outgoing non-epsilon transitions, producing
 * successor threads.  Threads with a pendingWildcard scan forward; threads
 * without consume at the current charPos.
 */
function expandThread(
    nfa: NFA,
    request: string,
    state: NFACharThreadState,
    out: NFACharThreadState[],
): void {
    const nfaState = nfa.states[state.stateId];
    if (!nfaState) return;

    for (const trans of nfaState.transitions) {
        if (trans.type === "epsilon") continue;

        if (trans.type === "token" && trans.tokens) {
            const longerSpawns: NFACharThreadState[] = [];
            // Prefer displayTokens (preserves authored case/punct) for raw
            // match; fall back to normalized tokens.
            const candidates =
                trans.displayTokens && trans.displayTokens.length > 0
                    ? trans.displayTokens
                    : trans.tokens;
            for (const cand of candidates) {
                const next = tryLiteralMatch(
                    request,
                    state,
                    trans,
                    cand,
                    longerSpawns,
                );
                if (next) {
                    out.push(next);
                }
            }
            // Queued longer-wildcard alternatives are re-injected into the
            // main work queue at the call site.
            for (const spawn of longerSpawns) {
                out.push(spawn);
            }
            continue;
        }

        if (trans.type === "wildcard") {
            // Number-typed wildcard: sticky match a number literal at the
            // current position (matches canonical `matchVarNumberPart`).
            // Without this, deferred capture would let the number wildcard
            // accept any prefix, breaking digit-digit boundary rules.
            if (trans.typeName === "number") {
                if (state.pendingWildcard === undefined) {
                    const numResult = tryStickyNumber(request, state, trans);
                    if (numResult) out.push(numResult);
                    continue;
                }
                // Pending wildcard before a number wildcard: scan forward
                // for a number, treating the leading span as the prior
                // wildcard's capture.  Mirrors canonical
                // `matchVarNumberPartWithWildcard`.
                const numResult = tryNumberWithPendingWildcard(
                    request,
                    state,
                    trans,
                );
                if (numResult) out.push(numResult);
                continue;
            }
            // Defer capture: record start position.  Type validation /
            // conversion happens at finalize time (next fixed text or
            // accept).  Spacing mode propagates from this transition.
            const newState: NFACharThreadState = {
                ...state,
                stateId: trans.to,
                path: [...state.path, trans.to],
                pendingWildcard: {
                    start: state.charPos,
                    transition: trans,
                },
                currentSpacingMode: state.currentSpacingMode,
                atFirstPart: false,
            };
            out.push(newState);
            continue;
        }

        // phraseSet: not yet implemented in char path.
    }
}

/**
 * Check whether an accepting thread's pending wildcard (if any) can be
 * finalized against the end-of-request, and whether trailing content is
 * acceptable per the rule's spacing mode.  Returns the finalized thread
 * (with pending wildcard cleared and slot written) or undefined.
 */
function tryAccept(
    nfa: NFA,
    request: string,
    state: NFACharThreadState,
): NFACharThreadState | undefined {
    if (!nfa.acceptingStates.includes(state.stateId)) return undefined;

    let charPos = state.charPos;
    let environment = state.environment;

    const ruleSpacing = state.currentSpacingMode;

    if (state.pendingWildcard) {
        const pending = state.pendingWildcard;
        const captured = request.substring(pending.start, request.length);
        const trimmed = trimWildcardCapture(
            captured,
            pending.transition.typeName,
            ruleSpacing,
        );
        if (trimmed.length === 0) return undefined;
        const fin = finalizeWildcardCapture(state, pending.transition, trimmed);
        if (!fin.ok) return undefined;
        environment = fin.environment;
        charPos = request.length;
    }

    if (charPos < request.length) {
        const tail = request.substring(charPos);
        // Only reject trailing chars under none-mode when we're at the
        // OUTERMOST rule (no nested context remaining on the spacing
        // stack).  For a nested none-rule inside a non-none parent,
        // trailing separator chars are governed by the parent's mode;
        // rejection of outer trailing whitespace for top-level none
        // happens in `matchGrammarWithNFA` post-match.
        const stackDepth = state.spacingStack?.length ?? 0;
        const atOutermost =
            stackDepth <= 1 &&
            (state.environment === undefined ||
                state.environment.parent === undefined);
        if (ruleSpacing === "none" && atOutermost) return undefined;
        if (!/^[\s\p{P}]*$/u.test(tail)) return undefined;
        charPos = request.length;
    }

    return {
        ...state,
        charPos,
        environment,
        pendingWildcard: undefined,
    };
}

/**
 * Run the char-based NFA matcher.
 */
export function matchNFACharBased(
    nfa: NFA,
    request: string,
    debug: boolean = false,
): NFAMatchResult {
    debugChar(
        `char-match request=${JSON.stringify(request)} nfa=${nfa.name ?? "(unnamed)"}`,
    );

    const initial = epsilonClosureChar(nfa, [makeInitialThread(nfa)]);
    const accepting: NFAMatchResult[] = [];
    const visited = new Set<number>(initial.map((s) => s.stateId));

    // Work queue of threads ready to expand at their current charPos.
    let frontier = initial;

    // Bound the iteration to avoid runaway loops while we stabilize the
    // matcher.  Each iteration either advances charPos or terminates
    // threads, so total work is O(|states| * |request| * fanout).
    const maxIter = 50000;
    let iter = 0;

    while (frontier.length > 0 && iter < maxIter) {
        iter++;
        const next: NFACharThreadState[] = [];

        for (const thread of frontier) {
            // Check acceptance opportunistically.
            const accepted = tryAccept(nfa, request, thread);
            if (accepted) {
                let evaluatedActionValue = accepted.actionValue;
                if (accepted.actionValue) {
                    const env = accepted.environment ?? createEnvironment(0);
                    evaluatedActionValue = evaluateExpression(
                        accepted.actionValue,
                        env,
                    );
                }
                accepting.push({
                    matched: true,
                    fixedStringPartCount: accepted.fixedStringPartCount,
                    checkedWildcardCount: accepted.checkedWildcardCount,
                    uncheckedWildcardCount: accepted.uncheckedWildcardCount,
                    ruleIndex: accepted.ruleIndex,
                    actionValue: evaluatedActionValue,
                    tokensConsumed: undefined,
                });
            }

            // Expand transitions from this thread.
            const expanded: NFACharThreadState[] = [];
            expandThread(nfa, request, thread, expanded);
            for (const ex of expanded) {
                visited.add(ex.stateId);
            }
            const closed = epsilonClosureChar(nfa, expanded);
            for (const c of closed) {
                visited.add(c.stateId);
                next.push(c);
            }
        }

        // Dedup frontier by (stateId, charPos, priority, pendingWildcard).
        const seen = new Set<string>();
        const deduped: NFACharThreadState[] = [];
        for (const t of next) {
            const pw = t.pendingWildcard ? `pw${t.pendingWildcard.start}` : "";
            const key = `${t.stateId}-${t.charPos}-${t.fixedStringPartCount}-${t.checkedWildcardCount}-${t.uncheckedWildcardCount}-${pw}`;
            if (seen.has(key)) continue;
            seen.add(key);
            deduped.push(t);
        }

        frontier = deduped;
    }

    if (iter >= maxIter) {
        debugChar(`char-match: HIT ITERATION CAP (${maxIter})`);
    }

    if (accepting.length === 0) {
        return {
            matched: false,
            fixedStringPartCount: 0,
            checkedWildcardCount: 0,
            uncheckedWildcardCount: 0,
            visitedStates: debug ? Array.from(visited) : undefined,
            tokensConsumed: undefined,
        };
    }

    const sorted = sortNFAMatches(accepting);
    return sorted[0];
}

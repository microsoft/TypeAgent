// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Rule definition identifier. Canonical: source-level rule name.
 * Examples: "<Start>", "<PlayAction>", "<Greeting>".
 */
export type RuleId = string;

/**
 * Stable identifier for a part within a rule. Compile-time integer
 * assigned during grammar compilation and propagated through
 * every optimizer pass. Falls back to the runtime part index when
 * the grammar was loaded without debug info.
 */
export type PartId = number;

/**
 * Discriminated union covering everything the rule-level stepper and
 * coverage service need from the grammar matcher.
 */
export type TraceEvent =
    | RuleEnteredEvent
    | RuleExitedEvent
    | PartAttemptedEvent
    | PartMatchedEvent
    | PartFailedEvent
    | BacktrackEvent;

interface BaseEvent {
    /** Monotonic counter within a single matchGrammar call. */
    readonly seq: number;
    /** Input character offset at the time of the event. */
    readonly inputPos: number;
}

export interface RuleEnteredEvent extends BaseEvent {
    readonly kind: "ruleEntered";
    readonly rule: RuleId;
    /** Depth in the rule call stack (0 = top-level). */
    readonly depth: number;
}

export interface RuleExitedEvent extends BaseEvent {
    readonly kind: "ruleExited";
    readonly rule: RuleId;
    readonly result: "matched" | "failed";
}

export interface PartAttemptedEvent extends BaseEvent {
    readonly kind: "partAttempted";
    readonly rule: RuleId;
    readonly part: PartId;
    /** Discriminator on the AST node kind. */
    readonly partKind: "string" | "wildcard" | "number" | "rules" | "phraseSet";
}

export interface PartMatchedEvent extends BaseEvent {
    readonly kind: "partMatched";
    readonly rule: RuleId;
    readonly part: PartId;
    /** End offset of the matched span in the input. */
    readonly endPos: number;
    /** Variable name and captured value, if this part captures a variable. */
    readonly capturedValue?:
        | {
              readonly variable: string;
              readonly value: unknown;
          }
        | undefined;
}

export interface PartFailedEvent extends BaseEvent {
    readonly kind: "partFailed";
    readonly rule: RuleId;
    readonly part: PartId;
}

export interface BacktrackEvent extends BaseEvent {
    readonly kind: "backtrack";
    /** Mirrors BacktrackOrigin from grammarMatcher. */
    readonly origin:
        | "wildcard"
        | "optional"
        | "alternation"
        | "repeat"
        | "memoMarker"
        | "memoReplay";
}

/**
 * Callback type for the opt-in trace hook. Receives events as the
 * matcher progresses through the grammar.
 */
export type TraceCallback = (event: TraceEvent) => void;

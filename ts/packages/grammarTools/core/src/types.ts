// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Grammar } from "action-grammar";

// Re-export Grammar type that callers need
export type { Grammar } from "action-grammar";

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

export type RuleId = string;
export type PartId = number;

// ---------------------------------------------------------------------------
// Source positions
// ---------------------------------------------------------------------------

export interface SourcePosition {
    line: number;
    character: number;
    offset: number;
}

export interface SourceRange {
    start: SourcePosition;
    end: SourcePosition;
}

export interface SourceLocation {
    fileId: string;
    displayPath: string;
    range: SourceRange;
}

// ---------------------------------------------------------------------------
// Loading model
// ---------------------------------------------------------------------------

export type GrammarSource =
    | { kind: "file"; path: string }
    | { kind: "buffer"; id: string }
    | { kind: "agent"; agentName: string; manifestPath: string }
    | { kind: "snapshot"; sessionId?: string }
    | { kind: "decompiled"; from: GrammarSource };

export interface SourceFile {
    readonly id: string;
    readonly text: string;
    readonly synthetic?: boolean;
}

export interface GrammarDebugInfo {
    readonly grammarHash: string;
    readonly rules: ReadonlyMap<RuleId, SourceLocation>;
    readonly parts: ReadonlyMap<PartId, SourceLocation>;
}

export interface GrammarIdentifierIndex {
    readonly ruleIds: readonly RuleId[];
    readonly partIds: readonly PartId[];
    readonly ruleIndex: ReadonlyMap<RuleId, number>;
}

export interface LoadedGrammar {
    readonly source: GrammarSource;
    readonly grammar: Grammar;
    readonly debugInfo?: GrammarDebugInfo;
    readonly files?: readonly SourceFile[];
    readonly identifiers: GrammarIdentifierIndex;
}

// ---------------------------------------------------------------------------
// Load result
// ---------------------------------------------------------------------------

export type LoadResult =
    | { ok: true; grammar: LoadedGrammar; diagnostics?: Diagnostic[] }
    | { ok: false; diagnostics: Diagnostic[]; files: SourceFile[] };

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export interface Diagnostic {
    range: SourceRange;
    severity: "error" | "warning" | "info" | "hint";
    code?: string;
    message: string;
    source: "grammar-tools-core";
}

// ---------------------------------------------------------------------------
// Symbol index
// ---------------------------------------------------------------------------

export interface SymbolInfo {
    readonly id: RuleId;
    readonly location: SourceLocation;
    readonly kind: "rule";
    readonly signature?: string;
}

export interface SymbolIndex {
    readonly symbols: readonly SymbolInfo[];
    readonly byId: ReadonlyMap<RuleId, SymbolInfo>;
    references(ruleId: RuleId): readonly SourceLocation[];
}

// ---------------------------------------------------------------------------
// Completion preview
// ---------------------------------------------------------------------------

export type SeparatorMode =
    | "space"
    | "spacePunctuation"
    | "optionalSpacePunctuation"
    | "optionalSpace"
    | "none"
    | "autoSpacePunctuation";

export type AfterWildcard = "none" | "some" | "all";

export interface CompletionGroup {
    completions: string[];
    separatorMode: SeparatorMode;
}

export interface CompletionProperty {
    propertyNames: string[];
    separatorMode: SeparatorMode;
}

export interface CompletionPreview {
    groups: CompletionGroup[];
    properties?: CompletionProperty[];
    matchedPrefixLength: number;
    afterWildcard: AfterWildcard;
    directionSensitive: boolean;
}

// ---------------------------------------------------------------------------
// Match trace
// ---------------------------------------------------------------------------

export type TraceEventKind =
    | "ruleEntered"
    | "ruleExited"
    | "partAttempted"
    | "partMatched"
    | "partFailed"
    | "backtrack";

export interface TraceEventBase {
    readonly seq: number;
    readonly inputPos: number;
}

export interface RuleEnteredEvent extends TraceEventBase {
    readonly kind: "ruleEntered";
    readonly rule: RuleId;
    readonly depth: number;
}

export interface RuleExitedEvent extends TraceEventBase {
    readonly kind: "ruleExited";
    readonly rule: RuleId;
    readonly result: "matched" | "failed";
}

export interface PartAttemptedEvent extends TraceEventBase {
    readonly kind: "partAttempted";
    readonly rule: RuleId;
    readonly part: PartId;
    readonly partKind: string;
}

export interface PartMatchedEvent extends TraceEventBase {
    readonly kind: "partMatched";
    readonly rule: RuleId;
    readonly part: PartId;
    readonly endPos: number;
    readonly slots?: Readonly<Record<string, string>>;
}

export interface PartFailedEvent extends TraceEventBase {
    readonly kind: "partFailed";
    readonly rule: RuleId;
    readonly part: PartId;
    readonly reason?: string;
}

export interface BacktrackEvent extends TraceEventBase {
    readonly kind: "backtrack";
    readonly origin:
        | "wildcard"
        | "optional"
        | "alternation"
        | "repeat"
        | "memoMarker"
        | "memoReplay";
}

export type TraceEvent =
    | RuleEnteredEvent
    | RuleExitedEvent
    | PartAttemptedEvent
    | PartMatchedEvent
    | PartFailedEvent
    | BacktrackEvent;

export interface MatchTrace {
    readonly input: string;
    readonly events: readonly TraceEvent[];
    readonly result: "matched" | "noMatch";
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

export interface PartCoverage {
    id: PartId;
    location?: SourceLocation;
    hits: number;
}

export interface RuleCoverage {
    id: RuleId;
    location?: SourceLocation;
    hits: number;
    parts: PartCoverage[];
}

export interface CoverageReport {
    grammarHash: string;
    totals: {
        rules: number;
        parts: number;
        ruleHits: number;
        partHits: number;
    };
    perRule: RuleCoverage[];
    unmatchedInputs: Array<{ input: string; reason?: string }>;
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

export type DiffChangeReason = "signature" | "body" | "value";

export interface RuleChange {
    rule: RuleId;
    reason: DiffChangeReason;
    before: string;
    after: string;
}

export interface GrammarDiff {
    added: RuleId[];
    removed: RuleId[];
    changed: RuleChange[];
}

// ---------------------------------------------------------------------------
// Snapshot (from dispatcher RPC, per ADR 0003)
// ---------------------------------------------------------------------------

export interface GrammarSnapshot {
    grammar: unknown;
    debugInfo?: unknown;
    sessionId?: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class GrammarToolsError extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
        super(message);
        this.code = code;
        this.name = "GrammarToolsError";
    }
}

export class MissingDebugInfoError extends GrammarToolsError {
    constructor(public readonly source: GrammarSource) {
        super(
            "MISSING_DEBUG_INFO",
            `Debug info not available for grammar source: ${describeSource(source)}`,
        );
        this.name = "MissingDebugInfoError";
    }
}

export class MissingSourceError extends GrammarToolsError {
    constructor(public readonly source: GrammarSource) {
        super(
            "MISSING_SOURCE",
            `Source files not available for grammar source: ${describeSource(source)}`,
        );
        this.name = "MissingSourceError";
    }
}

function describeSource(source: GrammarSource): string {
    switch (source.kind) {
        case "file":
            return source.path;
        case "buffer":
            return `buffer:${source.id}`;
        case "agent":
            return `agent:${source.agentName}`;
        case "snapshot":
            return `snapshot${source.sessionId ? `:${source.sessionId}` : ""}`;
        case "decompiled":
            return `decompiled(${describeSource(source.from)})`;
    }
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function hasDebugInfo(
    g: LoadedGrammar,
): g is LoadedGrammar & { debugInfo: GrammarDebugInfo } {
    return g.debugInfo !== undefined;
}

export function hasSource(
    g: LoadedGrammar,
): g is LoadedGrammar & { files: readonly SourceFile[] } {
    return g.files !== undefined && g.files.length > 0;
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * grammar-tools-core
 *
 * Framework-agnostic grammar language services for TypeAgent .agr grammars.
 * Wraps actionGrammar and exposes the complete service surface for all hosts.
 */

// Types (wire contract per ADR 0005)
export type {
    // Identifiers
    RuleId,
    PartId,
    // Source positions
    SourcePosition,
    SourceRange,
    SourceLocation,
    // Loading model
    GrammarSource,
    SourceFile,
    GrammarDebugInfo,
    GrammarIdentifierIndex,
    LoadedGrammar,
    LoadResult,
    // Diagnostics
    Diagnostic,
    // Symbols
    SymbolInfo,
    SymbolIndex,
    // Completion
    SeparatorMode,
    AfterWildcard,
    CompletionDirection,
    WildcardPolicy,
    OptionalPolicy,
    RepeatPolicy,
    CompletionOptions,
    CompletionGroup,
    CompletionProperty,
    CompletionPreview,
    // Trace
    TraceEventKind,
    TraceEvent,
    TraceCallback,
    RuleEnteredEvent,
    RuleExitedEvent,
    PartAttemptedEvent,
    PartMatchedEvent,
    PartFailedEvent,
    BacktrackEvent,
    MatchTrace,
    // Coverage
    PartCoverage,
    RuleCoverage,
    CoverageReport,
    // Diff
    DiffChangeReason,
    RuleChange,
    GrammarDiff,
    // Snapshot
    GrammarSnapshot,
} from "./types.js";

// Error classes and type guards
export {
    GrammarToolsError,
    MissingDebugInfoError,
    MissingSourceError,
    hasDebugInfo,
    hasSource,
} from "./types.js";

// Services
export { loadGrammarFromFile, loadGrammarFromBuffer } from "./loader.js";
export type { FileLoader } from "action-grammar";
export {
    getSymbolIndex,
    offsetToPosition,
    symbolAtPosition,
} from "./symbols.js";
export { format } from "./format.js";
export { previewCompletion } from "./completion.js";
export { traceMatch } from "./trace.js";
export { formatTrace } from "./formatTrace.js";
export type { FormatTraceOptions } from "./formatTrace.js";
export { computeCoverage } from "./coverage.js";
export { diffGrammars } from "./diff.js";

// Cross-agent grammar collision detection (NFA product construction).
export { findGrammarOverlap } from "./nfaIntersection.js";
export type { GrammarOverlap, FindOverlapOptions } from "./nfaIntersection.js";
export {
    scanGrammarCollisions,
    formatRulePartsText,
    collectTopLevelRules,
    stripTailCalls,
} from "./collisionScanner.js";
export type {
    SchemaInput,
    SchemaScanInfo,
    SchemaSkip,
    CollisionRecord,
    CollisionScanResult,
    ScanOptions,
} from "./collisionScanner.js";

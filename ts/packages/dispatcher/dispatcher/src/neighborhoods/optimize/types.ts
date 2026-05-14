// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Shared types for the `@collision optimize` command set. Phase 1 only uses
// the sandbox + override types; the case-analyzer / hypothesis / attempts
// types land here so later phases (registry + levers + miner) import a
// single source of truth.

import type {
    NeighborhoodMember,
    NeighborhoodPreview,
    PhraseSample,
} from "../types.js";

// =============================================================================
// FailurePattern — case classifier output (Phase 2 lands the classifier; types
// live here so the miner can group on them).
// =============================================================================

export type FailurePattern =
    | "singular-plural"
    | "similar-verb"
    | "cross-agent-verb"
    | "synonymous-actions"
    | "parameter-vs-action"
    | "unclassified";

// =============================================================================
// Structured rationale (Phase 4) — each lever's proposeHypotheses fills these
// in alongside the free-text rationale. The miner groups on (mechanism,
// guidelineHook); the Phase 9 distiller reads them to propose new
// schemaGuidelines entries.
// =============================================================================

export type Mechanism =
    | "widen-identity"
    | "add-important-line"
    | "add-wrong-right-example"
    | "add-positive-example"
    | "rename-action-suggestion"
    | "deprecate"
    | "tighten-parameter-type"
    | "other";

export type GuidelineHook =
    | "schema-shape-work-with-llm-intent"
    | "critical-constraint-format"
    | "identity-line-closest"
    | "property-comment-ordering"
    | "enum-like-properties"
    | null;

export interface DiffSummary {
    addedLines: number;
    removedLines: number;
    touchesIdentityLine: boolean;
    addsAntiExample: boolean;
}

// =============================================================================
// PhraseRecord — the unit of evidence in CaseDescription (Phase 2).
// =============================================================================

export interface PhraseRecord {
    phraseText: string;
    expectedSchema: string;
    expectedAction: string;
    /** Baseline-chosen schema (from translation-results.json). Undefined when
     *  outcome was CLARIFY/INVALID/ERROR. */
    chosenSchema?: string;
    chosenAction?: string;
    outcome: "CLEAN" | "MISROUTE" | "CLARIFY" | "INVALID" | "ERROR";
    /** Source style/model from the corpus phrase. */
    sources?: PhraseSample[];
}

// =============================================================================
// CaseDescription — Phase 2 case analyzer output. The case loop hands one of
// these to each lever's proposeHypotheses.
// =============================================================================

export interface CaseDescription {
    schemaVersion: 1;
    neighborhoodId: string;
    members: NeighborhoodMember[];
    severityTier: "blocker" | "leaky" | "minor";
    failurePattern: FailurePattern; // LLM-refined
    failurePatternHeuristic: FailurePattern; // raw heuristic
    misroutePhrases: PhraseRecord[];
    cleanPhrases: PhraseRecord[];
    /** Result-side phrases — baseline routed to a member but expected
     *  something else. Catches reverse-direction regressions. */
    reverseDirectionPhrases: PhraseRecord[];
    currentJSDoc: Record<string, string>;
    currentManifestDescriptions: Record<string, string>;
    currentPasDescriptions: Record<string, string>;
    /** Whole-file SHA-1 keyed by `${schemaName}:${kind}` where kind is
     *  "schema" | "manifest". Verified before any apply. */
    originalChecksum: Record<string, string>;
}

// =============================================================================
// Hypothesis + AttemptRecord — Phase 3+.
// =============================================================================

export interface Hypothesis {
    id: string; // "h01-jsdoc", with optional "-rN" suffix for depth N>0
    lever: string;
    depth: number;
    rationale: { free: string };
    mechanism: Mechanism;
    guidelineHook: GuidelineHook;
    diffSummary: DiffSummary;
    /** Lever-specific payload. Each lever defines its own shape. */
    payload: unknown;
}

export interface EvaluationResult {
    schemaVersion: 1;
    probeType: "translator";
    rescues: number;
    regressions: number;
    netDelta: number;
    score: number;
    regressionPhrases: string[];
}

export interface AttemptRecord {
    hypothesis: Hypothesis;
    evaluation: EvaluationResult;
    /** Path to the attempt directory on disk. */
    artifactPath: string;
}

export interface CaseResult {
    case: CaseDescription;
    attempts: AttemptRecord[];
    winner: AttemptRecord | null;
}

// =============================================================================
// OptimizationRun — top-level index produced by corpusLoop (Phase 3).
// =============================================================================

export interface OptimizationRunCorpusCoverage {
    totalCollisionMass: number;
    reachableMass: number;
    skippedAgents: string[];
}

export interface OptimizationRun {
    schemaVersion: 1;
    runId: string;
    builtAt: string;
    inputs: { baseline: string; corpus: string };
    cases: CaseResult[];
    /** Combined re-probe over the full corpus after stacking winners. */
    combinedReprobe?: EvaluationResult;
    sandboxRoot: string;
    corpusCoverage: OptimizationRunCorpusCoverage;
}

// =============================================================================
// ActionConfigOverride — per-schema sandbox-side filter for dropping actions
// (Phase 1 prune-lever infrastructure).
// =============================================================================

/** Contents of `sandbox/overrides/<schema>.actionConfig.json`. v1 supports
 *  only the "drop actions from getActionConfigs() reporting" mode. */
export interface ActionConfigOverride {
    schemaVersion: 1;
    /** Actions to hide from `getActionConfigs()` and lookups. Schema-relative
     *  names (e.g. "playTrack"). */
    droppedActions: string[];
}

// =============================================================================
// Neighborhood preview — re-export so optimize/ consumers don't need to know
// about the parent neighborhoods/types module.
// =============================================================================

export type { NeighborhoodPreview };

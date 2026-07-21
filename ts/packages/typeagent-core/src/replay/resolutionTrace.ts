// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Serializable resolution-trace types for the replay Trace Viewer.
 *
 * A replay row records only the *outcome* of resolving one utterance against two
 * agent versions (the produced action, the cache state, latency). To let a
 * developer drill into a red row and see *why* the two sides diverged, the
 * resolver also captures a step-by-step {@link ReplayResolutionTrace}: the
 * ordered fidelity layers each side exercised (cache consult, grammar match,
 * wildcard validation, action), the grammar-match event stream mapped back to
 * exact `.agr` source spans, and the construction-cache entry that was hit.
 *
 * Everything here is JSON-safe so a trace can be persisted with the run and sent
 * across the extension/webview boundary. The grammar match reuses
 * `grammar-tools-core`'s {@link MatchTrace} (its events are already plain data)
 * and a {@link SerializedGrammarDebugInfo} projection of that package's
 * `GrammarDebugInfo`, whose `ReadonlyMap`s are flattened to entry arrays so the
 * viewer can rebuild the maps and feed the existing timeline / source
 * components.
 */

import type {
    GrammarDebugInfo,
    MatchTrace,
    PartId,
    RuleId,
    SourceLocation,
} from "grammar-tools-core";
import type { CorpusFilter } from "../corpus/types.js";
import type {
    ReplayCacheState,
    ReplayMissPolicy,
    VersionSpec,
} from "./types.js";

/**
 * Whether a fidelity layer actually executed for a side, independent of its
 * outcome. A layer can be present in the trace yet not have run — e.g. the
 * construction cache is a live-only concept, so on a git-ref side it is
 * `not-applicable` rather than a `miss`. Keeping execution separate from outcome
 * stops an absent node from being read as a failure.
 */
export type TraceNodeExecution =
    | "ran"
    | "skipped-by-mode"
    | "not-applicable"
    | "unavailable"
    | "not-reached";

/** The result of a layer that actually ran. Only meaningful when the node's
 *  {@link TraceNodeExecution} is `"ran"`. */
export type TraceNodeOutcome =
    | "hit"
    | "miss"
    | "accepted"
    | "rejected"
    | "errored";

/** How a side's version was materialized: the live working tree (real compiled
 *  agent code, so live-only layers can run) or grammar/schema text read at a git
 *  ref (no build, so the cache and wildcard validation can't run). Mirrors the
 *  runtime's fidelity realization without coupling the replay layer to it. */
export type TraceRealization = "built-live" | "source";

/** A JSON-safe projection of `grammar-tools-core`'s `GrammarDebugInfo`. Its
 *  `ReadonlyMap`s are flattened to `[key, value]` entry arrays so the whole
 *  structure survives `JSON.stringify`; the viewer rebuilds the maps before
 *  handing them to the grammar components. */
export interface SerializedGrammarDebugInfo {
    grammarHash: string;
    rules: Array<[RuleId, SourceLocation]>;
    parts: Array<[PartId, SourceLocation]>;
    partRules: Array<[PartId, RuleId]>;
    partLabels: Array<[PartId, string]>;
    filePaths: Array<[string, string]>;
}

/**
 * A construction-cache entry surfaced for inspection in the viewer. Built from
 * the matched construction so the cache node can be read inline without any host
 * round-trip. Never the in-memory construction class — only this flattened,
 * serializable identity.
 */
export interface ConstructionCacheEntryDto {
    /** The normalized action the cache entry produced. */
    action: unknown;
    /** Stable identity of the matched construction within its namespace. */
    constructionId?: string;
    /** The cache namespace the construction lives in. */
    namespace?: string;
    /** Human-readable rendering of the construction's parts. */
    parts?: string[];
    /** Ranking counts that decided this construction won. */
    scores?: {
        matchedCount?: number;
        wildcardCharCount?: number;
        nonOptionalCount?: number;
    };
    /** The cache file the entry was read from, for a "reveal in cache" jump. */
    cacheFileId?: string;
}

interface TraceNodeBase {
    execution: TraceNodeExecution;
    outcome?: TraceNodeOutcome;
    /** Short human explanation shown as hover detail (e.g. why a layer was
     *  skipped or unavailable). */
    detail?: string;
}

/** The construction-cache consult. Live-only: `ran` on a working-tree side,
 *  `not-applicable` on a git-ref side. */
export interface CacheConsultTraceNode extends TraceNodeBase {
    kind: "cache-consult";
    /** The matched cache entry, present when the consult was a `hit`. */
    entry?: ConstructionCacheEntryDto;
}

/**
 * The grammar match. Carries the captured recursive-matcher {@link MatchTrace}
 * plus the serialized debug info needed to resolve each event to a `.agr` line,
 * and the winning rule's source span for the one-click jump.
 */
export interface GrammarMatchTraceNode extends TraceNodeBase {
    kind: "grammar-match";
    /** The utterance fed to the matcher. */
    input: string;
    /** The captured step-by-step match trace, when tracing succeeded. */
    trace?: MatchTrace;
    /** Serialized debug info to map trace events to source spans. */
    debugInfo?: SerializedGrammarDebugInfo;
    /** The winning rule the chosen parse settled on. */
    chosenRule?: RuleId;
    /** Source span of the winning rule/alternative for the jump-to-line action. */
    source?: SourceLocation;
    /**
     * Absolute path of the `.agr` grammar file this side matched against, the
     * same real repo file on both sides (the git-ref side's content is read via
     * `git show`). Recorded independently of {@link source} — whose `displayPath`
     * is only the grammar's basename — so the viewer can open the exact file and
     * diff it across the two versions. Absent when no grammar file backs the
     * match (e.g. a cache short-circuit or a build failure).
     */
    sourceFilePath?: string;
    /**
     * Whether the traced parse (recursive matcher) agreed with the resolver's
     * ranked pick (NFA `sortMatches`). `diverged` flags that the captured trace
     * explains a different action than the row recorded; `unavailable` means no
     * trace could be produced (e.g. no debug info).
     */
    rankingParity: "matched" | "diverged" | "unavailable";
}

/** The opt-in wildcard-value validation pass. Live-only. */
export interface WildcardValidationTraceNode extends TraceNodeBase {
    kind: "wildcard-validation";
    /** Fail-open reasons when validation degraded (e.g. validator threw). */
    diagnostics?: string[];
}

/** The produced action and where its type is declared, for the schema jump. */
export interface ActionTraceNode extends TraceNodeBase {
    kind: "action";
    /** The typed action JSON this side produced, when matched. */
    action?: unknown;
    /** The action's schema location, for the jump-to-variant action. */
    schema?: {
        sourceFilePath?: string;
        actionName?: string;
    };
}

export type ReplayTraceNode =
    | CacheConsultTraceNode
    | GrammarMatchTraceNode
    | WildcardValidationTraceNode
    | ActionTraceNode;

/** One side's resolution trace: the ordered layers it exercised and the action
 *  it settled on. Nodes are aligned across sides so the viewer can render them
 *  as matching rows (a live-only layer shows as `not-applicable` on the ref
 *  side rather than being omitted). */
export interface ReplaySideTrace {
    side: "A" | "B";
    version: VersionSpec;
    realization: TraceRealization;
    nodes: ReplayTraceNode[];
    /** The action this side produced, when matched. */
    finalAction?: unknown;
    cacheState: ReplayCacheState;
}

/** The full drill-in for one utterance: both sides' traces, keyed to the run and
 *  row they explain. Persisted with the run for red rows and read back by the
 *  viewer, so it always reflects the exact resolution that produced the row. */
export interface ReplayResolutionTrace {
    runId: string;
    utteranceId: string;
    utterance: string;
    a: ReplaySideTrace;
    b: ReplaySideTrace;
    /** Epoch ms the trace was captured (during the corpus run). */
    capturedAt: number;
}

/** The replay modes a trace can be captured under; mirrors the runtime's replay
 *  mode without coupling the replay layer to the runtime package. */
export type ReplayTraceMode = "nfa-grammar" | "completionBased-cache";

/** The concrete identity a side ran against, pinned at run time so a bare
 *  `HEAD`/branch label (which moves) or drifting working-tree content stays
 *  bound to what the report reflects. */
export interface TraceVersionPin {
    spec: VersionSpec;
    /** The display label the run used (e.g. "HEAD (main)"). */
    label: string;
    /** The resolved commit SHA, when the side is a git ref. */
    sha?: string;
    /** True when the side is the live working tree (uncommitted edits). */
    workingTree: boolean;
    /**
     * Content hashes of the working-tree grammar/schema/cache inputs at run time,
     * keyed by a stable input name. Only the working-tree side can drift, so this
     * is how its original trace is later detected as reproducible or stale.
     */
    contentHashes?: Record<string, string>;
}

/**
 * The exact inputs a replay run used, persisted with the run so a stored trace
 * can be reproduced (or flagged as drifted) later. Captures the pinned versions,
 * the resolution settings, and the corpus identity — everything the shared
 * resolution path needs to recompute a fresh trace for the same row.
 */
export interface ReplayRunDescriptor {
    runId: string;
    agent: string;
    a: TraceVersionPin;
    b: TraceVersionPin;
    mode: ReplayTraceMode;
    missPolicy: ReplayMissPolicy;
    validateWildcards: boolean;
    corpus: CorpusFilter;
    /** Epoch ms the run was issued. */
    runAt: number;
}

/** Flatten a `grammar-tools-core` `GrammarDebugInfo` into its JSON-safe
 *  projection so it can be persisted and sent to the viewer. */
export function serializeGrammarDebugInfo(
    debugInfo: GrammarDebugInfo,
): SerializedGrammarDebugInfo {
    return {
        grammarHash: debugInfo.grammarHash,
        rules: [...debugInfo.rules],
        parts: [...debugInfo.parts],
        partRules: [...debugInfo.partRules],
        partLabels: [...debugInfo.partLabels],
        filePaths: [...debugInfo.filePaths],
    };
}

/** Rebuild a `GrammarDebugInfo` (with real `Map`s) from its serialized form so
 *  the viewer can hand it to the grammar components. */
export function deserializeGrammarDebugInfo(
    serialized: SerializedGrammarDebugInfo,
): GrammarDebugInfo {
    return {
        grammarHash: serialized.grammarHash,
        rules: new Map(serialized.rules),
        parts: new Map(serialized.parts),
        partRules: new Map(serialized.partRules),
        partLabels: new Map(serialized.partLabels),
        filePaths: new Map(serialized.filePaths),
    };
}

/** Inputs for {@link buildTraceVersionPin}. The `spec` decides which of `sha`
 *  (git ref) and `contentHashes` (working tree) is meaningful; the builder keeps
 *  only the applicable one. */
export interface TraceVersionPinInput {
    spec: VersionSpec;
    label: string;
    sha?: string;
    contentHashes?: Record<string, string>;
}

/** Assemble a {@link TraceVersionPin}, deriving `workingTree` from the spec and
 *  dropping fields that can't apply to that side: a commit SHA identifies a
 *  git-ref side (the working tree has none), and only the working tree can drift,
 *  so content hashes are recorded for it alone. */
export function buildTraceVersionPin(
    input: TraceVersionPinInput,
): TraceVersionPin {
    const workingTree = input.spec.kind === "workingTree";
    const pin: TraceVersionPin = {
        spec: input.spec,
        label: input.label,
        workingTree,
    };
    if (!workingTree && input.sha !== undefined) {
        pin.sha = input.sha;
    }
    if (workingTree && input.contentHashes !== undefined) {
        pin.contentHashes = input.contentHashes;
    }
    return pin;
}

/** Inputs for {@link buildReplayRunDescriptor}. Pins are supplied already
 *  resolved (SHA/content-hash resolution belongs to the runtime layer); this
 *  builder only assembles the JSON-safe descriptor and stamps `runAt`. */
export interface ReplayRunDescriptorInput {
    runId: string;
    agent: string;
    a: TraceVersionPin;
    b: TraceVersionPin;
    mode: ReplayTraceMode;
    missPolicy: ReplayMissPolicy;
    validateWildcards: boolean;
    corpus: CorpusFilter;
    /** Epoch ms the run was issued; defaults to the injected clock. */
    runAt?: number;
}

/** Build the {@link ReplayRunDescriptor} persisted with a run so a stored trace
 *  can later be reproduced (or flagged as drifted) from the same inputs. */
export function buildReplayRunDescriptor(
    input: ReplayRunDescriptorInput,
    now: () => number = Date.now,
): ReplayRunDescriptor {
    return {
        runId: input.runId,
        agent: input.agent,
        a: input.a,
        b: input.b,
        mode: input.mode,
        missPolicy: input.missPolicy,
        validateWildcards: input.validateWildcards,
        corpus: input.corpus,
        runAt: input.runAt ?? now(),
    };
}

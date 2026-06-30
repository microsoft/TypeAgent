// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
    InMemoryOnboardingBridge,
    ONBOARDING_PHASE_ORDER,
    type OnboardingPhaseName,
    type PhaseStatus,
    type OnboardingState,
    type RestorePhaseResult,
    routeStudioConversation,
} from "../onboardingBridge/index.js";
import { FileHealthService, type HealthFinding } from "../health/index.js";
import { InProcessEventStream } from "../events/index.js";
import type { StudioEvent, StudioEventType } from "../events/index.js";
import {
    createRepoAgentLoader,
    InMemorySandboxManager,
    type SandboxManager,
    type SandboxStatus,
} from "../sandbox/index.js";
import {
    FileCorpusService,
    importDisplayLogs,
    type CorpusEntry,
    type CorpusFilter,
    type CorpusService,
    type ExternalSourceSpec,
    type ImportDisplayLogsResult,
} from "../corpus/index.js";
import {
    CoreFeedbackService,
    InMemoryFeedbackBackend,
    type FeedbackCorpusProjector,
    type FeedbackFilter,
    type FeedbackRecordInput,
    type FeedbackRow,
    type FeedbackService,
} from "../feedback/index.js";
import {
    replayCorpus,
    type ActionDelta,
    type ReplayActionResolver,
    type ReplayAgentResolution,
    type ReplayMissPolicy,
    type ReplaySummary,
    type VersionSpec,
} from "../replay/index.js";
import {
    InProcessCollisionService,
    type CollisionFilter,
    type CollisionService,
} from "../collisions/index.js";
import {
    createRepoGrammarScanner,
    type GrammarCollisionScanner,
    type GrammarScanSkip,
} from "../collisions/scanner.js";
import {
    createGrammarReplayResolver,
    resolveGrammarReplayTarget,
    ReplayVersionBuildError,
    type ReplayRunError,
    type GrammarReplayTarget,
    type GrammarReplayResolver,
} from "../replay/grammarResolver.js";
import {
    computeWorkingTreeSchemaHash,
    loadConstructionCacheLayer,
    type ConstructionCacheLayer,
} from "../replay/constructionCacheResolver.js";
import type {
    WildcardMatchValidator,
    WildcardValidationDiagnostic,
} from "../replay/wildcardValidator.js";
import type { CollisionDetectedEvent } from "../events/index.js";
import { getDefaultPhaseInputs } from "./onboardingPhaseInputs.js";
import {
    resolveRepoRoot,
    type RepoRootResolution,
} from "./repoRootResolver.js";

const LAST_ONBOARDING_SESSION_KEY = "studio.lastOnboardingSessionId";
const DEFAULT_SANDBOX_ID = "studio-default";
const PERSISTED_SANDBOXES_KEY = "studio.persistedSandboxes";

interface PersistedSandbox {
    id: string;
    agents: string[];
}

const SANDBOX_LIFECYCLE_EVENT_TYPES: StudioEventType[] = [
    "sandbox.start",
    "sandbox.stop",
    "sandbox.restart",
    "sandbox.agent.loaded",
    "sandbox.agent.unloaded",
];

/**
 * Explicit path to a construction cache file for the construction-cache replay
 * consult. Set this
 * to make the construction-cache layer deterministic (e.g. point it at a known
 * session cache); when unset the runtime best-effort discovers the newest cache
 * under the user data dir.
 */
const STUDIO_CONSTRUCTION_CACHE_ENV = "TYPEAGENT_STUDIO_CONSTRUCTION_CACHE";

/** Mirrors the dispatcher's `getUserDataDir()` without depending on it. */
function studioUserDataDir(): string {
    return (
        process.env.TYPEAGENT_USER_DATA_DIR ??
        path.join(os.homedir(), ".typeagent")
    );
}

/**
 * Best-effort locate the newest construction cache JSON (a file ending in
 * `.json` directly under a `constructions` directory) beneath `dir`, bounded by
 * `depth` to keep the scan cheap. Returns the path + mtime of the newest match.
 */
async function newestConstructionsCache(
    dir: string,
    depth: number,
): Promise<{ path: string; mtimeMs: number } | undefined> {
    if (depth < 0) {
        return undefined;
    }
    let best: { path: string; mtimeMs: number } | undefined;
    const inConstructionsDir = path.basename(dir) === "constructions";
    let entries;
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return undefined;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "node_modules" || entry.name === ".git") {
                continue;
            }
            const sub = await newestConstructionsCache(full, depth - 1);
            if (
                sub !== undefined &&
                (best === undefined || sub.mtimeMs > best.mtimeMs)
            ) {
                best = sub;
            }
        } else if (
            inConstructionsDir &&
            entry.isFile() &&
            entry.name.endsWith(".json")
        ) {
            try {
                const s = await fs.stat(full);
                if (best === undefined || s.mtimeMs > best.mtimeMs) {
                    best = { path: full, mtimeMs: s.mtimeMs };
                }
            } catch {
                // ignore unreadable entries
            }
        }
    }
    return best;
}

/**
 * Resolve the construction cache file to consult: an explicit
 * {@link STUDIO_CONSTRUCTION_CACHE_ENV} override (deterministic) if it points at
 * a real file, else the newest discovered session cache under the user data dir.
 * Returns `undefined` when nothing usable is found (replay stays at the grammar match).
 */
async function discoverLiveConstructionCacheFile(): Promise<
    string | undefined
> {
    const override = process.env[STUDIO_CONSTRUCTION_CACHE_ENV];
    if (override !== undefined && override !== "") {
        try {
            return (await fs.stat(override)).isFile() ? override : undefined;
        } catch {
            return undefined;
        }
    }
    const found = await newestConstructionsCache(studioUserDataDir(), 6);
    return found?.path;
}

/**
 * Build the {@link ConstructionCacheLayer} for a resolved grammar target:
 * compute the working-tree schema-file hash, discover the live cache, and gate
 * the consult on the hash. Returns `undefined` when the agent's schema can't be
 * hashed or no live cache exists — in either case replay stays at the grammar match.
 */
async function resolveConstructionCacheLayer(
    target: GrammarReplayTarget,
): Promise<ConstructionCacheLayer | undefined> {
    const schema = target.schema;
    if (schema === undefined) {
        return undefined;
    }
    const cacheFilePath = await discoverLiveConstructionCacheFile();
    if (cacheFilePath === undefined) {
        return undefined;
    }
    const currentHash = await computeWorkingTreeSchemaHash({
        schemaType: schema.schemaType,
        sourceFilePath: schema.sourceFilePath,
        ...(schema.builtSchemaFilePath !== undefined
            ? { builtSchemaFilePath: schema.builtSchemaFilePath }
            : {}),
        ...(schema.paramSpecConfigPath !== undefined
            ? { paramSpecConfigPath: schema.paramSpecConfigPath }
            : {}),
    });
    if (currentHash === undefined) {
        return undefined;
    }
    return loadConstructionCacheLayer({
        cacheFilePath,
        schemaName: target.schemaName,
        currentHash,
    });
}

export type PackagingHealthGateStatus =
    | "pass"
    | "warn"
    | "fail"
    | "unavailable";

export interface PackagingHealthGateResult {
    status: PackagingHealthGateStatus;
    summary: string;
    findings: HealthFinding[];
    artifactPath: string;
    checkedAgent?: string;
}

/**
 * Which deterministic dispatch path replay models:
 * - `nfa-grammar` (default) — grammar-only matching through the real NFA grammar
 *   store, symmetric for both versions. The construction cache is NOT consulted
 *   (faithful to the dispatcher's `grammarSystem: "nfa"` mode, where cache
 *   validation is intentionally skipped). The cleanest signal for "what did my
 *   `.agr` edit change", since A and B are equivalent environments.
 * - `completionBased-cache` — the live working-tree side additionally consults
 *   the agent's real per-session construction cache before the grammar match
 *   (faithful to the dispatcher's default `completionBased` mode). Asymmetric:
 *   only the working-tree side reads the cache, so a cache hit can mask or fake a
 *   grammar regression. Opt-in for "what would my default dispatcher likely do".
 */
export type StudioReplayMode = "nfa-grammar" | "completionBased-cache";

/** Request shape for {@link StudioRuntime.replayCorpus}. Versions and miss
 *  policy default to a deterministic working-tree self-compare. */
export interface StudioReplayRequest {
    agent: string;
    corpus?: CorpusFilter;
    versionA?: VersionSpec;
    versionB?: VersionSpec;
    missPolicy?: ReplayMissPolicy;
    /** Deterministic dispatch path to model. Defaults to `nfa-grammar`. */
    mode?: StudioReplayMode;
    /**
     * Opt-in: additionally run the agent's real `validateWildcardMatch` over the
     * working-tree side's wildcard grammar matches (the dispatcher's post-match
     * validation step). Default off. Only takes effect when the runtime was given
     * a `resolveWildcardValidator` and the agent's manifest declares it
     * replay-safe; otherwise it is a no-op. Working-tree side only; fail-open. See
     * {@link StudioReplayResult.wildcardValidation}.
     */
    validateWildcards?: boolean;
}

/**
 * How a replay resolved corpus utterances into actions:
 * - `identity` — the deterministic baseline (surfaces each entry's captured
 *   `expectedAction`); no grammar is evaluated.
 * - `static-grammar` — the agent's grammar was compiled for each version and
 *   matched through the real grammar store (NFA + `sortMatches`), but WITHOUT
 *   schema-derived checked-variable enrichment (the schema couldn't be
 *   discovered). Indicative, not authoritative.
 * - `schema-grammar` — as `static-grammar`, plus the grammar was enriched with
 *   `checked_wildcard` metadata from the agent's action schema before NFA
 *   compilation, so `checked_wildcard` parameters compile exactly as the
 *   dispatcher does. Still indicative (no construction cache / wildcard-value
 *   validation), so the UI labels it accordingly.
 * - `construction-cache` — the live working-tree side additionally consulted the
 *   agent's real per-session construction cache, hash-gated to the current
 *   schema exactly as the dispatcher gates it. A construction `hit` is a faithful
 *   cache resolution; everything else falls through to the (enriched) grammar.
 *   Only used when a live cache was discovered AND its namespace hash still
 *   matches the working tree; otherwise the run degrades to `schema-grammar` /
 *   `static-grammar`.
 */
export type StudioReplayMethod =
    | "identity"
    | "static-grammar"
    | "schema-grammar"
    | "construction-cache";

/**
 * The deterministic fidelity layers a replay side can exercise, mirroring the
 * dispatcher's path: grammar match → schema enrichment → construction cache →
 * wildcard validation → full dispatch. The Impact Report surfaces a per-side
 * matrix of these so the run is honest about exactly what it ran (and what
 * building from a ref would add) instead of over-claiming fidelity.
 */
export type FidelityLayer =
    | "grammar"
    | "schemaEnrichment"
    | "constructionCache"
    | "wildcardValidation"
    | "dispatch";

export type FidelityLayerStatus = "ran" | "skipped" | "unavailable";

export interface FidelityLayerReport {
    status: FidelityLayerStatus;
    /** Short human reason (shown as hover detail). */
    reason: string;
}

/**
 * How fully a side's version was realized: `built-live` (the working tree — real
 * compiled agent code) or `source` (only grammar/schema text materialized at a
 * git ref via `git show`; no build, so live-only layers can't run).
 */
export type FidelityRealization = "built-live" | "source";

export interface FidelityReport {
    realization: FidelityRealization;
    layers: Record<FidelityLayer, FidelityLayerReport>;
}

export interface SideFidelity {
    A: FidelityReport;
    B: FidelityReport;
}

export interface StudioReplayResult {
    runId: string;
    summary: ReplaySummary;
    rows: ActionDelta[];
    /** How utterances were resolved into actions (drives the UI's method label). */
    method: StudioReplayMethod;
    /**
     * Per-side resolution method. The construction cache is live-only, so it is
     * consulted for a working-tree side only — a git ref is at best
     * `schema-grammar`/`static-grammar`, never `construction-cache`. The UI
     * renders these under each A/B version field so the run-level `method` chip
     * doesn't over-claim the cache for a side that never read it.
     */
    methodA: StudioReplayMethod;
    methodB: StudioReplayMethod;
    /**
     * Set when the opt-in wildcard validation actually consulted the agent's
     * `validateWildcardMatch` (a wildcard match occurred on the working-tree
     * side). Omitted when validation was off or never reached a wildcard match.
     */
    wildcardValidation?: StudioWildcardValidationInfo;
    /**
     * Per-side fidelity descriptor: how each version was realized and which
     * deterministic layers actually ran. Derived purely from signals the replay
     * already computed (per-side method, mode, version kind, the wildcard
     * validation pass) so the Impact Report can show an honest "what ran" matrix.
     */
    sideFidelity: SideFidelity;
    /**
     * with an empty summary rather than emitting fabricated regression rows.
     */
    error?: ReplayRunError;
}

/**
 * Reports the opt-in wildcard-validation pass. Only present when validation was
 * enabled AND consulted on at least one wildcard match. `diagnostics` lists fail-open reasons (e.g. the agent's module
 * couldn't load, or its validator threw), so the UI can show that validation
 * degraded rather than silently claiming full fidelity.
 */
export interface StudioWildcardValidationInfo {
    applied: boolean;
    diagnostics: WildcardValidationDiagnostic[];
}

const FIDELITY_DISPATCH_REASON =
    "Full dispatcher path (LLM translation + action handlers) is not run — replay is deterministic grammar/cache matching only.";

export interface DeriveSideFidelityInput {
    versionA: VersionSpec;
    versionB: VersionSpec;
    methodA: StudioReplayMethod;
    methodB: StudioReplayMethod;
    mode: StudioReplayMode;
    validateWildcards: boolean;
    wildcardValidation?: StudioWildcardValidationInfo;
}

/**
 * Derive the per-side {@link SideFidelity} from signals the replay already
 * produced. Pure and deterministic so it is unit-testable and reusable by any
 * client. Wildcard validation only ever runs on the working-tree side, so the
 * single `wildcardValidation` info (when present) is interpreted per side.
 */
export function deriveSideFidelity(
    input: DeriveSideFidelityInput,
): SideFidelity {
    return {
        A: deriveFidelityReport(
            input.versionA,
            input.methodA,
            input.mode,
            input.validateWildcards,
            input.wildcardValidation,
        ),
        B: deriveFidelityReport(
            input.versionB,
            input.methodB,
            input.mode,
            input.validateWildcards,
            input.wildcardValidation,
        ),
    };
}

function deriveFidelityReport(
    version: VersionSpec,
    method: StudioReplayMethod,
    mode: StudioReplayMode,
    validateWildcards: boolean,
    wildcardValidation: StudioWildcardValidationInfo | undefined,
): FidelityReport {
    const isWorkingTree = version.kind === "workingTree";
    return {
        realization: isWorkingTree ? "built-live" : "source",
        layers: {
            grammar: fidelityGrammarLayer(method),
            schemaEnrichment: fidelitySchemaEnrichmentLayer(method),
            constructionCache: fidelityConstructionCacheLayer(
                method,
                isWorkingTree,
                mode,
            ),
            wildcardValidation: fidelityWildcardValidationLayer(
                isWorkingTree,
                validateWildcards,
                wildcardValidation,
            ),
            dispatch: {
                status: "unavailable",
                reason: FIDELITY_DISPATCH_REASON,
            },
        },
    };
}

function fidelityGrammarLayer(method: StudioReplayMethod): FidelityLayerReport {
    if (method === "identity") {
        return {
            status: "skipped",
            reason: "Identity baseline — surfaces each entry's captured action without evaluating a grammar.",
        };
    }
    return {
        status: "ran",
        reason: "Utterances matched through the real grammar store (NFA + sortMatches), the same engine the dispatcher uses.",
    };
}

function fidelitySchemaEnrichmentLayer(
    method: StudioReplayMethod,
): FidelityLayerReport {
    if (method === "schema-grammar" || method === "construction-cache") {
        return {
            status: "ran",
            reason: "Grammar enriched with checked_wildcard metadata from the agent's action schema before compilation.",
        };
    }
    if (method === "static-grammar") {
        return {
            status: "skipped",
            reason: "Agent action-schema not discoverable at this version — matched the bare grammar (still indicative).",
        };
    }
    return {
        status: "skipped",
        reason: "Identity baseline — no grammar evaluated.",
    };
}

function fidelityConstructionCacheLayer(
    method: StudioReplayMethod,
    isWorkingTree: boolean,
    mode: StudioReplayMode,
): FidelityLayerReport {
    if (method === "construction-cache") {
        return {
            status: "ran",
            reason: "Consulted the agent's live construction cache (the dispatcher's first check), hash-gated to the current schema.",
        };
    }
    if (!isWorkingTree) {
        return {
            status: "unavailable",
            reason: "Construction caches are runtime artifacts, never committed — they cannot be read at a git ref.",
        };
    }
    if (mode === "completionBased-cache") {
        return {
            status: "skipped",
            reason: "No live cache was discovered, or it was stale versus the current schema → grammar fallback.",
        };
    }
    return {
        status: "skipped",
        reason: "Grammar mode — the construction cache is intentionally not consulted (keeps matches A/B-symmetric).",
    };
}

function fidelityWildcardValidationLayer(
    isWorkingTree: boolean,
    validateWildcards: boolean,
    wildcardValidation: StudioWildcardValidationInfo | undefined,
): FidelityLayerReport {
    if (!isWorkingTree) {
        return {
            status: "unavailable",
            reason: "The agent's validator code isn't built at a git ref — validation runs on the working-tree side only.",
        };
    }
    if (!validateWildcards) {
        return {
            status: "skipped",
            reason: "Validate toggle is off.",
        };
    }
    if (wildcardValidation?.applied === true) {
        const diagnostics = wildcardValidation.diagnostics;
        if (diagnostics.includes("load-failed")) {
            return {
                status: "unavailable",
                reason: "Agent module couldn't be loaded (e.g. a packaged build ships no agent code) — matches fell back to the grammar.",
            };
        }
        if (diagnostics.includes("no-validator")) {
            return {
                status: "skipped",
                reason: "Agent exposes no validateWildcardMatch — validation made no change.",
            };
        }
        if (diagnostics.includes("errored")) {
            return {
                status: "ran",
                reason: "Validator threw on a match; the match was kept fail-open so the run stayed grammar-faithful.",
            };
        }
        return {
            status: "ran",
            reason: "Ran the agent's real validateWildcardMatch over its wildcard matches; rejected matches were dropped.",
        };
    }
    return {
        status: "skipped",
        reason: "Validation enabled but did not run — no wildcard match occurred, or the agent isn't validatable.",
    };
}

export interface StudioCollisionScanRequest {
    /**
     * Agent package names to scan. Defaults to every agent currently loaded
     * across running sandboxes.
     */
    agents?: string[];
    /** Sandbox id recorded on reported collisions. Defaults to the studio sandbox. */
    sandboxId?: string;
    /**
     * When true (default), clears prior `grammar-edit` collisions before
     * reporting the fresh scan so the view reflects the current grammars.
     */
    replace?: boolean;
}

export interface StudioCollisionScanResult {
    /** Schema names that compiled and participated in the scan. */
    scanned: string[];
    /** Agents/schemas skipped, with reasons. */
    skipped: GrammarScanSkip[];
    /** Number of collisions reported into the store. */
    collisionCount: number;
}

/** Request to import one or more displayLog.json files into the corpus. */
export interface StudioCorpusImportRequest {
    /** Absolute paths to displayLog.json files to read. */
    paths: string[];
    /** Restrict capture to these agents; omit to accept any non-empty agent. */
    agents?: string[];
    /** Session identifier recorded in provenance. */
    sessionId?: string;
}

/** Outcome of a corpus import: counts written/skipped per agent and files read. */
export type StudioCorpusImportResult = ImportDisplayLogsResult;

/** An agent discoverable in the Load agent UI. */
export interface AvailableAgent {
    name: string;
    /** Emoji from the agent's manifest (`emojiChar`), when resolvable. */
    emoji?: string;
}

/** A directory Studio scans for agents, with what it found there. */
export interface AgentLocation {
    /** Resolved absolute path of the agent root. */
    root: string;
    /** Whether the directory exists / is readable. */
    exists: boolean;
    /** Number of agent packages (declaring `./agent/manifest`) found in it. */
    agentCount: number;
    /**
     * True when this root is an **external** location contributed by the
     * `agentSearchPaths` setting, rather than the repository's own
     * `packages/agents` (which is always the first, non-external root).
     */
    external: boolean;
}

export interface StudioRuntime {
    /**
     * Repo root used for agent discovery and whether a `packages/agents`
     * directory was actually found there. When not found, the UI should warn
     * that health/corpus/collision results will be empty until the correct
     * folder (the monorepo's `ts/` directory) is opened.
     */
    getRepoRootInfo(): RepoRootResolution;
    startOnboarding(seed: {
        description: string;
        agentName?: string;
    }): Promise<OnboardingState>;
    installLastSessionToSandbox(
        sandboxId?: string,
        options?: { skipHealthGate?: boolean },
    ): Promise<{
        sessionId: string;
        artifactPath: string;
    }>;
    installArtifactToSandbox(
        artifactPath: string,
        sandboxId?: string,
    ): Promise<{
        sessionId: string;
        artifactPath: string;
    }>;
    resolveInstallArtifactPathForActiveSession(): Promise<string>;
    evaluatePackagingHealthGateForActiveSession(): Promise<PackagingHealthGateResult>;
    enforcePackagingHealthGateForActiveSession(): Promise<PackagingHealthGateResult>;
    clearActiveOnboardingSession(): Promise<void>;
    getActiveOnboardingSession(): Promise<OnboardingState>;
    runPhaseOnActiveSession(
        phase: OnboardingPhaseName,
        inputs?: unknown,
    ): Promise<OnboardingState>;
    getDefaultInputsForPhaseOnActiveSession(
        phase: OnboardingPhaseName,
    ): Promise<unknown>;
    getPhaseStatusOnActiveSession(
        phase: OnboardingPhaseName,
    ): Promise<PhaseStatus>;
    listStalePhasesOnActiveSession(): Promise<OnboardingPhaseName[]>;
    runRemainingPhasesOnActiveSession(): Promise<{
        state: OnboardingState;
        completedPhases: OnboardingPhaseName[];
    }>;
    rerunPhasesOnActiveSession(phases: OnboardingPhaseName[]): Promise<{
        state: OnboardingState;
        rerunPhases: OnboardingPhaseName[];
    }>;
    restorePhaseOnActiveSession(
        phase: OnboardingPhaseName,
    ): Promise<RestorePhaseResult>;
    checkPackagingHealthGate(
        artifactPath: string,
    ): Promise<PackagingHealthGateResult>;
    listPhases(): readonly OnboardingPhaseName[];
    routeConversation(prompt: string): {
        target: "onboarding" | "schemaAuthor";
        reason: string;
    };
    listSandboxes(): Promise<SandboxStatus[]>;
    /**
     * Agents available to load (name + manifest emoji when known). Discovered
     * by scanning the configured agent roots (`packages/agents` plus any
     * `agentSearchPaths`) for directories declaring the dispatcher
     * `./agent/manifest` export. Used to offer autocomplete in the Load agent UI.
     */
    listAvailableAgents(): Promise<AvailableAgent[]>;
    /**
     * The directories Studio scans for agents (`packages/agents` plus any
     * configured `agentSearchPaths`), each with whether it exists and how many
     * agent packages it contains. Read-only. (Studio Inspect surface.)
     */
    getAgentLocations(): Promise<AgentLocation[]>;
    startSandbox(options?: {
        id?: string;
        agents?: string[];
    }): Promise<SandboxStatus>;
    stopSandbox(id: string): Promise<void>;
    restartSandbox(id: string): Promise<void>;
    /**
     * Load an agent into a running sandbox. `agentRef` is a path or module
     * reference; the loader derives the agent name. Returns the updated status.
     */
    loadSandboxAgent(id: string, agentRef: string): Promise<SandboxStatus>;
    /** Unload a named agent from a sandbox. Returns the updated status. */
    unloadSandboxAgent(id: string, agentName: string): Promise<SandboxStatus>;
    /**
     * Re-load a named agent in every sandbox where it is currently loaded,
     * recomputing its health and schema/grammar hashes from disk. Used after
     * building an agent's grammar so the (cached) health badge refreshes
     * without a manual sandbox restart. Returns the number of sandboxes
     * refreshed.
     */
    refreshSandboxAgent(agentName: string): Promise<number>;
    /**
     * Subscribe to sandbox lifecycle changes (start/stop/restart, agent
     * load/unload). The listener is invoked after each such event so a UI can
     * refresh. Returns a disposable to stop listening.
     */
    onSandboxChanged(listener: () => void): { dispose(): void };
    /**
     * Agents that currently have a federated corpus view, derived from the
     * union of agents loaded across running sandboxes.
     */
    listCorpusAgents(): Promise<string[]>;
    /**
     * Whether wildcard validation can actually run for `agent` in replay — the
     * agent loads and exposes a `validateWildcardMatch`. Lets the Impact Report
     * disable its validation toggle when there is nothing to run.
     */
    canValidateWildcards(agent: string): Promise<boolean>;
    /** Federated corpus entries for an agent (in-repo, captures, external, feedback). */
    listCorpusEntries(agent: string): Promise<CorpusEntry[]>;
    /**
     * Register an external JSONL corpus source for an agent (writes
     * `<repoRoot>/.typeagent/studio.json`). Throws if a source with the same
     * name already exists for the agent.
     */
    addExternalCorpusSource(spec: ExternalSourceSpec): Promise<void>;
    /**
     * Ensure an agent's in-repo corpus file exists so it can be populated.
     * Returns its path and whether it was newly created.
     */
    seedInRepoCorpus(
        agent: string,
    ): Promise<{ path: string; created: boolean }>;
    /**
     * Import one or more `displayLog.json` files into the shared in-repo
     * corpus. Buckets per agent, dedupes by logical id (in-batch and against
     * existing entries), and writes once per agent. Returns counts
     * written/skipped per agent and the files that were read.
     */
    importCorpusFromLogs(
        request: StudioCorpusImportRequest,
    ): Promise<StudioCorpusImportResult>;
    /** Most recent events from the structured event stream, oldest-first. */
    queryRecentEvents(limit?: number): Promise<StudioEvent[]>;
    /** Subscribe to every event as it is emitted. Returns a disposable. */
    onAnyEvent(listener: (event: StudioEvent) => void): { dispose(): void };
    /**
     * Record a thumbs-up/down feedback row. Emits a `feedback.recorded` event
     * and (when an utterance is supplied) surfaces the row in the agent's
     * federated corpus under the `feedback` source.
     */
    recordFeedback(input: FeedbackRecordInput): Promise<void>;
    /** List recorded feedback rows, optionally filtered. */
    listFeedback(filter?: FeedbackFilter): Promise<FeedbackRow[]>;
    /**
     * Replay an agent's corpus through the compare engine, evaluating each
     * utterance against versions A and B. Emits `replay.row`/`replay.summary`
     * events (visible in the Event Log) and resolves with the collected rows
     * and summary.
     */
    replayCorpus(request: StudioReplayRequest): Promise<StudioReplayResult>;
    /**
     * Report a detected schema/grammar collision. Stores it and emits a
     * `collision.detected` event (visible in the Event Log and the Collisions
     * view). Returns the stored event.
     */
    reportCollision(event: CollisionDetectedEvent): CollisionDetectedEvent;
    /** List stored collisions, newest-first, optionally filtered. */
    listCollisions(filter?: CollisionFilter): Promise<CollisionDetectedEvent[]>;
    /** Remove stored collisions matching the filter (all when omitted). */
    clearCollisions(filter?: CollisionFilter): Promise<number>;
    /** Subscribe to collision detections as they are emitted. */
    onCollisionDetected(listener: () => void): { dispose(): void };
    /**
     * Subscribe to agent load/unload events across sandboxes. Used to keep the
     * Collisions view current by re-scanning when the loaded agent set changes.
     */
    onAgentLoadChanged(listener: () => void): { dispose(): void };
    /**
     * Scan agents' compiled grammars for real cross-schema collisions via the
     * NFA overlap engine, reporting each into the collision store (and Event
     * Log). Replaces prior `grammar-edit` collisions unless `replace` is false.
     */
    scanGrammarCollisions(
        request?: StudioCollisionScanRequest,
    ): Promise<StudioCollisionScanResult>;
    /**
     * Re-create sandboxes (and their agent loadouts) from the workspace-scoped
     * persisted snapshot written on every sandbox mutation. Safe to call
     * multiple times — sandboxes that already exist are skipped, and per-
     * sandbox restore failures are isolated so one bad entry can't block the
     * rest. Intended to be invoked once at extension activation.
     */
    restoreSandboxes(): Promise<void>;
}

export interface StudioWorkspaceState {
    get<T>(key: string): T | undefined;
    update(key: string, value: unknown): Promise<void>;
}

export interface StudioRuntimeContext {
    workspaceState: StudioWorkspaceState;
    globalStorageFsPath: string;
    workspaceFolderFsPaths?: string[];
    /**
     * Additional directories that contain agent subdirectories (peer to
     * `packages/agents`), from the `typeagentStudio.agentSearchPaths` setting.
     * Relative entries are resolved against the detected repo root. The repo's
     * own `packages/agents` is always included as the first root. May be a
     * provider, read fresh on each use, so a changed setting is picked up
     * without recreating the runtime.
     */
    agentSearchPaths?: string[] | (() => string[]);
}

export interface CreateStudioRuntimeOptions {
    onboarding?: InMemoryOnboardingBridge;
    sandbox?: SandboxManager;
    corpus?: CorpusService;
    feedback?: FeedbackService & FeedbackCorpusProjector;
    /**
     * Resolver that evaluates one utterance against one agent version. Injected
     * so a real per-version build/dispatch can replace the default, which does a
     * deterministic identity replay over each entry's captured `expectedAction`.
     */
    replayResolver?: ReplayActionResolver;
    /**
     * Resolves the live construction-cache layer for the working-tree side of a
     * replay. Injected so tests can exercise the mode gating (the default
     * discovers the dispatcher's live cache from the instance dir, which a test
     * can't fabricate). Only consulted in `completionBased-cache` mode.
     */
    resolveConstructionCache?: (
        target: GrammarReplayTarget,
    ) => Promise<ConstructionCacheLayer | undefined>;
    /**
     * Builds the agent's wildcard-match validator for an opt-in
     * (`validateWildcards`) replay run. Returns `undefined` when the host can't
     * validate this agent (e.g. the agent's manifest doesn't declare it
     * replay-safe, or no agent loader is available), in which case replay stays
     * grammar-only. Injected because the production loader pulls the
     * dispatcher's agent providers, which live outside this dependency-light
     * package; tests inject a fake-loader-backed validator. The runtime disposes
     * the returned validator at run end.
     */
    resolveWildcardValidator?: (
        agentName: string,
    ) =>
        | WildcardMatchValidator
        | undefined
        | Promise<WildcardMatchValidator | undefined>;
    /**
     * Reports whether wildcard validation can run for an agent — it loads and
     * exposes a `validateWildcardMatch` — so `canValidateWildcards` can answer
     * the Impact Report before a run. Injected for the same reason as
     * `resolveWildcardValidator`: loading agent modules lives outside this
     * dependency-light package. Absent ⇒ no agent is treated as validatable.
     */
    resolveCanValidateWildcards?: (agentName: string) => Promise<boolean>;
    collisions?: CollisionService;
    /**
     * Scans agents' compiled grammars for collisions. Injected so tests can
     * substitute a deterministic stub for the default filesystem/NFA scanner.
     */
    collisionScanner?: GrammarCollisionScanner;
    evaluatePackagingHealthGate?: (
        artifactPath: string,
    ) => Promise<PackagingHealthGateResult>;
}

/** Deterministic default resolver: surfaces each entry's captured
 *  `expectedAction` (and feedback) identically for both versions, so an
 *  un-parameterized replay reports an all-equal baseline. */
const identityReplayResolver: ReplayActionResolver = {
    resolve(entry): ReplayAgentResolution {
        if (entry.expectedAction !== undefined) {
            return {
                action: entry.expectedAction,
                cacheState: "hit",
                ...(entry.feedback !== undefined
                    ? { feedback: entry.feedback }
                    : {}),
            };
        }
        return {
            cacheState: "needs-explanation",
            ...(entry.feedback !== undefined
                ? { feedback: entry.feedback }
                : {}),
        };
    },
};

/** Build an aborted replay result (empty summary + run-level error) for when a
 *  version fails to build, so the engine never runs and no fake rows are emitted. */
function abortedReplayResult(
    options: Parameters<typeof replayCorpus>[0],
    error: ReplayRunError,
    method: StudioReplayMethod = "static-grammar",
    mode: StudioReplayMode = "nfa-grammar",
    validateWildcards = false,
): StudioReplayResult {
    const runId = `replay-error-${Date.now().toString(36)}`;
    return {
        runId,
        rows: [],
        error,
        // A version-build failure only happens on the grammar path. We never got
        // to run either side, so report the same method for both.
        method,
        methodA: method,
        methodB: method,
        sideFidelity: deriveSideFidelity({
            versionA: options.versionA,
            versionB: options.versionB,
            methodA: method,
            methodB: method,
            mode,
            validateWildcards,
        }),
        summary: {
            runId,
            agent: options.agent,
            versionA: options.versionA,
            versionB: options.versionB,
            corpusSize: 0,
            rowCount: 0,
            equalCount: 0,
            changedCount: 0,
            newMatchCount: 0,
            lostMatchCount: 0,
            collisionDelta: 0,
            duration: 0,
            missPolicy: options.missPolicy,
        },
    };
}

/** The most faithful method any side actually used, so a run-level chip never
 *  claims a cache neither side consulted. */
function rollupReplayMethod(
    methodA: StudioReplayMethod,
    methodB: StudioReplayMethod,
): StudioReplayMethod {
    if (methodA === "construction-cache" || methodB === "construction-cache") {
        return "construction-cache";
    }
    if (methodA === "schema-grammar" || methodB === "schema-grammar") {
        return "schema-grammar";
    }
    return "static-grammar";
}

/** How a grammar-resolved side reports its method. The construction cache is
 *  live-only, so it counts only when `cacheApplies` (the working-tree side) and
 *  the cache is hash-valid; otherwise the (enriched) grammar decides. */
function grammarMethodFor(
    grammarResolver: GrammarReplayResolver,
    cacheApplies: boolean,
): StudioReplayMethod {
    if (cacheApplies && grammarResolver.constructionCacheStatus === "valid") {
        return "construction-cache";
    }
    return grammarResolver.enriched ? "schema-grammar" : "static-grammar";
}

/** How `replayCorpus` resolves actions for a run: the chosen resolver, the
 *  per-side + run-level methods, and the opt-in wildcard validator (kept so its
 *  diagnostics can be read and the agent unloaded). `aborted` is set instead
 *  when a version failed to build, so the caller returns it without running. */
interface ReplayResolution {
    resolver: ReplayActionResolver | undefined;
    method: StudioReplayMethod;
    methodA: StudioReplayMethod;
    methodB: StudioReplayMethod;
    wildcardValidator: WildcardMatchValidator | undefined;
    activeGrammarResolver: GrammarReplayResolver | undefined;
    aborted?: StudioReplayResult;
}

export function createStudioRuntimeCore(
    context: StudioRuntimeContext,
    options: CreateStudioRuntimeOptions = {},
): StudioRuntime {
    const events = new InProcessEventStream();
    const repoRootResolution = resolveRepoRoot(
        context.workspaceFolderFsPaths ?? [],
        context.globalStorageFsPath,
    );
    const repoRoot = repoRootResolution.repoRoot;
    // Agent roots, resolved fresh on each use so a changed
    // `agentSearchPaths` setting is picked up without reconstructing the
    // runtime: the repo's own packages/agents first, then any configured
    // search paths (relative entries resolved against the repo root).
    const agentRoots = (): string[] => {
        const configured =
            typeof context.agentSearchPaths === "function"
                ? context.agentSearchPaths()
                : (context.agentSearchPaths ?? []);
        return [
            path.join(repoRoot, "packages", "agents"),
            ...configured.map((p) =>
                path.isAbsolute(p) ? p : path.join(repoRoot, p),
            ),
        ];
    };
    const sandbox =
        options.sandbox ??
        new InMemorySandboxManager({
            emitter: events,
            agentLoader: createRepoAgentLoader({ repoRoot, agentRoots }),
        });
    const onboarding = options.onboarding ?? new InMemoryOnboardingBridge();
    const evaluatePackagingHealthGate =
        options.evaluatePackagingHealthGate ??
        defaultEvaluatePackagingHealthGate;

    const profileDir = path.join(
        context.globalStorageFsPath,
        "profiles",
        DEFAULT_SANDBOX_ID,
    );

    const feedback =
        options.feedback ??
        new CoreFeedbackService({
            backend: new InMemoryFeedbackBackend(),
            emitter: events,
        });

    const corpus =
        options.corpus ??
        new FileCorpusService({
            repoRoot,
            profileDir: path.join(context.globalStorageFsPath, "corpus"),
            feedbackProvider: (agent) => feedback.toCorpusEntries(agent),
        });

    const collisions =
        options.collisions ??
        new InProcessCollisionService({
            emitter: events,
            defaultSandboxId: DEFAULT_SANDBOX_ID,
        });

    const collisionScanner =
        options.collisionScanner ??
        createRepoGrammarScanner({ repoRoot, agentRoots });

    // Persistence for sandbox lifecycle. The in-memory sandbox manager has no
    // durable storage of its own, so the studio runtime snapshots the live
    // sandbox set into workspaceState after every mutation and replays it on
    // demand via `restoreSandboxes()` (called once at activation).
    let restoring = false;
    const persistSandboxes = async (): Promise<void> => {
        if (restoring) {
            return;
        }
        const snapshot: PersistedSandbox[] = (await sandbox.list()).map(
            (status) => ({
                id: status.id,
                agents: status.agents.map((a) => a.sourcePath ?? a.name),
            }),
        );
        await context.workspaceState.update(PERSISTED_SANDBOXES_KEY, snapshot);
    };

    // Resolve actions for real via static grammar matching when no resolver is
    // injected, the deterministic `needs-explanation` policy is in effect, a repo
    // root is known, and the agent has a single standalone-compilable grammar.
    // Otherwise fall back to the identity resolver (the all-equal baseline tests
    // rely on).
    const resolveReplayActions = async (
        replayOptions: Parameters<typeof replayCorpus>[0],
        request: StudioReplayRequest,
        mode: StudioReplayMode,
    ): Promise<ReplayResolution> => {
        const resolution: ReplayResolution = {
            resolver: options.replayResolver,
            method: "identity",
            methodA: "identity",
            methodB: "identity",
            wildcardValidator: undefined,
            activeGrammarResolver: undefined,
        };
        if (
            resolution.resolver !== undefined ||
            replayOptions.missPolicy !== "needs-explanation" ||
            repoRoot === undefined
        ) {
            return resolution;
        }
        const target = await resolveGrammarReplayTarget(
            agentRoots(),
            replayOptions.agent,
            repoRoot,
        );
        if (target === undefined) {
            return resolution;
        }

        // Best-effort consult of the agent's live per-session construction cache
        // for the working-tree side — but ONLY in `completionBased-cache` mode. In
        // the default `nfa-grammar` mode the dispatcher does not consult the cache
        // (grammar rules alone decide the match), so replay stays grammar-only and
        // A/B-symmetric. Hash-gated to the current schema exactly as the dispatcher
        // gates it, so a schema edit invalidates the cached constructions (→ stale
        // → grammar fallback) rather than reporting a phantom cache hit.
        const constructionCache =
            mode === "completionBased-cache"
                ? await (
                      options.resolveConstructionCache ??
                      resolveConstructionCacheLayer
                  )(target)
                : undefined;

        // Opt-in: build the agent's wildcard validator so the working-tree side
        // runs the dispatcher's real post-match `validateWildcardMatch`.
        // `undefined` when the host has no loader or the agent doesn't opt in —
        // replay then stays grammar-only (a silent no-op, not an error).
        const wildcardValidator =
            request.validateWildcards === true
                ? await options.resolveWildcardValidator?.(replayOptions.agent)
                : undefined;
        resolution.wildcardValidator = wildcardValidator;

        const grammarResolver = createGrammarReplayResolver({
            target,
            repoRoot,
            ...(constructionCache !== undefined ? { constructionCache } : {}),
            ...(wildcardValidator !== undefined ? { wildcardValidator } : {}),
        });
        resolution.activeGrammarResolver = grammarResolver;

        try {
            // Build both versions up front so a build failure aborts the run
            // cleanly instead of throwing mid-stream (which would hang the
            // engine's row channel).
            await grammarResolver.prepare(
                replayOptions.versionA,
                replayOptions.versionB,
            );
            resolution.resolver = grammarResolver;
            resolution.methodA = grammarMethodFor(
                grammarResolver,
                replayOptions.versionA.kind === "workingTree",
            );
            resolution.methodB = grammarMethodFor(
                grammarResolver,
                replayOptions.versionB.kind === "workingTree",
            );
            resolution.method = rollupReplayMethod(
                resolution.methodA,
                resolution.methodB,
            );
        } catch (err) {
            await wildcardValidator?.dispose();
            if (err instanceof ReplayVersionBuildError) {
                resolution.aborted = abortedReplayResult(
                    replayOptions,
                    {
                        kind: "version-build-failed",
                        side: err.side,
                        ref:
                            err.version.kind === "git"
                                ? err.version.ref
                                : "workingTree",
                        message: err.message,
                    },
                    grammarMethodFor(grammarResolver, true),
                    mode,
                    request.validateWildcards === true,
                );
                return resolution;
            }
            throw err;
        }
        return resolution;
    };

    return {
        getRepoRootInfo() {
            return repoRootResolution;
        },
        async startOnboarding(seed) {
            const state = await onboarding.start(seed);
            await context.workspaceState.update(
                LAST_ONBOARDING_SESSION_KEY,
                state.sessionId,
            );
            return state;
        },
        async installLastSessionToSandbox(
            sandboxId = DEFAULT_SANDBOX_ID,
            installOptions = {},
        ) {
            const sessionId = getRequiredSessionId(context);
            const artifactPath = await resolveArtifactPathForSession(
                onboarding,
                sessionId,
                context,
            );

            if (!installOptions.skipHealthGate) {
                const gate = await evaluatePackagingHealthGate(artifactPath);
                if (gate.status === "fail") {
                    throw new Error(`Health gate failed: ${gate.summary}`);
                }
            }

            return installResolvedArtifact(
                sandbox,
                onboarding,
                sessionId,
                sandboxId,
                profileDir,
                artifactPath,
            );
        },
        async installArtifactToSandbox(
            artifactPath,
            sandboxId = DEFAULT_SANDBOX_ID,
        ) {
            const sessionId = getRequiredSessionId(context);
            if (!(await pathExists(artifactPath))) {
                throw new Error(
                    `Artifact path does not exist: ${artifactPath}`,
                );
            }

            return installResolvedArtifact(
                sandbox,
                onboarding,
                sessionId,
                sandboxId,
                profileDir,
                artifactPath,
            );
        },
        async resolveInstallArtifactPathForActiveSession() {
            const sessionId = getRequiredSessionId(context);
            return resolveArtifactPathForSession(
                onboarding,
                sessionId,
                context,
            );
        },
        async evaluatePackagingHealthGateForActiveSession() {
            const artifactPath =
                await this.resolveInstallArtifactPathForActiveSession();
            return evaluatePackagingHealthGate(artifactPath);
        },
        async enforcePackagingHealthGateForActiveSession() {
            const gate =
                await this.evaluatePackagingHealthGateForActiveSession();
            if (gate.status === "fail") {
                throw new Error(`Health gate failed: ${gate.summary}`);
            }
            return gate;
        },
        async clearActiveOnboardingSession() {
            await context.workspaceState.update(
                LAST_ONBOARDING_SESSION_KEY,
                undefined,
            );
        },
        async getActiveOnboardingSession() {
            const sessionId = getRequiredSessionId(context);
            return onboarding.snapshot(sessionId);
        },
        async runPhaseOnActiveSession(phase, inputs = {}) {
            const sessionId = getRequiredSessionId(context);
            await onboarding.runPhase(sessionId, phase, inputs);
            return onboarding.snapshot(sessionId);
        },
        async getDefaultInputsForPhaseOnActiveSession(phase) {
            const sessionId = getRequiredSessionId(context);
            const state = await onboarding.snapshot(sessionId);
            return getDefaultPhaseInputs(state, phase);
        },
        async getPhaseStatusOnActiveSession(phase) {
            const sessionId = getRequiredSessionId(context);
            const state = await onboarding.snapshot(sessionId);
            return state.phases[phase]?.status ?? "pending";
        },
        async listStalePhasesOnActiveSession() {
            const sessionId = getRequiredSessionId(context);
            const state = await onboarding.snapshot(sessionId);
            return ONBOARDING_PHASE_ORDER.filter(
                (phase) => state.phases[phase]?.status === "stale",
            );
        },
        async runRemainingPhasesOnActiveSession() {
            const sessionId = getRequiredSessionId(context);
            let state = await onboarding.snapshot(sessionId);
            const completedPhases: OnboardingPhaseName[] = [];

            for (const phase of ONBOARDING_PHASE_ORDER) {
                const existing = state.phases[phase];
                if (existing?.status === "complete") {
                    continue;
                }

                await onboarding.runPhase(
                    sessionId,
                    phase,
                    getDefaultPhaseInputs(state, phase),
                );
                completedPhases.push(phase);
                state = await onboarding.snapshot(sessionId);
            }

            return {
                state,
                completedPhases,
            };
        },
        async rerunPhasesOnActiveSession(phases) {
            const sessionId = getRequiredSessionId(context);
            let state = await onboarding.snapshot(sessionId);
            const rerunPhases: OnboardingPhaseName[] = [];
            const normalizedPhases = ONBOARDING_PHASE_ORDER.filter((phase) =>
                phases.includes(phase),
            );

            for (const phase of normalizedPhases) {
                await onboarding.runPhase(
                    sessionId,
                    phase,
                    getDefaultPhaseInputs(state, phase),
                );
                rerunPhases.push(phase);
                state = await onboarding.snapshot(sessionId);
            }

            return {
                state,
                rerunPhases,
            };
        },
        async restorePhaseOnActiveSession(phase) {
            const sessionId = getRequiredSessionId(context);
            return onboarding.restorePhase(sessionId, phase);
        },
        async checkPackagingHealthGate(artifactPath) {
            return evaluatePackagingHealthGate(artifactPath);
        },
        listPhases() {
            return ONBOARDING_PHASE_ORDER;
        },
        routeConversation(prompt) {
            const routed = routeStudioConversation(prompt);
            return {
                target: routed.target,
                reason: routed.reason,
            };
        },
        async listSandboxes() {
            return sandbox.list();
        },
        async listAvailableAgents() {
            return listAvailableAgentNames(agentRoots());
        },
        async getAgentLocations() {
            // The repo's own `packages/agents` is always the first root; any
            // others come from the `agentSearchPaths` setting and are external.
            const repoAgentsRoot = path.join(repoRoot, "packages", "agents");
            return Promise.all(
                agentRoots().map(async (root) => {
                    const external = root !== repoAgentsRoot;
                    const agentCount = await countAgentsInRoot(root);
                    return agentCount === undefined
                        ? { root, exists: false, agentCount: 0, external }
                        : { root, exists: true, agentCount, external };
                }),
            );
        },
        async startSandbox(startOptions = {}) {
            // Title-bar "Start sandbox" passes no id; mint a unique one so
            // multiple sandboxes can coexist (the default id is reused only
            // when it's free, keeping install commands' default stable).
            const id = startOptions.id ?? (await nextSandboxId(sandbox));
            await sandbox.start({
                id,
                mode: "inmemory",
                profileDir: path.join(
                    context.globalStorageFsPath,
                    "profiles",
                    id,
                ),
                agents: startOptions.agents ?? [],
            });
            await persistSandboxes();
            return sandbox.status(id);
        },
        async stopSandbox(id) {
            await sandbox.stop(id);
            await persistSandboxes();
        },
        async restartSandbox(id) {
            await sandbox.restart(id);
            await persistSandboxes();
        },
        async loadSandboxAgent(id, agentRef) {
            await sandbox.loadAgent(id, agentRef);
            await persistSandboxes();
            return sandbox.status(id);
        },
        async unloadSandboxAgent(id, agentName) {
            await sandbox.unloadAgent(id, agentName);
            await persistSandboxes();
            return sandbox.status(id);
        },
        async refreshSandboxAgent(agentName) {
            let refreshed = 0;
            for (const status of await sandbox.list()) {
                const loaded = status.agents.find((a) => a.name === agentName);
                if (loaded !== undefined) {
                    // Re-running loadAgent re-invokes the loader, recomputing
                    // health/hashes and emitting `sandbox.agent.loaded` (which
                    // refreshes the trees, status bar, and collision auto-scan).
                    await sandbox.loadAgent(
                        status.id,
                        loaded.sourcePath ?? loaded.name,
                    );
                    refreshed += 1;
                }
            }
            return refreshed;
        },
        onSandboxChanged(listener) {
            const subscription = events.subscribe(() => listener(), {
                filter: { types: SANDBOX_LIFECYCLE_EVENT_TYPES },
            });
            return { dispose: () => subscription.unsubscribe() };
        },
        async listCorpusAgents() {
            const sandboxes = await sandbox.list();
            const agents = new Set<string>();
            for (const status of sandboxes) {
                for (const agent of status.agents) {
                    agents.add(agent.name);
                }
            }
            return [...agents].sort((a, b) => a.localeCompare(b));
        },
        async canValidateWildcards(agent) {
            return (
                (await options.resolveCanValidateWildcards?.(agent)) === true
            );
        },
        async listCorpusEntries(agent) {
            return corpus.list(agent);
        },
        async addExternalCorpusSource(spec) {
            await corpus.addExternalSource(spec);
        },
        async seedInRepoCorpus(agent) {
            return corpus.seedInRepoCorpus(agent);
        },
        async importCorpusFromLogs(request) {
            return importDisplayLogs(corpus, request.paths, {
                target: "in-repo",
                ...(request.agents !== undefined
                    ? { agents: request.agents }
                    : {}),
                ...(request.sessionId !== undefined
                    ? { sessionId: request.sessionId }
                    : {}),
            });
        },
        async queryRecentEvents(limit = 200) {
            const all: StudioEvent[] = [];
            for await (const event of events.query()) {
                all.push(event);
            }
            return all.slice(-limit);
        },
        onAnyEvent(listener) {
            const subscription = events.subscribe(listener);
            return { dispose: () => subscription.unsubscribe() };
        },
        async recordFeedback(input) {
            await feedback.record(input);
        },
        async listFeedback(filter) {
            return feedback.list(filter);
        },
        async replayCorpus(request) {
            const mode: StudioReplayMode = request.mode ?? "nfa-grammar";
            const replayOptions = {
                agent: request.agent,
                corpus: request.corpus ?? {},
                versionA: request.versionA ?? { kind: "workingTree" },
                versionB: request.versionB ?? { kind: "workingTree" },
                missPolicy: request.missPolicy ?? "needs-explanation",
            } satisfies Parameters<typeof replayCorpus>[0];

            const resolution = await resolveReplayActions(
                replayOptions,
                request,
                mode,
            );
            if (resolution.aborted !== undefined) {
                return resolution.aborted;
            }
            const { method, methodA, methodB, wildcardValidator } = resolution;

            const handle = replayCorpus(replayOptions, {
                corpus: { list: (agent, filter) => corpus.list(agent, filter) },
                resolver: resolution.resolver ?? identityReplayResolver,
                emitter: events,
            });

            const rows: ActionDelta[] = [];
            try {
                for await (const row of handle.rows) {
                    rows.push(row);
                }
            } finally {
                await wildcardValidator?.dispose();
            }
            const summary = await handle.summary;
            // Surface the wildcard-validation pass only when it actually ran on a
            // wildcard match (so a run that never hit a wildcard doesn't claim a
            // validation it never performed).
            const wildcardValidation: StudioWildcardValidationInfo | undefined =
                resolution.activeGrammarResolver?.wildcardValidationApplied ===
                true
                    ? {
                          applied: true,
                          diagnostics: [
                              ...(wildcardValidator?.diagnostics ?? []),
                          ],
                      }
                    : undefined;
            return {
                runId: handle.runId,
                summary,
                rows,
                method,
                methodA,
                methodB,
                sideFidelity: deriveSideFidelity({
                    versionA: replayOptions.versionA,
                    versionB: replayOptions.versionB,
                    methodA,
                    methodB,
                    mode,
                    validateWildcards: request.validateWildcards === true,
                    ...(wildcardValidation !== undefined
                        ? { wildcardValidation }
                        : {}),
                }),
                ...(wildcardValidation !== undefined
                    ? { wildcardValidation }
                    : {}),
            };
        },
        reportCollision(event) {
            return collisions.report(event);
        },
        async listCollisions(filter) {
            return collisions
                .list(filter)
                .slice()
                .sort((a, b) => b.ts - a.ts);
        },
        async clearCollisions(filter) {
            return collisions.clear(filter);
        },
        onCollisionDetected(listener) {
            const subscription = events.subscribe(() => listener(), {
                filter: { types: ["collision.detected"] },
            });
            return { dispose: () => subscription.unsubscribe() };
        },
        onAgentLoadChanged(listener) {
            const subscription = events.subscribe(() => listener(), {
                filter: {
                    types: ["sandbox.agent.loaded", "sandbox.agent.unloaded"],
                },
            });
            return { dispose: () => subscription.unsubscribe() };
        },
        async scanGrammarCollisions(request = {}) {
            const sandboxId = request.sandboxId ?? DEFAULT_SANDBOX_ID;
            let agents = request.agents;
            if (agents === undefined) {
                const loaded = new Set<string>();
                for (const status of await sandbox.list()) {
                    for (const agent of status.agents) {
                        loaded.add(agent.name);
                    }
                }
                agents = [...loaded].sort((a, b) => a.localeCompare(b));
            }

            const report = await collisionScanner({ agents });

            if (request.replace !== false) {
                collisions.clear({ detectionPoint: "grammar-edit" });
            }
            for (const collision of report.collisions) {
                collisions.fromGrammarTools(collision, {
                    sandboxId,
                    detectionPoint: "grammar-edit",
                });
            }

            return {
                scanned: report.scanned,
                skipped: report.skipped,
                collisionCount: report.collisions.length,
            };
        },
        async restoreSandboxes() {
            const snapshot =
                context.workspaceState.get<PersistedSandbox[]>(
                    PERSISTED_SANDBOXES_KEY,
                ) ?? [];
            if (snapshot.length === 0) {
                return;
            }
            // Don't write back to workspaceState while we replay; each call
            // to `start()` / `loadAgent()` would otherwise trigger persist
            // and clobber sandboxes we haven't yet restored.
            restoring = true;
            try {
                const existing = new Set(
                    (await sandbox.list()).map((s) => s.id),
                );
                // Restore sandboxes in parallel; they're independent, so this
                // avoids serializing agent loads at startup. Each entry isolates
                // its own failure so one bad sandbox can't block the rest.
                await Promise.all(
                    snapshot
                        .filter((entry) => !existing.has(entry.id))
                        .map(async (entry) => {
                            try {
                                await sandbox.start({
                                    id: entry.id,
                                    mode: "inmemory",
                                    profileDir: path.join(
                                        context.globalStorageFsPath,
                                        "profiles",
                                        entry.id,
                                    ),
                                    agents: entry.agents,
                                });
                            } catch (err) {
                                // One sandbox failing to restore (e.g. an agent
                                // that no longer resolves) shouldn't block the
                                // rest. Log to the extension host console; the
                                // surviving sandboxes still come back.

                                console.warn(
                                    `[typeagent-studio] Failed to restore sandbox '${entry.id}':`,
                                    err,
                                );
                            }
                        }),
                );
            } finally {
                restoring = false;
            }
            // Re-snapshot to drop any sandboxes that failed to come back.
            await persistSandboxes();
        },
    };
}

async function resolveArtifactPathForSession(
    onboarding: InMemoryOnboardingBridge,
    sessionId: string,
    context: StudioRuntimeContext,
): Promise<string> {
    const session = await onboarding.snapshot(sessionId);
    return resolveLocalArtifactPath(session, context);
}

async function defaultEvaluatePackagingHealthGate(
    artifactPath: string,
): Promise<PackagingHealthGateResult> {
    const resolved = path.resolve(artifactPath);
    const inferred = inferRepoRootAndAgent(resolved);
    if (!inferred) {
        return {
            status: "unavailable",
            summary:
                "Could not infer repo root + agent from artifact path; health gate check skipped.",
            findings: [],
            artifactPath: resolved,
        };
    }

    const service = new FileHealthService({ repoRoot: inferred.repoRoot });
    const findings = await service.check(inferred.agent);
    const errors = findings.filter((f) => f.severity === "error").length;
    const warnings = findings.filter((f) => f.severity === "warning").length;

    if (errors > 0) {
        return {
            status: "fail",
            summary: `${errors} error findings and ${warnings} warning findings for agent ${inferred.agent}.`,
            findings,
            artifactPath: resolved,
            checkedAgent: inferred.agent,
        };
    }
    if (warnings > 0) {
        return {
            status: "warn",
            summary: `${warnings} warning findings for agent ${inferred.agent}.`,
            findings,
            artifactPath: resolved,
            checkedAgent: inferred.agent,
        };
    }

    return {
        status: "pass",
        summary: `Health gate passed for agent ${inferred.agent}.`,
        findings,
        artifactPath: resolved,
        checkedAgent: inferred.agent,
    };
}

function inferRepoRootAndAgent(
    artifactPath: string,
): { repoRoot: string; agent: string } | undefined {
    const normalized = path.normalize(artifactPath);
    const parts = normalized.split(path.sep);
    const packagesIndex = parts.lastIndexOf("packages");
    if (packagesIndex < 0 || parts[packagesIndex + 1] !== "agents") {
        return undefined;
    }
    const agent = parts[packagesIndex + 2];
    if (!agent) {
        return undefined;
    }
    const repoRoot = parts.slice(0, packagesIndex).join(path.sep) || path.sep;
    return { repoRoot, agent };
}

async function installResolvedArtifact(
    sandbox: SandboxManager,
    onboarding: InMemoryOnboardingBridge,
    sessionId: string,
    sandboxId: string,
    profileDir: string,
    artifactPath: string,
): Promise<{ sessionId: string; artifactPath: string }> {
    try {
        await sandbox.status(sandboxId);
    } catch {
        await sandbox.start({
            id: sandboxId,
            mode: "inmemory",
            profileDir,
            agents: [],
        });
    }

    await sandbox.loadAgent(sandboxId, artifactPath);
    await onboarding.installToSandbox(sessionId, sandboxId);
    return { sessionId, artifactPath };
}
const ONBOARDING_WORKSPACE_ROOT = path.join(
    os.homedir(),
    ".typeagent",
    "onboarding",
);

async function resolveLocalArtifactPath(
    state: OnboardingState,
    context: StudioRuntimeContext,
): Promise<string> {
    const candidates = collectArtifactCandidates(state, context);
    for (const candidate of candidates) {
        const resolved = await resolveCandidatePath(candidate);
        if (resolved && (await pathExists(resolved))) {
            return resolved;
        }
    }

    throw new Error(
        `No local generated agent artifact found for ${state.agentName}. Checked ${candidates.length} candidate paths.`,
    );
}

function collectArtifactCandidates(
    state: OnboardingState,
    context: StudioRuntimeContext,
): string[] {
    const out: string[] = [];
    const push = (value: string | undefined) => {
        const trimmed = value?.trim();
        if (trimmed) {
            out.push(trimmed);
        }
    };

    for (const phase of ["Packaging", "Scaffolder"] as const) {
        const outputs = state.phases[phase]?.outputs;
        if (outputs && typeof outputs === "object") {
            const obj = outputs as Record<string, unknown>;
            for (const key of [
                "artifactPath",
                "agentPath",
                "agentDir",
                "outputDir",
                "scaffoldedTo",
                "targetDir",
            ]) {
                const raw = obj[key];
                if (typeof raw === "string") {
                    push(raw);
                }
            }
        }
    }

    const onboardingScaffoldRecord = path.join(
        ONBOARDING_WORKSPACE_ROOT,
        state.agentName,
        "scaffolder",
        "scaffolded-to.txt",
    );
    push(onboardingScaffoldRecord);

    for (const root of context.workspaceFolderFsPaths ?? []) {
        push(path.join(root, "packages", "agents", state.agentName));
        push(
            path.join(
                root,
                "packages",
                "agents",
                state.agentName.toLowerCase(),
            ),
        );
        push(
            path.join(
                root,
                "packages",
                "agents",
                stripAgentSuffix(state.agentName),
            ),
        );
    }

    return dedupe(out);
}

function stripAgentSuffix(agentName: string): string {
    return agentName.endsWith("-agent")
        ? agentName.slice(0, -"-agent".length)
        : agentName;
}

/**
 * Discover agents available to load by scanning the configured agent roots
 * (`packages/agents` plus any `agentSearchPaths`) for directories whose
 * `package.json` declares the dispatcher `./agent/manifest` export. Each agent
 * carries its manifest emoji when one can be resolved from disk. Returns the
 * sorted, de-duplicated list; empty when nothing can be read. (Discovery is
 * filesystem-only; it does not consult the `defaultAgentProvider` registry.)
 */
async function listAvailableAgentNames(
    agentRoots: string[],
): Promise<AvailableAgent[]> {
    const emojiByName = await readAgentDirEmojis(agentRoots);
    return [...emojiByName.keys()]
        .sort((a, b) => a.localeCompare(b))
        .map((name) => {
            const emoji = emojiByName.get(name);
            return emoji !== undefined ? { name, emoji } : { name };
        });
}

/**
 * Count the agent packages in a single root (directories declaring the
 * dispatcher `./agent/manifest` export). Returns `undefined` when the root
 * doesn't exist / can't be read, so callers can distinguish "missing" from
 * "present but empty".
 */
async function countAgentsInRoot(root: string): Promise<number | undefined> {
    let entries;
    try {
        entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
        return undefined;
    }
    let count = 0;
    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === "dist") {
            continue;
        }
        try {
            const pkg = JSON.parse(
                await fs.readFile(
                    path.join(root, entry.name, "package.json"),
                    "utf8",
                ),
            ) as { exports?: Record<string, unknown> };
            if (resolveManifestExport(pkg.exports) !== undefined) {
                count++;
            }
        } catch {
            // not an agent package — skip
        }
    }
    return count;
}

/**
 * Map of agent directory name → manifest emoji, across all agent roots, for
 * directories declaring the dispatcher `./agent/manifest` export. The emoji is
 * undefined when the manifest has none (or can't be read). Earlier roots win on
 * name collisions (the repo's own `packages/agents` is first).
 */
async function readAgentDirEmojis(
    agentRoots: string[],
): Promise<Map<string, string | undefined>> {
    const result = new Map<string, string | undefined>();
    for (const agentsDir of agentRoots) {
        let entries;
        try {
            entries = await fs.readdir(agentsDir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (!entry.isDirectory() || entry.name === "dist") {
                continue;
            }
            if (result.has(entry.name)) {
                continue; // earlier root wins
            }
            const packageDir = path.join(agentsDir, entry.name);
            try {
                const pkg = JSON.parse(
                    await fs.readFile(
                        path.join(packageDir, "package.json"),
                        "utf8",
                    ),
                ) as { exports?: Record<string, unknown> };
                const manifestRef = resolveManifestExport(pkg.exports);
                if (manifestRef === undefined) {
                    continue; // not a loadable agent package
                }
                result.set(
                    entry.name,
                    await readManifestEmoji(packageDir, manifestRef),
                );
            } catch {
                // not an agent package (no/invalid package.json) — skip
            }
        }
    }
    return result;
}

/** Resolve the `./agent/manifest` export to a relative file path, if present. */
function resolveManifestExport(
    exports?: Record<string, unknown>,
): string | undefined {
    const entry = exports?.["./agent/manifest"];
    if (typeof entry === "string") {
        return entry;
    }
    if (entry && typeof entry === "object") {
        const cond = entry as Record<string, unknown>;
        for (const key of ["default", "import", "require"]) {
            if (typeof cond[key] === "string") {
                return cond[key] as string;
            }
        }
    }
    return undefined;
}

/** Read `emojiChar` from an agent manifest JSON referenced from its package. */
async function readManifestEmoji(
    packageDir: string,
    manifestRef: string,
): Promise<string | undefined> {
    try {
        const manifest = JSON.parse(
            await fs.readFile(path.join(packageDir, manifestRef), "utf8"),
        ) as { emojiChar?: unknown };
        return typeof manifest.emojiChar === "string"
            ? manifest.emojiChar
            : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Pick an unused sandbox id: the default id when free, otherwise
 * `<default>-2`, `<default>-3`, … so the "Start sandbox" action can create
 * multiple coexisting sandboxes.
 */
async function nextSandboxId(sandbox: SandboxManager): Promise<string> {
    const existing = new Set((await sandbox.list()).map((s) => s.id));
    if (!existing.has(DEFAULT_SANDBOX_ID)) {
        return DEFAULT_SANDBOX_ID;
    }
    let n = 2;
    while (existing.has(`${DEFAULT_SANDBOX_ID}-${n}`)) {
        n++;
    }
    return `${DEFAULT_SANDBOX_ID}-${n}`;
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.stat(filePath);
        return true;
    } catch {
        return false;
    }
}

async function resolveCandidatePath(
    candidate: string,
): Promise<string | undefined> {
    if (candidate.endsWith("scaffolded-to.txt")) {
        try {
            const txt = (await fs.readFile(candidate, "utf-8")).trim();
            return txt || undefined;
        } catch {
            return undefined;
        }
    }
    return candidate;
}

function dedupe(values: string[]): string[] {
    return [...new Set(values.map((v) => path.normalize(v)))];
}

function getRequiredSessionId(context: StudioRuntimeContext): string {
    const sessionId = context.workspaceState.get<string>(
        LAST_ONBOARDING_SESSION_KEY,
    );
    if (!sessionId) {
        throw new Error(
            "No onboarding session found. Start one first with 'TypeAgent Studio: Start onboarding session'.",
        );
    }
    return sessionId;
}

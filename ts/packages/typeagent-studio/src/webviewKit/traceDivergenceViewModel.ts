// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Browser-neutral view model for the Trace Viewer's divergence conclusion.
 *
 * Given a captured {@link ReplayResolutionTrace} for one utterance, this derives
 * the two things the viewer leads with:
 *
 *  - **Resolution parity** — whether the two sides produced the *same canonical
 *    final action*. This is the headline, and it is decided by comparing the
 *    actions themselves, never by comparing per-layer outcomes (two sides can
 *    both `hit` yet produce different actions, and a live-side cache hit vs a
 *    git-ref grammar match are different branches, not the same step).
 *  - **Cause attribution** — only when the actions differ, an ordered walk that
 *    names the first layer that explains the difference: a cache short-circuit,
 *    a different grammar rule, a wildcard-validation rejection, or an
 *    action-parameter difference under the same rule.
 *
 * Two guard rails come straight from how the trace is captured:
 *  - Capability asymmetry (a live-only layer that is `not-applicable` on a
 *    git-ref side) is never the headline. When the final actions match but the
 *    sides ran different fidelity paths, that is stated as a note, not a
 *    divergence.
 *  - When a grammar node's `rankingParity` is `diverged`, its captured recursive
 *    trace explains a *different* parse than the resolver's ranked pick, so the
 *    grammar level cannot be trusted to explain the difference. Attribution
 *    falls back to the action level and the conclusion is marked low-confidence.
 *
 * Everything here is a pure function of the trace DTO, so it unit-tests without a
 * webview and bundles into the browser client.
 */

import type {
    ReplayResolutionTrace,
    ReplaySideTrace,
    ReplayTraceNode,
    TraceRealization,
    CacheConsultTraceNode,
    GrammarMatchTraceNode,
    ActionTraceNode,
} from "@typeagent/core/replay";
import { stableStringify } from "./replayViewModel.js";

/** The four fidelity layers, in the order they run, for aligned rendering. */
export const TRACE_LAYER_ORDER: ReplayTraceNode["kind"][] = [
    "cache-consult",
    "grammar-match",
    "wildcard-validation",
    "action",
];

/** Human layer names for the node cards and callout copy. */
export const TRACE_LAYER_NAME: Record<ReplayTraceNode["kind"], string> = {
    "cache-consult": "Construction cache",
    "grammar-match": "Grammar match",
    "wildcard-validation": "Wildcard validation",
    action: "Action",
};

const EXECUTION_LABEL: Record<string, string> = {
    ran: "ran",
    "skipped-by-mode": "skipped",
    "not-applicable": "not applicable",
    unavailable: "unavailable",
    "not-reached": "not reached",
};

const OUTCOME_LABEL: Record<string, string> = {
    hit: "hit",
    miss: "miss",
    accepted: "accepted",
    rejected: "rejected",
    errored: "errored",
};

const RANKING_PARITY_LABEL: Record<
    GrammarMatchTraceNode["rankingParity"],
    string
> = {
    matched: "parse matches pick",
    diverged: "parse diverges",
    unavailable: "no trace",
};

/** Whether the two sides settled on the same action. */
export type TraceParity = "match" | "differ";

/** The layer an action difference is attributed to. `unattributed` means the
 *  actions differ but the captured trace names no single explaining layer. */
export type DivergenceCauseKind =
    | "cache-decided"
    | "grammar-differs"
    | "wildcard-validation"
    | "action-payload"
    | "unattributed";

export interface DivergenceCause {
    kind: DivergenceCauseKind;
    /** The side whose layer explains the difference, when the cause is
     *  one-sided (e.g. only A short-circuited through its cache). */
    side?: "A" | "B";
    /** Human sentence for the callout. */
    detail: string;
}

export interface DivergenceConclusion {
    parity: TraceParity;
    /** Headline copy: the parity statement the callout leads with. */
    headline: string;
    /** True when neither side produced an action at all. */
    bothNoAction: boolean;
    /** How trustworthy the cause attribution is. `low` when a diverged grammar
     *  parity forced a fallback or no layer could be attributed. */
    confidence: "high" | "low";
    /** Present only when the actions differ. */
    cause?: DivergenceCause;
    /** Present when the actions match but the sides ran different fidelity
     *  paths (working-tree vs git-ref); explains the expected asymmetry. */
    pathNote?: string;
    /** Present when a diverged grammar parity makes the grammar level a
     *  diagnostic-only explanation rather than the resolver-selected parse. */
    confidenceNote?: string;
}

/** A compact, display-ready summary of one fidelity node. */
export interface TraceNodeSummary {
    kind: ReplayTraceNode["kind"];
    layerName: string;
    executionLabel: string;
    outcomeLabel?: string;
    detail?: string;
    /** Grammar-match extras: the winning rule, ranking-parity confidence, and
     *  whether an expandable timeline is available. */
    grammar?: {
        input: string;
        chosenRule?: string;
        rankingParity: GrammarMatchTraceNode["rankingParity"];
        rankingParityLabel: string;
        /** True when a step-by-step timeline can be expanded for this node. */
        hasTimeline: boolean;
        /** True when `rankingParity === "diverged"`: the timeline is a
         *  diagnostic parse, not the resolver-selected one. */
        diagnosticOnly: boolean;
    };
    /** Cache extras rendered inline (no host round-trip). */
    cache?: {
        constructionId?: string;
        namespace?: string;
        parts?: string[];
    };
    /** Action extras: the produced action's name and whether a schema jump is
     *  available. */
    action?: {
        actionName?: string;
        hasSchema: boolean;
    };
}

export interface SideDivergenceView {
    side: "A" | "B";
    realization: TraceRealization;
    nodes: TraceNodeSummary[];
}

export interface TraceDivergenceViewModel {
    runId: string;
    utteranceId: string;
    utterance: string;
    conclusion: DivergenceConclusion;
    a: SideDivergenceView;
    b: SideDivergenceView;
    /** The layer to accent as the divergence point, when attributable. */
    divergingLayer?: ReplayTraceNode["kind"];
}

function isActionObject(action: unknown): boolean {
    return typeof action === "object" && action !== null;
}

function sameAction(a: unknown, b: unknown): boolean {
    const hasA = isActionObject(a);
    const hasB = isActionObject(b);
    if (!hasA && !hasB) return true;
    if (!hasA || !hasB) return false;
    return stableStringify(a) === stableStringify(b);
}

function actionName(action: unknown): string | undefined {
    if (!isActionObject(action)) return undefined;
    const name = (action as { actionName?: unknown }).actionName;
    return typeof name === "string" ? name : undefined;
}

function nodeOf<K extends ReplayTraceNode["kind"]>(
    side: ReplaySideTrace,
    kind: K,
): Extract<ReplayTraceNode, { kind: K }> | undefined {
    return side.nodes.find((n) => n.kind === kind) as
        | Extract<ReplayTraceNode, { kind: K }>
        | undefined;
}

/** True when a side short-circuited through its construction cache: the cache
 *  consult ran and hit, and the grammar consequently never ran. */
function cacheDecided(side: ReplaySideTrace): boolean {
    const cache = nodeOf(side, "cache-consult");
    const grammar = nodeOf(side, "grammar-match");
    return (
        cache?.execution === "ran" &&
        cache.outcome === "hit" &&
        grammar?.execution === "not-reached"
    );
}

function sideLabel(side: "A" | "B"): string {
    return side === "A" ? "A" : "B";
}

function otherSide(side: "A" | "B"): "A" | "B" {
    return side === "A" ? "B" : "A";
}

function grammarDiverged(node: GrammarMatchTraceNode | undefined): boolean {
    return node?.rankingParity === "diverged";
}

/**
 * The ordered causal walk, run only when the two sides' final actions differ.
 * Returns the first layer that explains the difference plus a confidence, hono-
 * ring the ranking-parity guard: a diverged grammar parse cannot be trusted to
 * name the cause, so attribution falls back to the action level (low confidence).
 */
function attributeCause(trace: ReplayResolutionTrace): {
    cause: DivergenceCause;
    confidence: "high" | "low";
    confidenceNote?: string;
} {
    const { a, b } = trace;
    const aCacheDecided = cacheDecided(a);
    const bCacheDecided = cacheDecided(b);

    // 1. Cache decided it. A cache short-circuit on one side means its action
    //    came from a different source than the other side's grammar match.
    if (aCacheDecided && bCacheDecided) {
        return {
            cause: {
                kind: "cache-decided",
                detail: "Both versions were resolved from their construction cache.",
            },
            confidence: "high",
        };
    }
    if (aCacheDecided || bCacheDecided) {
        const side = aCacheDecided ? "A" : "B";
        return {
            cause: {
                kind: "cache-decided",
                side,
                detail: `${sideLabel(side)}'s construction cache returned a cached action, so its grammar never ran; ${sideLabel(otherSide(side))} resolved through its grammar.`,
            },
            confidence: "high",
        };
    }

    const aGrammar = nodeOf(a, "grammar-match");
    const bGrammar = nodeOf(b, "grammar-match");
    const parityDiverged =
        grammarDiverged(aGrammar) || grammarDiverged(bGrammar);
    const diagnosticNote =
        "The captured grammar trace is a diagnostic parse that may differ from the resolver-selected one, so the cause is attributed at the action level.";

    // 2. Grammar match differs — only trustworthy when neither side's captured
    //    parse diverged from the resolver's ranked pick.
    if (!parityDiverged) {
        const aRule = aGrammar?.chosenRule;
        const bRule = bGrammar?.chosenRule;
        const bothRan =
            aGrammar?.execution === "ran" && bGrammar?.execution === "ran";
        if (bothRan && aRule !== bRule) {
            const ruleDetail =
                aRule !== undefined && bRule !== undefined
                    ? ` (A matched ${aRule}, B matched ${bRule}).`
                    : ".";
            return {
                cause: {
                    kind: "grammar-differs",
                    detail: `The two versions' grammars matched different rules${ruleDetail}`,
                },
                confidence: "high",
            };
        }

        // 3. Wildcard validation — grammars agree on the rule, but one side's
        //    validation rejected the otherwise-selected value.
        const aWild = nodeOf(a, "wildcard-validation");
        const bWild = nodeOf(b, "wildcard-validation");
        const aRejected =
            aWild?.execution === "ran" && aWild.outcome === "rejected";
        const bRejected =
            bWild?.execution === "ran" && bWild.outcome === "rejected";
        if (aRejected !== bRejected) {
            const side = aRejected ? "A" : "B";
            return {
                cause: {
                    kind: "wildcard-validation",
                    side,
                    detail: `${sideLabel(side)}'s wildcard validation rejected the value the other side accepted.`,
                },
                confidence: "high",
            };
        }
    }

    // 4. Action-payload fallback — same rule/path, differing parameters. Also
    //    where a diverged parity lands: the actions differ but the grammar
    //    level can't be trusted to say why.
    const aName = actionName(a.finalAction);
    const bName = actionName(b.finalAction);
    if (
        aName !== undefined &&
        bName !== undefined &&
        aName === bName &&
        !sameAction(a.finalAction, b.finalAction)
    ) {
        return {
            cause: {
                kind: "action-payload",
                detail: `Both versions produced a ${aName} action, but its parameters differ.`,
            },
            confidence: parityDiverged ? "low" : "high",
            ...(parityDiverged ? { confidenceNote: diagnosticNote } : {}),
        };
    }

    // 5. Unattributed — the actions differ but the captured trace names no
    //    single explaining layer.
    return {
        cause: {
            kind: "unattributed",
            detail: "The versions produced different actions, but the captured trace does not attribute the difference to a single layer.",
        },
        confidence: "low",
        ...(parityDiverged ? { confidenceNote: diagnosticNote } : {}),
    };
}

/** The layer a cause maps to, for accenting the diverging node row. */
function divergingLayerFor(
    cause: DivergenceCause,
): ReplayTraceNode["kind"] | undefined {
    switch (cause.kind) {
        case "cache-decided":
            return "cache-consult";
        case "grammar-differs":
            return "grammar-match";
        case "wildcard-validation":
            return "wildcard-validation";
        case "action-payload":
            return "action";
        case "unattributed":
            return undefined;
    }
}

/** Build the note shown when final actions match but the sides ran different
 *  fidelity paths (a git-ref side can't run the cache or wildcard validation). */
function realizationPathNote(
    a: ReplaySideTrace,
    b: ReplaySideTrace,
): string | undefined {
    if (a.realization === b.realization) return undefined;
    const sourceSide = a.realization === "source" ? "A" : "B";
    return `Final actions match; ${sideLabel(sourceSide)} ran from grammar source only, so its construction cache and wildcard validation did not run.`;
}

function summarizeNode(node: ReplayTraceNode): TraceNodeSummary {
    const summary: TraceNodeSummary = {
        kind: node.kind,
        layerName: TRACE_LAYER_NAME[node.kind],
        executionLabel: EXECUTION_LABEL[node.execution] ?? node.execution,
    };
    if (node.outcome !== undefined) {
        summary.outcomeLabel = OUTCOME_LABEL[node.outcome] ?? node.outcome;
    }
    if (node.detail !== undefined) {
        summary.detail = node.detail;
    }
    switch (node.kind) {
        case "grammar-match": {
            const g = node as GrammarMatchTraceNode;
            summary.grammar = {
                input: g.input,
                rankingParity: g.rankingParity,
                rankingParityLabel: RANKING_PARITY_LABEL[g.rankingParity],
                hasTimeline: g.trace !== undefined && g.debugInfo !== undefined,
                diagnosticOnly: g.rankingParity === "diverged",
                ...(g.chosenRule !== undefined
                    ? { chosenRule: g.chosenRule }
                    : {}),
            };
            break;
        }
        case "cache-consult": {
            const c = node as CacheConsultTraceNode;
            if (c.entry !== undefined) {
                const entry = c.entry;
                summary.cache = {
                    ...(entry.constructionId !== undefined
                        ? { constructionId: entry.constructionId }
                        : {}),
                    ...(entry.namespace !== undefined
                        ? { namespace: entry.namespace }
                        : {}),
                    ...(entry.parts !== undefined
                        ? { parts: entry.parts }
                        : {}),
                };
            }
            break;
        }
        case "action": {
            const act = node as ActionTraceNode;
            summary.action = {
                hasSchema: act.schema?.sourceFilePath !== undefined,
                ...(actionName(act.action) !== undefined
                    ? { actionName: actionName(act.action) }
                    : {}),
            };
            break;
        }
    }
    return summary;
}

/** Order a side's nodes by the canonical layer order and summarize each. Missing
 *  layers are omitted (the viewer renders the fixed four-row grid and fills gaps
 *  with a placeholder), so only captured nodes are summarized here. */
function summarizeSide(side: ReplaySideTrace): SideDivergenceView {
    const byKind = new Map(side.nodes.map((n) => [n.kind, n] as const));
    const nodes: TraceNodeSummary[] = [];
    for (const kind of TRACE_LAYER_ORDER) {
        const node = byKind.get(kind);
        if (node !== undefined) {
            nodes.push(summarizeNode(node));
        }
    }
    return { side: side.side, realization: side.realization, nodes };
}

/**
 * Build the full divergence view model for one utterance's captured trace.
 * Pure: the same trace always yields the same conclusion and node summaries.
 */
export function toTraceDivergenceViewModel(
    trace: ReplayResolutionTrace,
): TraceDivergenceViewModel {
    const { a, b } = trace;
    const aHasAction = isActionObject(a.finalAction);
    const bHasAction = isActionObject(b.finalAction);
    const bothNoAction = !aHasAction && !bHasAction;
    const parity: TraceParity = sameAction(a.finalAction, b.finalAction)
        ? "match"
        : "differ";

    let conclusion: DivergenceConclusion;
    let divergingLayer: ReplayTraceNode["kind"] | undefined;

    if (parity === "match") {
        if (bothNoAction) {
            conclusion = {
                parity,
                headline:
                    "Neither version resolved this utterance to an action.",
                bothNoAction: true,
                confidence: "high",
            };
        } else {
            const pathNote = realizationPathNote(a, b);
            conclusion = {
                parity,
                headline: "Both versions produced the same action.",
                bothNoAction: false,
                confidence: "high",
                ...(pathNote !== undefined ? { pathNote } : {}),
            };
        }
    } else {
        const { cause, confidence, confidenceNote } = attributeCause(trace);
        divergingLayer = divergingLayerFor(cause);
        conclusion = {
            parity,
            headline: "A and B produced different actions.",
            bothNoAction: false,
            confidence,
            cause,
            ...(confidenceNote !== undefined ? { confidenceNote } : {}),
        };
    }

    return {
        runId: trace.runId,
        utteranceId: trace.utteranceId,
        utterance: trace.utterance,
        conclusion,
        a: summarizeSide(a),
        b: summarizeSide(b),
        ...(divergingLayer !== undefined ? { divergingLayer } : {}),
    };
}

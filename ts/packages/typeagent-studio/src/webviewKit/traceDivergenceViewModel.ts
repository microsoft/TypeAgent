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
import { stableStringify, toActionDiff } from "./replayViewModel.js";
import type { ActionDiff } from "./replayViewModel.js";

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
    /** Basename of the source file this cause is backed by — the `.agr` grammar
     *  for a grammar divergence, the action schema `.ts` for a payload one — so
     *  the viewer can name the changed file and offer its A↔B diff. Absent for
     *  cache/wildcard causes, which are runtime state rather than a file edit. */
    fileName?: string;
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
        /** True when the winning rule carries a source span to jump to. */
        hasSource: boolean;
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

/** How the two sides compared at one pipeline stage.
 *  - `agree`: both sides ran this stage and it is not the attributed cause.
 *  - `diverge`: this stage is where the resolution split (the cause).
 *  - `one-sided`: exactly one side engaged this stage (typically a live-only
 *    cache/validation step a git-ref side can't run).
 *  - `inapplicable`: neither side actively ran the stage (e.g. grammar after a
 *    cache short-circuit). */
export type TraceStageStatus =
    | "agree"
    | "diverge"
    | "one-sided"
    | "inapplicable";

/** One stage of the resolution pipeline, pairing the A and B nodes for a single
 *  fidelity layer so the viewer can render the flow top-to-bottom and expand the
 *  stage where the two versions diverged. */
export interface TraceStageView {
    kind: ReplayTraceNode["kind"];
    layerName: string;
    /** The A-side node for this layer, when the side captured it. */
    a?: TraceNodeSummary;
    /** The B-side node for this layer, when the side captured it. */
    b?: TraceNodeSummary;
    status: TraceStageStatus;
    /** True when the divergence is attributed to this stage; the viewer expands
     *  it side-by-side and accents it as the cause. */
    isCause: boolean;
    /** When this stage is backed by a source file that can be diffed across the
     *  two versions, the node kind to drive a `compare-source` request from. */
    compare?: "grammar-match" | "action";
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
    /** The resolution pipeline: one entry per fidelity layer at least one side
     *  engaged, in runtime order (cache → grammar → wildcard → action). Drives
     *  the top-to-bottom pipeline rendering and its per-stage dig-in. */
    stages: TraceStageView[];
    /** Canonical A→B JSON diff of the two produced actions — the ground-truth
     *  "what differs in the output", shown at the Result regardless of which
     *  earlier stage caused the split. */
    resultDiff: ActionDiff;
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

/** Browser-safe basename (handles POSIX `/` and Windows `\`), for naming the
 *  changed source file in the divergence copy without pulling in node:path. */
function basename(p: string): string {
    const normalized = p.replace(/\\/g, "/");
    const slash = normalized.lastIndexOf("/");
    return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

/** The `.agr` file's display name for a grammar node: the basename of its
 *  recorded absolute path, else the winning-rule span's display path. */
function grammarFileName(
    node: GrammarMatchTraceNode | undefined,
): string | undefined {
    if (node === undefined) {
        return undefined;
    }
    if (node.sourceFilePath !== undefined) {
        return basename(node.sourceFilePath);
    }
    if (node.source?.displayPath !== undefined) {
        return basename(node.source.displayPath);
    }
    return undefined;
}

/** The `.agr` file that defines the rule a side matched, resolved through the
 *  compiled grammar's rule→location and file tables. This pinpoints the single
 *  grammar source on the match path even when a grammar imports several files, so
 *  a multi-file edit still attributes to the one file that owns the matched rule.
 *  Undefined when the trace didn't record the rule's location. */
function ruleDefiningFile(
    node: GrammarMatchTraceNode | undefined,
): string | undefined {
    const rule = node?.chosenRule;
    const debug = node?.debugInfo;
    if (rule === undefined || debug === undefined) {
        return undefined;
    }
    const location = debug.rules.find(([id]) => id === rule)?.[1];
    if (location === undefined) {
        return undefined;
    }
    const absolute = debug.filePaths.find(
        ([id]) => id === location.fileId,
    )?.[1];
    if (absolute !== undefined) {
        return basename(absolute);
    }
    return location.displayPath !== undefined
        ? basename(location.displayPath)
        : undefined;
}

/** The grammar file a divergence is attributed to: the file defining the rule the
 *  matching side landed on (rule-level, so an import is pinpointed among several
 *  changed files), falling back to a side's top-level grammar file when the
 *  rule→file map isn't recorded. */
function grammarCulpritFile(
    a: GrammarMatchTraceNode | undefined,
    b: GrammarMatchTraceNode | undefined,
): string | undefined {
    return (
        ruleDefiningFile(a) ??
        ruleDefiningFile(b) ??
        grammarFileName(a) ??
        grammarFileName(b)
    );
}

/** The action schema's file name for an action node, when the trace recorded a
 *  schema source path. */
function actionSchemaFileName(
    node: ActionTraceNode | undefined,
): string | undefined {
    const p = node?.schema?.sourceFilePath;
    return p !== undefined ? basename(p) : undefined;
}

/** Whether the two sides compiled different grammars, decided by their
 *  `grammarHash`: `true` when the hashes differ, `false` when they match,
 *  `undefined` when either side didn't record one. The hash covers the whole
 *  compiled grammar, so it flags a changed rule body even when the winning rule
 *  name is unchanged — a case the rule-name comparison alone would miss. */
function grammarHashDiffers(
    a: GrammarMatchTraceNode | undefined,
    b: GrammarMatchTraceNode | undefined,
): boolean | undefined {
    const ha = a?.debugInfo?.grammarHash;
    const hb = b?.debugInfo?.grammarHash;
    if (ha === undefined || hb === undefined) {
        return undefined;
    }
    return ha !== hb;
}

/** Name each side's matched rule for the grammar-change copy, reading a side
 *  that settled on no rule as "matched no rule". */
function ruleClause(aRule?: string, bRule?: string): string {
    const a = aRule !== undefined ? `A matched ${aRule}` : "A matched no rule";
    const b = bRule !== undefined ? `B matched ${bRule}` : "B matched no rule";
    return `${a}, ${b}`;
}

/** The grammar-change sentence: names the `.agr` file when known and the two
 *  sides' rules when they differ (a rule body-only change reads as a plain
 *  "changed between the two versions"). */
function grammarChangeDetail(
    fileName: string | undefined,
    aRule: string | undefined,
    bRule: string | undefined,
    rulesDiffer: boolean,
): string {
    const subject =
        fileName !== undefined ? `The grammar file ${fileName}` : "The grammar";
    const tail = rulesDiffer
        ? `: ${ruleClause(aRule, bRule)}.`
        : " between the two versions.";
    return `${subject} changed${tail}`;
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

    // 2. Grammar match differs. The compiled-grammar hash is resolver-indepen-
    //    dent, so a differing hash names the grammar as the cause even when a
    //    side's captured parse diverged from the resolver's ranked pick — the
    //    same source change then reads the same way whichever diagnostic path a
    //    given utterance happened to take. The rule-name comparison, by contrast,
    //    reads off that diagnostic parse, so it is only consulted when neither
    //    side diverged (a rule swap, or a body edit that flips the hash under an
    //    unchanged winning rule name).
    const aRule = aGrammar?.chosenRule;
    const bRule = bGrammar?.chosenRule;
    const bothRan =
        aGrammar?.execution === "ran" && bGrammar?.execution === "ran";
    const rulesDiffer = !parityDiverged && bothRan && aRule !== bRule;
    const hashDiffers = grammarHashDiffers(aGrammar, bGrammar);
    if (rulesDiffer || (bothRan && hashDiffers === true)) {
        const fileName = grammarCulpritFile(aGrammar, bGrammar);
        return {
            cause: {
                kind: "grammar-differs",
                ...(fileName !== undefined ? { fileName } : {}),
                detail: grammarChangeDetail(
                    fileName,
                    aRule,
                    bRule,
                    rulesDiffer,
                ),
            },
            confidence: "high",
        };
    }

    // 3. Wildcard validation — grammars agree on the rule, but one side's
    //    validation rejected the otherwise-selected value. Read off the parse, so
    //    only consulted when neither side's parse diverged.
    if (!parityDiverged) {
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
    //    level can't be trusted to say why. The action's schema is the file to
    //    diff, since the grammar matched the same and the payload still changed.
    const aName = actionName(a.finalAction);
    const bName = actionName(b.finalAction);
    if (
        aName !== undefined &&
        bName !== undefined &&
        aName === bName &&
        !sameAction(a.finalAction, b.finalAction)
    ) {
        const schemaFile =
            actionSchemaFileName(nodeOf(a, "action")) ??
            actionSchemaFileName(nodeOf(b, "action"));
        return {
            cause: {
                kind: "action-payload",
                ...(schemaFile !== undefined ? { fileName: schemaFile } : {}),
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

/** Browser-safe absolute-path test (POSIX `/…`, Windows `C:\…`/`C:/…`, UNC
 *  `\\…`). Captured paths may be Windows or POSIX regardless of where the viewer
 *  runs, so this can't use node:path. */
function isAbsolutePath(p: string): boolean {
    return (
        p.startsWith("/") || p.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(p)
    );
}

/** The matched grammar's `.agr` file resolved to an absolute path: the node's
 *  recorded absolute `sourceFilePath` when present (the real repo file, captured
 *  on both sides), else — for older captures without it — the winning rule span's
 *  file table (fileId → resolved path) or an already-absolute display path.
 *  Returns undefined when only a relative/synthetic path is available (e.g.
 *  built-in entity grammar), which the host can neither open nor diff. */
function grammarSourceAbsPath(node: GrammarMatchTraceNode): string | undefined {
    if (
        node.sourceFilePath !== undefined &&
        isAbsolutePath(node.sourceFilePath)
    ) {
        return node.sourceFilePath;
    }
    const source = node.source;
    if (source === undefined) {
        return undefined;
    }
    const resolved = node.debugInfo?.filePaths?.find(
        ([id]) => id === source.fileId,
    )?.[1];
    const candidate = resolved ?? source.displayPath;
    return isAbsolutePath(candidate) ? candidate : undefined;
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
                hasSource: grammarSourceAbsPath(g) !== undefined,
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
            const schemaPath = act.schema?.sourceFilePath;
            summary.action = {
                hasSchema:
                    schemaPath !== undefined && isAbsolutePath(schemaPath),
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

/** True when a summarized node actively ran (as opposed to being skipped,
 *  not-applicable, unavailable, or not-reached). */
function stageRan(node: TraceNodeSummary | undefined): boolean {
    return node?.executionLabel === EXECUTION_LABEL.ran;
}

/** Classify how the two sides compared at one stage. The attributed cause stage
 *  is always `diverge`; otherwise the stage is `agree` when both sides ran it,
 *  `one-sided` when exactly one did, and `inapplicable` when neither did. */
function stageStatusFor(
    a: TraceNodeSummary | undefined,
    b: TraceNodeSummary | undefined,
    isCause: boolean,
): TraceStageStatus {
    if (isCause) {
        return "diverge";
    }
    const aRan = stageRan(a);
    const bRan = stageRan(b);
    if (aRan && bRan) {
        return "agree";
    }
    if (aRan || bRan) {
        return "one-sided";
    }
    return "inapplicable";
}

/** The compare handle for a stage backed by a diffable source file, when either
 *  side exposes one: grammar rules diff their `.agr`, actions diff their schema
 *  `.ts`. Undefined for cache/wildcard stages, which have no file to diff. */
function stageCompareFor(
    kind: ReplayTraceNode["kind"],
    a: TraceNodeSummary | undefined,
    b: TraceNodeSummary | undefined,
): "grammar-match" | "action" | undefined {
    if (
        kind === "grammar-match" &&
        (a?.grammar?.hasSource === true || b?.grammar?.hasSource === true)
    ) {
        return "grammar-match";
    }
    if (
        kind === "action" &&
        (a?.action?.hasSchema === true || b?.action?.hasSchema === true)
    ) {
        return "action";
    }
    return undefined;
}

/** Assemble the pipeline: one stage per fidelity layer that at least one side
 *  engaged, in runtime order, each pairing the two sides' nodes and marking the
 *  diverging stage as the cause. Layers neither side captured are omitted so the
 *  flow shows only steps this utterance actually went through. */
function buildStages(
    aView: SideDivergenceView,
    bView: SideDivergenceView,
    divergingLayer: ReplayTraceNode["kind"] | undefined,
): TraceStageView[] {
    const aByKind = new Map(aView.nodes.map((n) => [n.kind, n] as const));
    const bByKind = new Map(bView.nodes.map((n) => [n.kind, n] as const));
    const stages: TraceStageView[] = [];
    for (const kind of TRACE_LAYER_ORDER) {
        const a = aByKind.get(kind);
        const b = bByKind.get(kind);
        if (a === undefined && b === undefined) {
            continue;
        }
        const isCause = divergingLayer === kind;
        const compare = stageCompareFor(kind, a, b);
        stages.push({
            kind,
            layerName: TRACE_LAYER_NAME[kind],
            ...(a !== undefined ? { a } : {}),
            ...(b !== undefined ? { b } : {}),
            status: stageStatusFor(a, b, isCause),
            isCause,
            ...(compare !== undefined ? { compare } : {}),
        });
    }
    return stages;
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

    const aView = summarizeSide(a);
    const bView = summarizeSide(b);
    const resultDiff = toActionDiff({
        actionA: a.finalAction,
        actionB: b.finalAction,
    });
    return {
        runId: trace.runId,
        utteranceId: trace.utteranceId,
        utterance: trace.utterance,
        conclusion,
        a: aView,
        b: bView,
        ...(divergingLayer !== undefined ? { divergingLayer } : {}),
        stages: buildStages(aView, bView, divergingLayer),
        resultDiff,
    };
}

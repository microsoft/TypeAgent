// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Browser-neutral view model for the Impact Report webview.
 *
 * Reuses the pure classification/summary helpers from `replayPresentation`
 * (which import only TYPES from `@typeagent/core`, so they bundle safely into
 * the browser client) but produces plain fields rather than the Quick Pick
 * `$(icon)` labels that module emits for the command surface.
 */

import type {
    ActionDelta,
    ReplayCacheState,
    RegressionVerdict,
    VersionSpec,
} from "@typeagent/core/replay";
import { likelyBadChange } from "@typeagent/core/replay";
import type {
    SideFidelity,
    FidelityLayer,
    FidelityLayerStatus,
    StudioReplayResult,
} from "@typeagent/core/runtime";
import {
    classifyReplayRow,
    type ReplayRowStatus,
} from "../replayPresentation.js";
import { collapseAndTruncate } from "../textFormatting.js";

type StudioReplayMethod = StudioReplayResult["method"];
type ReplayRunError = NonNullable<StudioReplayResult["error"]>;

export interface ImpactRow {
    status: ReplayRowStatus;
    /** Human word for the status, e.g. "changed". */
    statusLabel: string;
    /** Value judgment on the change: regression | improvement | benign | neutral. */
    verdict: RegressionVerdict;
    /** Pill label for the verdict, e.g. "Likely regression"; empty for neutral. */
    verdictLabel: string;
    /** Concise reason shown on hover, e.g. "Action changed"; empty for neutral. */
    verdictReason: string;
    /** True when side-B feedback (not the delta shape) drove the verdict. */
    verdictFromFeedback: boolean;
    /** The corpus utterance (collapsed whitespace, bounded). */
    utterance: string;
    /** How side A (Base) resolved, e.g. "hit" or "hit\u00b7cache". */
    resolutionA: string;
    /** How side B (Compare) resolved, e.g. "miss\u00b7grammar". */
    resolutionB: string;
    /** Latency pair "A/B", e.g. "10/12ms". */
    latency: string;
    utteranceId: string;
}

const STATUS_LABEL: Record<ReplayRowStatus, string> = {
    equal: "equal",
    changed: "changed",
    "new-match": "new match",
    "lost-match": "lost match",
};

/** Pill text for each verdict; neutral (unchanged) rows show no pill. */
const VERDICT_LABEL: Record<RegressionVerdict, string> = {
    regression: "Likely regression",
    improvement: "Improvement",
    benign: "Benign",
    neutral: "",
};

function hasAction(action: unknown): action is { actionName?: unknown } {
    return typeof action === "object" && action !== null;
}

/**
 * Concise, display-only reason for a row's verdict. The verdict itself is the
 * engine predicate's judgment; this only explains it in the row tooltip and
 * mirrors the predicate's branches so the two never disagree.
 */
function describeVerdict(
    row: ActionDelta,
    verdict: RegressionVerdict,
): { reason: string; fromFeedback: boolean } {
    if (verdict === "neutral") {
        return { reason: "", fromFeedback: false };
    }
    const rating = row.feedbackB?.rating;
    if (rating === "down" || rating === "up") {
        return { reason: "Marked by feedback", fromFeedback: true };
    }
    const hasA = hasAction(row.actionA);
    const hasB = hasAction(row.actionB);
    if (hasA && !hasB) {
        return { reason: "No longer resolves", fromFeedback: false };
    }
    if (!hasA && hasB) {
        return { reason: "Now resolves", fromFeedback: false };
    }
    if (!hasA && !hasB) {
        return { reason: "No action either side", fromFeedback: false };
    }
    const nameA = (row.actionA as { actionName?: unknown }).actionName;
    const nameB = (row.actionB as { actionName?: unknown }).actionName;
    if (nameA !== nameB) {
        return { reason: "Action changed", fromFeedback: false };
    }
    if (verdict === "regression") {
        return { reason: "Parameter changed", fromFeedback: false };
    }
    return { reason: "Only added parameters", fromFeedback: false };
}

function collapse(text: string, max = 120): string {
    return collapseAndTruncate(text, max);
}

/**
 * The per-side resolution token for the Detail column. On a construction-cache
 * side the raw `hit`/`miss` is ambiguous (both can resolve an action), so we
 * spell out the source: a `hit` was served from the construction cache, a
 * `miss` fell through to the grammar. Other sides keep the raw cache state.
 */
function sideToken(
    state: ReplayCacheState,
    method: StudioReplayMethod | undefined,
): string {
    if (method === "construction-cache") {
        if (state === "hit") return "hit\u00b7cache";
        if (state === "miss") return "miss\u00b7grammar";
    }
    return state;
}

export function toImpactRow(
    row: ActionDelta,
    methodA?: StudioReplayMethod,
    methodB?: StudioReplayMethod,
): ImpactRow {
    const status = classifyReplayRow(row);
    const verdict = likelyBadChange(row);
    const { reason, fromFeedback } = describeVerdict(row, verdict);
    return {
        status,
        statusLabel: STATUS_LABEL[status],
        verdict,
        verdictLabel: VERDICT_LABEL[verdict],
        verdictReason: reason,
        verdictFromFeedback: fromFeedback,
        utterance: collapse(row.utterance),
        resolutionA: sideToken(row.cacheStateA, methodA),
        resolutionB: sideToken(row.cacheStateB, methodB),
        latency: `${row.latencyA}/${row.latencyB}ms`,
        utteranceId: row.utteranceId,
    };
}

export function toImpactRows(
    rows: ActionDelta[],
    methodA?: StudioReplayMethod,
    methodB?: StudioReplayMethod,
): ImpactRow[] {
    return rows.map((row) => toImpactRow(row, methodA, methodB));
}

export type { ReplayRowStatus, RegressionVerdict };

/** Fixed chip order: differences first (the regression journey), equal last. */
export const IMPACT_FILTER_ORDER: ReplayRowStatus[] = [
    "changed",
    "new-match",
    "lost-match",
    "equal",
];

/** Fixed verdict-chip order: likely regressions first, unchanged last. */
export const IMPACT_VERDICT_ORDER: RegressionVerdict[] = [
    "regression",
    "improvement",
    "benign",
    "neutral",
];

/** Chip label for each verdict filter. */
const VERDICT_FILTER_LABEL: Record<RegressionVerdict, string> = {
    regression: "Likely regressions",
    improvement: "Improvements",
    benign: "Benign",
    neutral: "Unchanged",
};

/** Sort weight so likely regressions surface first, then benign changes, then
 *  improvements, then unchanged rows. */
const VERDICT_RANK: Record<RegressionVerdict, number> = {
    regression: 0,
    benign: 1,
    improvement: 2,
    neutral: 3,
};

/** Order rows regression-first for the "find a regression" journey; original
 *  order is preserved within a verdict group. */
export function sortImpactRowsByVerdict(
    rows: readonly ImpactRow[],
): ImpactRow[] {
    return rows
        .map((row, index) => ({ row, index }))
        .sort(
            (a, b) =>
                VERDICT_RANK[a.row.verdict] - VERDICT_RANK[b.row.verdict] ||
                a.index - b.index,
        )
        .map((entry) => entry.row);
}

export interface ImpactFilterChip {
    status: ReplayRowStatus;
    /** Human word for the status, e.g. "changed". */
    label: string;
    /** How many received rows have this status. */
    count: number;
}

export interface VerdictFilterChip {
    verdict: RegressionVerdict;
    /** Human label for the verdict, e.g. "Likely regressions". */
    label: string;
    /** How many received rows have this verdict. */
    count: number;
}

/**
 * The default active status filter: every status, so a fresh run opens on the
 * "All" view and the user sees the complete result before narrowing down.
 */
export function defaultImpactFilters(): Set<ReplayRowStatus> {
    return new Set<ReplayRowStatus>(IMPACT_FILTER_ORDER);
}

/** The default active verdict filter: every verdict (the "All" view). */
export function defaultVerdictFilters(): Set<RegressionVerdict> {
    return new Set<RegressionVerdict>(IMPACT_VERDICT_ORDER);
}

/**
 * True when the active set hides nothing that has rows — i.e. the "All" pill is
 * lit. Statuses with a zero count are ignored so an empty `equal` bucket does
 * not keep "All" from reading as active.
 */
export function allStatusesActive(
    chips: readonly ImpactFilterChip[],
    active: ReadonlySet<ReplayRowStatus>,
): boolean {
    return chips.every((chip) => chip.count === 0 || active.has(chip.status));
}

/** True when the active verdict set hides nothing that has rows. */
export function allVerdictsActive(
    chips: readonly VerdictFilterChip[],
    active: ReadonlySet<RegressionVerdict>,
): boolean {
    return chips.every((chip) => chip.count === 0 || active.has(chip.verdict));
}

/**
 * Per-status chip descriptors. Counts reflect only rows passing the active
 * verdict filter (when given), so the verdict and status tiers compose.
 */
export function buildImpactFilterChips(
    rows: readonly ImpactRow[],
    activeVerdicts?: ReadonlySet<RegressionVerdict>,
): ImpactFilterChip[] {
    const counts = new Map<ReplayRowStatus, number>();
    for (const row of rows) {
        if (activeVerdicts && !activeVerdicts.has(row.verdict)) {
            continue;
        }
        counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
    }
    return IMPACT_FILTER_ORDER.map((status) => ({
        status,
        label: STATUS_LABEL[status],
        count: counts.get(status) ?? 0,
    }));
}

/**
 * Per-verdict chip descriptors. Counts reflect only rows passing the active
 * status filter (when given), so the two tiers compose.
 */
export function buildVerdictFilterChips(
    rows: readonly ImpactRow[],
    activeStatuses?: ReadonlySet<ReplayRowStatus>,
): VerdictFilterChip[] {
    const counts = new Map<RegressionVerdict, number>();
    for (const row of rows) {
        if (activeStatuses && !activeStatuses.has(row.status)) {
            continue;
        }
        counts.set(row.verdict, (counts.get(row.verdict) ?? 0) + 1);
    }
    return IMPACT_VERDICT_ORDER.map((verdict) => ({
        verdict,
        label: VERDICT_FILTER_LABEL[verdict],
        count: counts.get(verdict) ?? 0,
    }));
}

/** Keep only rows whose status and verdict are both in the active sets. The
 *  verdict set is optional so status-only callers stay valid. */
export function filterImpactRows(
    rows: readonly ImpactRow[],
    activeStatuses: ReadonlySet<ReplayRowStatus>,
    activeVerdicts?: ReadonlySet<RegressionVerdict>,
): ImpactRow[] {
    return rows.filter(
        (row) =>
            activeStatuses.has(row.status) &&
            (!activeVerdicts || activeVerdicts.has(row.verdict)),
    );
}

/** True when every received row is `equal` (no differences between A and B). */
export function allRowsEqual(rows: readonly ImpactRow[]): boolean {
    return rows.length > 0 && rows.every((row) => row.status === "equal");
}

/** A note for rows the active filters hide, or `undefined` when none are. */
export function hiddenRowsNote(
    received: number,
    shown: number,
): string | undefined {
    const hidden = received - shown;
    if (hidden <= 0) {
        return undefined;
    }
    return `${hidden} row${hidden === 1 ? "" : "s"} hidden by filters.`;
}

export interface VerdictSummary {
    regression: number;
    improvement: number;
    benign: number;
    neutral: number;
}

/** Tally the rows by verdict for the headline banner. */
export function summarizeVerdicts(rows: readonly ImpactRow[]): VerdictSummary {
    const summary: VerdictSummary = {
        regression: 0,
        improvement: 0,
        benign: 0,
        neutral: 0,
    };
    for (const row of rows) {
        summary[row.verdict] += 1;
    }
    return summary;
}

export interface VerdictBanner {
    /** "regression" when any likely regression exists, else "clean". */
    tone: "regression" | "clean";
    /** Primary line, e.g. "3 likely regressions" or "No likely regressions". */
    headline: string;
    /** Secondary counts, e.g. "5 improvements · 2 benign · 40 unchanged". */
    detail: string;
}

/**
 * The verdict headline for a completed run — the primary "did anything regress?"
 * answer. Regressions are the lead; improvements/benign/unchanged are secondary
 * (zero counts omitted). Returns `undefined` when there are no rows.
 */
export function toVerdictBanner(
    rows: readonly ImpactRow[],
): VerdictBanner | undefined {
    if (rows.length === 0) {
        return undefined;
    }
    const s = summarizeVerdicts(rows);
    const tone = s.regression > 0 ? "regression" : "clean";
    const headline =
        s.regression > 0
            ? `${s.regression} likely regression${
                  s.regression === 1 ? "" : "s"
              }`
            : "No likely regressions";
    const detail: string[] = [];
    if (s.improvement > 0) {
        detail.push(
            `${s.improvement} improvement${s.improvement === 1 ? "" : "s"}`,
        );
    }
    if (s.benign > 0) {
        detail.push(`${s.benign} benign`);
    }
    if (s.neutral > 0) {
        detail.push(`${s.neutral} unchanged`);
    }
    return { tone, headline, detail: detail.join(" \u00b7 ") };
}

export interface ImpactEmptyState {
    title: string;
    hint: string;
}

/**
 * First-run guidance shown in the report body before any replay has run, so a
 * newcomer understands the A→B compare and how to start one.
 */
export function impactEmptyState(): ImpactEmptyState {
    return {
        title: "Compare two versions of an agent",
        hint: "Choose an agent, set Base (A) and Compare (B), then Run replay to see how its actions differ between versions. Base defaults to HEAD and Compare to your working tree — ideal for catching regressions in uncommitted edits.",
    };
}

/** Per-method caveat text explaining how faithfully each replay method reflects
 *  real dispatch. */
const METHOD_NOTE: Record<StudioReplayMethod, string | undefined> = {
    identity: undefined,
    "static-grammar":
        "Static grammar replay \u2014 utterances are matched against the agent's compiled grammar only (no construction cache or dispatcher), so results are indicative, not authoritative.",
    "schema-grammar":
        "Schema-enriched grammar replay \u2014 the agent's grammar was enriched with checked-variable metadata from its action schema and matched through the real grammar store. Still no construction cache or wildcard-value validation, so results are indicative, not authoritative.",
    "construction-cache":
        "Construction-cache replay \u2014 the live working-tree side consulted the agent's real per-session construction cache (hash-gated to the current schema, exactly as the dispatcher gates it) before falling back to the schema-enriched grammar. Cache hits reflect what the dispatcher would serve from cache; everything else is still grammar-matched (indicative). The cache is consulted for the working tree only, never at a git ref.",
};

/**
 * A caveat banner for how the replay resolved actions, or `undefined` when no
 * banner is warranted (the identity baseline). The `static-grammar` note keeps
 * users from reading grammar-only results as full-fidelity dispatch.
 */
export function toImpactMethodNote(
    method: StudioReplayMethod,
): string | undefined {
    return METHOD_NOTE[method];
}

/** Human-readable line for a run-level replay error (a version that failed to
 *  materialize or compile), so the report shows the failure instead of an empty
 *  zero-row success. */
export function toImpactErrorLine(error: ReplayRunError): string {
    const where = error.side === "A" ? "version A" : "version B";
    return `Replay aborted: ${where} (${error.ref}) failed to build. ${error.message}`;
}

/** Keywords (case-insensitive) a user can type to mean the live working tree
 *  rather than a committed git ref. */
const WORKING_TREE_INPUTS = new Set(["", "workingtree", "working tree", "."]);

/**
 * Parse a free-text version field from the launch controls into a
 * {@link VersionSpec}. Empty / `working tree` / `.` selects the live working
 * tree (uncommitted edits); anything else is treated as a git ref (`HEAD`,
 * `HEAD~1`, a branch, a tag, a SHA).
 */
export function parseVersionInput(raw: string | undefined): VersionSpec {
    const value = (raw ?? "").trim();
    if (WORKING_TREE_INPUTS.has(value.toLowerCase())) {
        return { kind: "workingTree" };
    }
    return { kind: "git", ref: value };
}

/**
 * Narrow an untrusted value (e.g. a version object posted by the webview after a
 * QuickPick selection) into a typed {@link VersionSpec}, or `undefined` when it
 * is not a well-formed spec. The host must NOT trust an arbitrary object the
 * webview sends, so every `run` spec is re-validated here before it reaches the
 * replay engine.
 */
export function narrowVersionSpec(value: unknown): VersionSpec | undefined {
    if (typeof value !== "object" || value === null) {
        return undefined;
    }
    const v = value as { kind?: unknown; ref?: unknown };
    if (v.kind === "workingTree") {
        return { kind: "workingTree" };
    }
    if (v.kind === "git" && typeof v.ref === "string" && v.ref.trim() !== "") {
        return { kind: "git", ref: v.ref.trim() };
    }
    return undefined;
}

/**
 * Coerce an untrusted version field from a `run` message into a
 * {@link VersionSpec}. A well-formed typed spec (from a picker selection) is
 * taken as-is after validation; a raw string falls back to
 * {@link parseVersionInput} (the legacy text-field / test seam); anything else
 * defaults to the working tree.
 */
export function coerceVersionSpec(value: unknown): VersionSpec {
    const narrowed = narrowVersionSpec(value);
    if (narrowed) {
        return narrowed;
    }
    if (typeof value === "string") {
        return parseVersionInput(value);
    }
    return { kind: "workingTree" };
}

const METHOD_LABEL: Record<StudioReplayMethod, string> = {
    identity: "identity",
    "static-grammar": "static grammar",
    "schema-grammar": "schema-enriched grammar",
    "construction-cache": "construction cache",
};

/** Short label for how a side resolved actions, e.g. "schema-enriched grammar".
 *  Used as hover detail rather than a visible column. */
export function toSideMethodLabel(method: StudioReplayMethod): string {
    return METHOD_LABEL[method];
}

/** One cell of the fidelity matrix: a layer's status on one side plus the
 *  reason to show on hover. */
export interface FidelityCell {
    status: FidelityLayerStatus;
    reason: string;
}

/** One row of the fidelity matrix: a deterministic layer and its A/B status. */
export interface FidelityMatrixRow {
    /** Display label for the layer, e.g. "Construction cache". */
    layer: string;
    a: FidelityCell;
    b: FidelityCell;
}

/** Render-ready per-side fidelity matrix for the Impact Report. */
export interface FidelityMatrixView {
    /** How side A was realized, e.g. "built (live)". */
    realizationA: string;
    /** How side B was realized, e.g. "source (git ref)". */
    realizationB: string;
    rows: FidelityMatrixRow[];
}

const FIDELITY_LAYER_ORDER: { key: FidelityLayer; label: string }[] = [
    { key: "grammar", label: "Grammar match" },
    { key: "schemaEnrichment", label: "Schema enrichment" },
    { key: "constructionCache", label: "Construction cache" },
    { key: "wildcardValidation", label: "Wildcard validation" },
    { key: "dispatch", label: "Full dispatch" },
];

const FIDELITY_REALIZATION_LABEL: Record<
    SideFidelity["A"]["realization"],
    string
> = {
    "built-live": "built (live)",
    source: "source (git ref)",
};

/**
 * Map the core {@link SideFidelity} descriptor into a render-ready matrix:
 * one row per deterministic layer with each side's status + reason. Pure +
 * browser-neutral.
 */
export function toFidelityMatrix(
    sideFidelity: SideFidelity | undefined,
): FidelityMatrixView | undefined {
    if (!sideFidelity) {
        return undefined;
    }
    const rows: FidelityMatrixRow[] = FIDELITY_LAYER_ORDER.map(
        ({ key, label }) => ({
            layer: label,
            a: toFidelityCell(sideFidelity.A.layers[key]),
            b: toFidelityCell(sideFidelity.B.layers[key]),
        }),
    );
    return {
        realizationA: FIDELITY_REALIZATION_LABEL[sideFidelity.A.realization],
        realizationB: FIDELITY_REALIZATION_LABEL[sideFidelity.B.realization],
        rows,
    };
}

function toFidelityCell(report: FidelityCell): FidelityCell {
    return { status: report.status, reason: report.reason };
}

/**
 * A version the user selected through a picker: the typed spec the host will run
 * plus the resolved, human-readable label/tooltip to show in the launch control.
 */
export interface ResolvedVersion {
    spec: VersionSpec;
    /** Short display label, e.g. "HEAD (main)", "v1.2.0", "a1b2c3d fix rule". */
    label: string;
    /** Full meaning, shown as the control's hover title. */
    tooltip: string;
}

/** The concrete identity a side actually ran against, captured at run time so a
 *  bare `HEAD`/branch label (which goes stale when the branch moves) or drifting
 *  working-tree content is pinned to the commit the report reflects. */
export interface VersionProvenance {
    /** The display label the run used (e.g. "HEAD (main)"). */
    label: string;
    /** The resolved commit SHA, when the side is a git ref. */
    sha?: string;
    /** True when the side is the live working tree (uncommitted edits). */
    workingTree: boolean;
}

/** Provenance for a completed run: the resolved identity of both sides plus when
 *  the run completed. Persisted with the report so it stays self-describing. */
export interface RunProvenance {
    a: VersionProvenance;
    b: VersionProvenance;
    /** Epoch ms the run was issued. */
    runAt: number;
}

/** Short label for one side's captured identity, e.g. "working tree",
 *  "HEAD (main) @ a1b2c3d", or just the label when no SHA was resolved. */
export function formatVersionProvenance(p: VersionProvenance): string {
    if (p.workingTree) {
        return p.sha ? `working tree (on ${p.sha})` : "working tree";
    }
    return p.sha ? `${p.label} @ ${p.sha}` : p.label;
}

/** One-line provenance summary for the report header/tooltip, e.g.
 *  "Ran HEAD (main) @ a1b2c3d \u2192 working tree". */
export function formatProvenanceLine(p: RunProvenance): string {
    return `Ran ${formatVersionProvenance(p.a)} \u2192 ${formatVersionProvenance(
        p.b,
    )}`;
}

/** The kind of a unified-diff line: present on both sides, only B (added), or
 *  only A (removed). */
export type DiffLineKind = "context" | "added" | "removed";

export interface DiffLine {
    kind: DiffLineKind;
    text: string;
}

/** A row drill-in's action A → B comparison, as a unified line diff of the two
 *  resolved actions serialised to canonical (key-sorted) pretty JSON. */
export interface ActionDiff {
    lines: DiffLine[];
    /** Lines present only on side B. */
    addedCount: number;
    /** Lines present only on side A. */
    removedCount: number;
    /** Both sides resolved an action and they serialise identically. */
    identical: boolean;
    /** Side A resolved no action (a new match in B). */
    onlyB: boolean;
    /** Side B resolved no action (a lost match from A). */
    onlyA: boolean;
}

/** Placeholder shown for a side that resolved no action. */
const NO_ACTION_TEXT = "(no action)";
/** LCS is O(n·m); above this product fall back to a naive replace-block diff so
 *  a pathologically large action can't lock up the webview. */
const DIFF_LCS_CELL_BUDGET = 250_000;

/** Recursively sort object keys so two equivalent actions serialise identically
 *  regardless of key insertion order (a property reorder isn't a real change). */
function sortValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortValue);
    }
    if (value !== null && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(
            value as Record<string, unknown>,
        ).sort()) {
            out[key] = sortValue((value as Record<string, unknown>)[key]);
        }
        return out;
    }
    return value;
}

/** Canonical pretty JSON (sorted keys, 2-space indent) for diffing actions. */
export function stableStringify(value: unknown): string {
    return JSON.stringify(sortValue(value), null, 2);
}

/** Unified line diff of `a` → `b` via LCS, with a naive fallback for very large
 *  inputs (all A removed, then all B added). */
function diffLines(a: string[], b: string[]): DiffLine[] {
    const n = a.length;
    const m = b.length;
    if (n * m > DIFF_LCS_CELL_BUDGET) {
        return [
            ...a.map((text): DiffLine => ({ kind: "removed", text })),
            ...b.map((text): DiffLine => ({ kind: "added", text })),
        ];
    }
    // dp[i][j] = LCS length of a[i:] and b[j:].
    const dp: number[][] = Array.from({ length: n + 1 }, () =>
        new Array<number>(m + 1).fill(0),
    );
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i][j] =
                a[i] === b[j]
                    ? dp[i + 1][j + 1] + 1
                    : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    const out: DiffLine[] = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            out.push({ kind: "context", text: a[i] });
            i++;
            j++;
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
            out.push({ kind: "removed", text: a[i] });
            i++;
        } else {
            out.push({ kind: "added", text: b[j] });
            j++;
        }
    }
    while (i < n) {
        out.push({ kind: "removed", text: a[i] });
        i++;
    }
    while (j < m) {
        out.push({ kind: "added", text: b[j] });
        j++;
    }
    return out;
}

/**
 * Build the A→B action diff for a row drill-in from the {@link ActionDelta} we
 * already have — no engine round-trip. A side that resolved no action (a new or
 * lost match) is rendered against the `(no action)` placeholder so the diff still
 * reads as a clean add/remove block.
 */
export function toActionDiff(row: ActionDelta): ActionDiff {
    const aPresent = row.actionA !== undefined;
    const bPresent = row.actionB !== undefined;
    const aText = aPresent ? stableStringify(row.actionA) : NO_ACTION_TEXT;
    const bText = bPresent ? stableStringify(row.actionB) : NO_ACTION_TEXT;
    const lines = diffLines(aText.split("\n"), bText.split("\n"));
    let addedCount = 0;
    let removedCount = 0;
    for (const line of lines) {
        if (line.kind === "added") addedCount++;
        else if (line.kind === "removed") removedCount++;
    }
    return {
        lines,
        addedCount,
        removedCount,
        identical: aPresent && bPresent && aText === bText,
        onlyB: !aPresent && bPresent,
        onlyA: aPresent && !bPresent,
    };
}

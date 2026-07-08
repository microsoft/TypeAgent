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
    /** Lower-case word for the Impact column, e.g. "regression"; empty for neutral. */
    impactLabel: string;
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
    /** Base (A) latency in milliseconds, for numeric sorting. */
    latencyA: number;
    /** Compare (B) latency in milliseconds, for numeric sorting. */
    latencyB: number;
    utteranceId: string;
}

const STATUS_LABEL: Record<ReplayRowStatus, string> = {
    equal: "unchanged",
    changed: "changed",
    "new-match": "new match",
    "lost-match": "lost match",
};

/** Lower-case word for the Impact column; neutral (unchanged) rows show none. */
const IMPACT_LABEL: Record<RegressionVerdict, string> = {
    regression: "regression",
    improvement: "improvement",
    benign: "benign",
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
        impactLabel: IMPACT_LABEL[verdict],
        verdictReason: reason,
        verdictFromFeedback: fromFeedback,
        utterance: collapse(row.utterance),
        resolutionA: sideToken(row.cacheStateA, methodA),
        resolutionB: sideToken(row.cacheStateB, methodB),
        latency: `${row.latencyA}/${row.latencyB}ms`,
        latencyA: row.latencyA,
        latencyB: row.latencyB,
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

/**
 * The filter keys for the impact bar. Both the structural statuses and the
 * value verdicts are offered as chips so a user can narrow by either lens.
 * `unchanged` is the merged equal/neutral bucket (a row that resolved to the
 * same action on both sides carries no value judgment).
 *
 * The chips are non-exclusive filters over the SAME rows, so they overlap: a
 * lost-match row is both `lost-match` and `regression`; a new-match row is both
 * `new-match` and `improvement`. The filter therefore tracks visibility at the
 * row level (see the `hidden` set below) rather than as independent chip flags.
 * Toggling a chip hides or shows its rows, and every other chip recomputes its
 * live count over the still-visible rows — the faceted-search "dynamic result
 * counts" pattern (NN/g, Baymard). That is why deselecting `improvement` also
 * drops `new-match` to zero: they name the same row.
 */
export type ImpactFilterKey =
    | "regression"
    | "improvement"
    | "benign"
    | "changed"
    | "new-match"
    | "lost-match"
    | "unchanged";

/** Every filter chip, in a stable render order (one flat list, no grouping). */
export const IMPACT_FILTER_ORDER: ImpactFilterKey[] = [
    "regression",
    "improvement",
    "benign",
    "changed",
    "new-match",
    "lost-match",
    "unchanged",
];

/** Lower-case chip label for each filter key (kept consistent with the status
 *  and impact-column casing). */
const FILTER_LABEL: Record<ImpactFilterKey, string> = {
    regression: "regression",
    improvement: "improvement",
    benign: "benign",
    changed: "changed",
    "new-match": "new match",
    "lost-match": "lost match",
    unchanged: "unchanged",
};

/** Colour-dot tone class for each chip, mirroring the row colours. */
const FILTER_TONE: Record<ImpactFilterKey, string> = {
    regression: "tone-regression",
    improvement: "tone-improvement",
    benign: "tone-benign",
    changed: "tone-changed",
    "new-match": "tone-new-match",
    "lost-match": "tone-lost-match",
    unchanged: "tone-unchanged",
};

/** Sort weight so likely regressions surface first, then benign changes, then
 *  improvements, then unchanged rows. */
const VERDICT_RANK: Record<RegressionVerdict, number> = {
    regression: 0,
    benign: 1,
    improvement: 2,
    neutral: 3,
};

/** Order rows regression-first so likely regressions surface at the top;
 *  original order is preserved within a verdict group. */
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

/** A user-clickable table column that carries a sort. */
export type ImpactSortColumn =
    | "utterance"
    | "status"
    | "impact"
    | "resolutionA"
    | "resolutionB"
    | "latency";

export type SortDirection = "asc" | "desc";

export interface ImpactSort {
    column: ImpactSortColumn;
    direction: SortDirection;
}

/** Compare two rows on one column in ascending order. Text columns compare
 *  case-insensitively; Impact orders by regression-first verdict rank; Latency
 *  compares numerically on the Compare (B) side, then Base (A). */
function compareOnColumn(
    a: ImpactRow,
    b: ImpactRow,
    column: ImpactSortColumn,
): number {
    switch (column) {
        case "utterance":
            return a.utterance.localeCompare(b.utterance);
        case "status":
            return a.statusLabel.localeCompare(b.statusLabel);
        case "impact":
            return VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict];
        case "resolutionA":
            return a.resolutionA.localeCompare(b.resolutionA);
        case "resolutionB":
            return a.resolutionB.localeCompare(b.resolutionB);
        case "latency":
            return a.latencyB - b.latencyB || a.latencyA - b.latencyA;
    }
}

/** Sort rows by a chosen column and direction. The sort is stable: rows that tie
 *  on the column keep their incoming order (which is regression-first), so a
 *  column sort layers on top of the default verdict ordering. */
export function sortImpactRows(
    rows: readonly ImpactRow[],
    sort: ImpactSort,
): ImpactRow[] {
    const dir = sort.direction === "asc" ? 1 : -1;
    return rows
        .map((row, index) => ({ row, index }))
        .sort(
            (a, b) =>
                compareOnColumn(a.row, b.row, sort.column) * dir ||
                a.index - b.index,
        )
        .map((entry) => entry.row);
}

export interface ImpactFilterChip {
    key: ImpactFilterKey;
    /** Lower-case word for the chip, e.g. "changed". */
    label: string;
    /** Colour-dot tone class, e.g. "tone-regression". */
    tone: string;
    /** How many currently-visible rows this key matches (the live count). */
    count: number;
    /** How many received rows match this key regardless of visibility. */
    total: number;
    /** True when the chip has visible rows — i.e. it reads as selected. */
    selected: boolean;
    /** True when no received row matches this key at all (disabled/inert). */
    empty: boolean;
}

/** True when a row falls under a single filter key. Verdict keys test the row's
 *  verdict; status keys test its structural status; `unchanged` is the merged
 *  equal/neutral bucket. A single row can match more than one key (a lost-match
 *  row matches both "lost-match" and "regression"). */
export function rowMatchesFilterKey(
    row: ImpactRow,
    key: ImpactFilterKey,
): boolean {
    switch (key) {
        case "regression":
        case "improvement":
        case "benign":
            return row.verdict === key;
        case "changed":
        case "new-match":
        case "lost-match":
            return row.status === key;
        case "unchanged":
            return row.status === "equal";
    }
}

/** True when the row's utterance contains the (case-insensitive) query. An empty
 *  or whitespace-only query matches every row, so the search box is off until the
 *  user types. */
export function rowMatchesSearch(row: ImpactRow, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (q.length === 0) {
        return true;
    }
    return row.utterance.toLowerCase().includes(q);
}

/** The rows still visible given the hidden-id set and the utterance search. A
 *  row shows when it is not chip-hidden AND its utterance matches the query. */
export function visibleImpactRows(
    rows: readonly ImpactRow[],
    hidden: ReadonlySet<string>,
    query = "",
): ImpactRow[] {
    return rows.filter(
        (row) => !hidden.has(row.utteranceId) && rowMatchesSearch(row, query),
    );
}

/**
 * Toggle a chip's rows in or out of view, returning the next hidden-id set.
 *
 * A chip names a set of rows (via `rowMatchesFilterKey`). The toggle only acts on
 * rows currently admitted by the search, so a chip operates on what the user can
 * actually see. If any of those rows are visible the chip is "on", so clicking it
 * hides them all; if all of them are already hidden the chip is "off", so
 * clicking it shows them again. Because chips overlap on the same rows, hiding one
 * chip's rows also drops any co-naming chip's live count — e.g. hiding
 * "improvement" empties "new match".
 */
export function toggleFilterKey(
    rows: readonly ImpactRow[],
    key: ImpactFilterKey,
    hidden: ReadonlySet<string>,
    query = "",
): Set<string> {
    const next = new Set(hidden);
    const matching = rows.filter(
        (row) => rowMatchesFilterKey(row, key) && rowMatchesSearch(row, query),
    );
    const anyVisible = matching.some((row) => !next.has(row.utteranceId));
    for (const row of matching) {
        if (anyVisible) {
            next.add(row.utteranceId);
        } else {
            next.delete(row.utteranceId);
        }
    }
    return next;
}

/** Every row's id — used to hide all rows for the "None" pill. */
export function allRowIds(rows: readonly ImpactRow[]): Set<string> {
    return new Set(rows.map((row) => row.utteranceId));
}

/** True when nothing is hidden — the "All" pill is lit. */
export function allRowsVisible(hidden: ReadonlySet<string>): boolean {
    return hidden.size === 0;
}

/** True when every received row is hidden — the "None" pill is lit. */
export function allRowsHidden(
    rows: readonly ImpactRow[],
    hidden: ReadonlySet<string>,
): boolean {
    return rows.length > 0 && rows.every((row) => hidden.has(row.utteranceId));
}

/**
 * Per-key chip descriptors with live counts. `count` is the number of
 * currently-visible rows a key matches — i.e. rows that are neither chip-hidden
 * nor filtered out by the utterance search — so typing in the search box updates
 * every chip's count. `total` is the number of rows a key matches across the
 * whole dataset (search-independent), so a chip is `empty` (disabled) only when
 * no such row exists at all, not merely when the current search hides them. A
 * chip is `selected` when it still has visible rows. Counts can sum to more than
 * the row total because a row may match several keys.
 */
export function buildImpactFilterChips(
    rows: readonly ImpactRow[],
    hidden: ReadonlySet<string>,
    query = "",
): ImpactFilterChip[] {
    return IMPACT_FILTER_ORDER.map((key) => {
        let count = 0;
        let total = 0;
        for (const row of rows) {
            if (!rowMatchesFilterKey(row, key)) {
                continue;
            }
            total += 1;
            if (!hidden.has(row.utteranceId) && rowMatchesSearch(row, query)) {
                count += 1;
            }
        }
        return {
            key,
            label: FILTER_LABEL[key],
            tone: FILTER_TONE[key],
            count,
            total,
            selected: count > 0,
            empty: total === 0,
        };
    });
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

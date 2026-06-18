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
    ReplayMissPolicy,
    ReplaySummary,
    VersionSpec,
} from "@typeagent/core/replay";
import type { StudioReplayResult } from "@typeagent/core/runtime";
import {
    classifyReplayRow,
    formatReplaySummaryLine,
    type ReplayRowStatus,
} from "../replayPresentation.js";

type StudioReplayMethod = StudioReplayResult["method"];
type ReplayRunError = NonNullable<StudioReplayResult["error"]>;

export interface ImpactRow {
    status: ReplayRowStatus;
    /** Human word for the status, e.g. "changed". */
    statusLabel: string;
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

function collapse(text: string, max = 120): string {
    const s = text.replace(/\s+/g, " ").trim();
    return s.length > max ? `${s.slice(0, max - 1)}\u2026` : s;
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
    return {
        status,
        statusLabel: STATUS_LABEL[status],
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

export type { ReplayRowStatus };

/** Fixed chip order: differences first (the regression journey), equal last. */
export const IMPACT_FILTER_ORDER: ReplayRowStatus[] = [
    "changed",
    "new-match",
    "lost-match",
    "equal",
];

/** The difference statuses — everything except `equal`. */
const DIFFERENCE_STATUSES: ReplayRowStatus[] = [
    "changed",
    "new-match",
    "lost-match",
];

export interface ImpactFilterChip {
    status: ReplayRowStatus;
    /** Human word for the status, e.g. "changed". */
    label: string;
    /** How many received rows have this status. */
    count: number;
}

/**
 * The default active filter: differences only (`equal` hidden) so the report
 * opens focused on what changed between versions rather than burying a handful
 * of regressions under a long list of unchanged rows.
 */
export function defaultImpactFilters(): Set<ReplayRowStatus> {
    return new Set<ReplayRowStatus>(DIFFERENCE_STATUSES);
}

/** Per-status chip descriptors (counts taken from the received rows). */
export function buildImpactFilterChips(
    rows: readonly ImpactRow[],
): ImpactFilterChip[] {
    const counts = new Map<ReplayRowStatus, number>();
    for (const row of rows) {
        counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
    }
    return IMPACT_FILTER_ORDER.map((status) => ({
        status,
        label: STATUS_LABEL[status],
        count: counts.get(status) ?? 0,
    }));
}

/** Keep only rows whose status is in the active set. */
export function filterImpactRows(
    rows: readonly ImpactRow[],
    active: ReadonlySet<ReplayRowStatus>,
): ImpactRow[] {
    return rows.filter((row) => active.has(row.status));
}

/** True when every received row is `equal` (no differences between A and B). */
export function allRowsEqual(rows: readonly ImpactRow[]): boolean {
    return rows.length > 0 && rows.every((row) => row.status === "equal");
}

/**
 * A note describing rows hidden by the active filter (e.g. the `equal` rows the
 * default view omits), or `undefined` when nothing with a non-zero count is
 * hidden.
 */
export function impactFilterNote(
    chips: readonly ImpactFilterChip[],
    active: ReadonlySet<ReplayRowStatus>,
): string | undefined {
    const hidden = chips.filter(
        (chip) => !active.has(chip.status) && chip.count > 0,
    );
    if (hidden.length === 0) {
        return undefined;
    }
    const total = hidden.reduce((sum, chip) => sum + chip.count, 0);
    const parts = hidden.map((chip) => `${chip.count} ${chip.label}`);
    return `${total} row${total === 1 ? "" : "s"} hidden (${parts.join(", ")}).`;
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

/** One-line headline for a replay summary (reused from the command surface). */
export function toImpactSummaryLine(summary: ReplaySummary): string {
    return formatReplaySummaryLine(summary);
}

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

/** Short label for a version: the git ref, or `working tree`. */
export function describeVersion(spec: VersionSpec): string {
    return spec.kind === "workingTree" ? "working tree" : spec.ref;
}

/** A `Comparing A → B` line built from the summary's resolved versions. */
export function toImpactComparisonLine(summary: ReplaySummary): string {
    return `Comparing ${describeVersion(summary.versionA)} \u2192 ${describeVersion(
        summary.versionB,
    )}`;
}

/** One labelled field in the Impact Report context header. */
export interface ImpactHeaderField {
    label: string;
    value: string;
    /** Hover text explaining what the field means. */
    tooltip: string;
}

const PLACEHOLDER = "\u2014";

const METHOD_LABEL: Record<StudioReplayMethod, string> = {
    identity: "identity",
    "static-grammar": "static grammar",
    "schema-grammar": "schema-enriched grammar",
    "construction-cache": "construction cache",
};

const FIDELITY_LABEL: Record<StudioReplayMethod, string> = {
    identity: "baseline (no grammar diff)",
    "static-grammar": "indicative",
    "schema-grammar": "indicative (schema-enriched)",
    "construction-cache": "faithful cache hits, indicative grammar",
};

/**
 * Short label for how a single A/B side resolved, rendered under that side's
 * version field. The construction cache is live-only, so a git ref reads
 * `schema-enriched grammar`/`static grammar` while only a working-tree side can
 * show `construction cache` — making the asymmetry explicit instead of letting
 * the single run-level method chip imply the cache served both sides.
 */
export function toSideMethodLabel(method: StudioReplayMethod): string {
    return METHOD_LABEL[method];
}

/**
 * The provenance band shown above the controls: what this report pertains to
 * (`repo · agent · method · fidelity · sandbox · policy`). Deliberately omits a
 * sandbox id — neither the identity nor the static-grammar method runs in a
 * sandbox (they read grammar source from git / the working tree), so labelling
 * one would falsely imply the result reflects a loaded runtime agent. A real
 * sandbox label only becomes meaningful with the full-fidelity replay path.
 */
export function toImpactHeaderFields(input: {
    repo?: string;
    agent?: string;
    method?: StudioReplayMethod;
    missPolicy?: ReplayMissPolicy;
}): ImpactHeaderField[] {
    const method = input.method;
    return [
        {
            label: "repo",
            value:
                input.repo && input.repo.length > 0 ? input.repo : PLACEHOLDER,
            tooltip: "The workspace repository this report runs against.",
        },
        {
            label: "agent",
            value:
                input.agent && input.agent.length > 0
                    ? input.agent
                    : PLACEHOLDER,
            tooltip: "The agent whose corpus is being replayed.",
        },
        {
            label: "method",
            value: method ? METHOD_LABEL[method] : PLACEHOLDER,
            tooltip:
                "How utterances are resolved into actions for the compare.",
        },
        {
            label: "fidelity",
            value: method ? FIDELITY_LABEL[method] : PLACEHOLDER,
            tooltip:
                "How faithfully the result reflects real dispatch. Static-grammar replay is indicative, not authoritative.",
        },
        {
            label: "sandbox",
            value: "not used",
            tooltip:
                "Static-grammar replay reads grammar from git / the working tree and is not sandbox-bound. A sandbox is only used by the full-fidelity replay path.",
        },
        {
            label: "policy",
            value: input.missPolicy ?? PLACEHOLDER,
            tooltip:
                "Cache-miss policy for the run. needs-explanation stays deterministic (no LLM calls).",
        },
    ];
}

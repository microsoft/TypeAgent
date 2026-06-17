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
    /** Cache states + latencies, e.g. "A:hit B:miss · 12/8ms". */
    detail: string;
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

export function toImpactRow(row: ActionDelta): ImpactRow {
    const status = classifyReplayRow(row);
    return {
        status,
        statusLabel: STATUS_LABEL[status],
        utterance: collapse(row.utterance),
        detail: `A:${row.cacheStateA} B:${row.cacheStateB} \u00b7 ${row.latencyA}/${row.latencyB}ms`,
        utteranceId: row.utteranceId,
    };
}

export function toImpactRows(rows: ActionDelta[]): ImpactRow[] {
    return rows.map(toImpactRow);
}

/** One-line headline for a replay summary (reused from the command surface). */
export function toImpactSummaryLine(summary: ReplaySummary): string {
    return formatReplaySummaryLine(summary);
}

const METHOD_NOTE: Record<StudioReplayMethod, string | undefined> = {
    identity: undefined,
    "static-grammar":
        "Static grammar replay \u2014 utterances are matched against the agent's compiled grammar only (no construction cache or dispatcher), so results are indicative, not authoritative.",
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

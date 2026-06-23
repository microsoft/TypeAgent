// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * vscode-free formatting for replay/compare results.
 *
 * Turns the core engine's {@link ActionDelta} rows and {@link ReplaySummary}
 * into display-ready labels for a quick pick / output channel. Kept pure so the
 * extension command stays a thin wrapper and the formatting is unit-testable.
 */

import type { ActionDelta, ReplaySummary } from "@typeagent/core/replay";

export type ReplayRowStatus = "equal" | "changed" | "new-match" | "lost-match";

export interface ReplayRowView {
    status: ReplayRowStatus;
    /** Quick-pick label, e.g. `$(check) play jazz`. */
    label: string;
    /** Secondary line summarizing cache states and latency. */
    detail: string;
    utteranceId: string;
}

const STATUS_ICON: Record<ReplayRowStatus, string> = {
    equal: "$(check)",
    changed: "$(diff-modified)",
    "new-match": "$(diff-added)",
    "lost-match": "$(diff-removed)",
};

const STATUS_WORD: Record<ReplayRowStatus, string> = {
    equal: "equal",
    changed: "changed",
    "new-match": "new match",
    "lost-match": "lost match",
};

export function classifyReplayRow(row: ActionDelta): ReplayRowStatus {
    const hasA = row.actionA !== undefined;
    const hasB = row.actionB !== undefined;
    if (row.equal) {
        return "equal";
    }
    if (hasA && hasB) {
        return "changed";
    }
    if (!hasA && hasB) {
        return "new-match";
    }
    return "lost-match";
}

function truncate(text: string, max = 80): string {
    const collapsed = text.replace(/\s+/g, " ").trim();
    return collapsed.length > max
        ? `${collapsed.slice(0, max - 1)}\u2026`
        : collapsed;
}

export function formatReplayRow(row: ActionDelta): ReplayRowView {
    const status = classifyReplayRow(row);
    return {
        status,
        label: `${STATUS_ICON[status]} ${truncate(row.utterance)}`,
        detail: `${STATUS_WORD[status]} \u00b7 A:${row.cacheStateA} B:${row.cacheStateB} \u00b7 ${row.latencyA}/${row.latencyB}ms`,
        utteranceId: row.utteranceId,
    };
}

export function buildReplayRowViews(rows: ActionDelta[]): ReplayRowView[] {
    return rows.map(formatReplayRow);
}

/** One-line headline summarizing a replay run. */
export function formatReplaySummaryLine(summary: ReplaySummary): string {
    const parts = [
        `${summary.agent}`,
        `${summary.rowCount} ${summary.rowCount === 1 ? "row" : "rows"}`,
        `${summary.equalCount} equal`,
        `${summary.changedCount} changed`,
        `${summary.newMatchCount} new`,
        `${summary.lostMatchCount} lost`,
    ];
    if (summary.collisionDelta !== 0) {
        const sign = summary.collisionDelta > 0 ? "+" : "";
        parts.push(`${sign}${summary.collisionDelta} collision \u0394`);
    }
    parts.push(`${summary.duration}ms`);
    return parts.join(" \u00b7 ");
}

/** True when the run found at least one difference between versions A and B. */
export function replayHasDifferences(summary: ReplaySummary): boolean {
    return (
        summary.changedCount + summary.newMatchCount + summary.lostMatchCount >
        0
    );
}

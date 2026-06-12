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

import type { ActionDelta, ReplaySummary } from "@typeagent/core/replay";
import {
    classifyReplayRow,
    formatReplaySummaryLine,
    type ReplayRowStatus,
} from "../replayPresentation.js";

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

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { RunResult } from "./types.js";

type LatencyResult = Pick<RunResult, "durationMs" | "latencyTimeline">;

export function responseReadyDurationMs(row: LatencyResult): number {
    const timeline = row.latencyTimeline;
    return (
        timeline?.responseReadyMs ??
        timeline?.repairTurnCompletedMs ??
        timeline?.primaryTurnCompletedMs ??
        row.durationMs
    );
}

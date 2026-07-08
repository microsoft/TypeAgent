// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type * as vscode from "vscode";
import type {
    ResolvedVersion,
    RunProvenance,
} from "./webviewKit/replayViewModel.js";
import type { StudioReplayResult } from "@typeagent/core/runtime";
import {
    likelyBadChange,
    type RegressionRow,
    type RegressionVerdict,
} from "@typeagent/core/replay";

// The Impact Report and the lightweight "Replay corpus" action both write the
// last run here so opening the report re-renders whichever ran most recently for
// the agent. The store lives in workspaceState so it survives closing the report
// tab and restarting the window.

/** Cap the stored rows so the persisted payload stays bounded; the summary still
 *  reflects the full run. */
const MAX_PERSISTED_ROWS = 500;

/** Keep-priority when the row cap is hit: significant (changed) rows first so a
 *  reopened, capped report still surfaces every likely regression rather than an
 *  arbitrary payload-order prefix of mostly-unchanged rows. */
const VERDICT_KEEP_RANK: Record<RegressionVerdict, number> = {
    regression: 0,
    improvement: 1,
    benign: 2,
    neutral: 3,
};

/** Reduce rows to the `max` most significant, regression-first, preserving the
 *  original order within a rank. */
function keepMostSignificantRows<T extends RegressionRow>(
    rows: readonly T[],
    max: number,
): T[] {
    return rows
        .map((row, index) => ({
            row,
            index,
            rank: VERDICT_KEEP_RANK[likelyBadChange(row)],
        }))
        .sort((a, b) => a.rank - b.rank || a.index - b.index)
        .slice(0, max)
        .map((entry) => entry.row);
}

const runStoreKey = (agent: string): string => `impactReport.lastRun.${agent}`;

/** A completed replay kept per agent so the report can show the previous run. */
export interface PersistedRun {
    payload: StudioReplayResult;
    provenance?: RunProvenance;
    runAt: number;
    /** The base (A) selection the run used, to restore the launch controls. */
    versionA?: ResolvedVersion;
    /** The compare (B) selection the run used, to restore the launch controls. */
    versionB?: ResolvedVersion;
}

/** Read the last persisted run for an agent, or `undefined` if none is stored. */
export function loadPersistedRun(
    state: vscode.Memento,
    agent: string,
): PersistedRun | undefined {
    return state.get<PersistedRun>(runStoreKey(agent));
}

/** Persist a completed run (row-capped) as the agent's last run. */
export function savePersistedRun(
    state: vscode.Memento,
    agent: string,
    payload: StudioReplayResult,
    runAt: number,
    provenance?: RunProvenance,
    versionA?: ResolvedVersion,
    versionB?: ResolvedVersion,
): void {
    const bounded =
        payload.rows.length > MAX_PERSISTED_ROWS
            ? {
                  ...payload,
                  rows: keepMostSignificantRows(
                      payload.rows,
                      MAX_PERSISTED_ROWS,
                  ),
              }
            : payload;
    void state.update(runStoreKey(agent), {
        payload: bounded,
        runAt,
        ...(provenance ? { provenance } : {}),
        ...(versionA ? { versionA } : {}),
        ...(versionB ? { versionB } : {}),
    } satisfies PersistedRun);
}

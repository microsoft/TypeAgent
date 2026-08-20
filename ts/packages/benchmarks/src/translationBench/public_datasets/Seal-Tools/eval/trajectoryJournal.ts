// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";

export interface SealToolsTrajectoryRecord {
    rowid: string;
    setupid: string;
    scenarioId: string;
    callIndex: number;
    response: unknown;
}

export function sealToolsResponseText(response: unknown): string | undefined {
    if (typeof response !== "object" || response === null) return undefined;
    const data = (response as { data?: unknown }).data;
    return typeof data === "string" ? data : undefined;
}

export function reconcileSealToolsTrajectories(
    trajectoryPath: string,
    setupId: string,
    completedCaseIds: ReadonlySet<string>,
): Map<string, string[]> {
    if (!fs.existsSync(trajectoryPath)) return new Map();
    const text = fs.readFileSync(trajectoryPath, "utf8");
    const lines = text.split("\n");
    const records: SealToolsTrajectoryRecord[] = [];
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index]!;
        if (line.length === 0) continue;
        try {
            records.push(JSON.parse(line) as SealToolsTrajectoryRecord);
        } catch (error) {
            const truncated =
                index === lines.length - 1 && !text.endsWith("\n");
            if (truncated) break;
            throw new Error(
                `Invalid trajectory JSON at line ${index + 1}: ${String(error)}`,
            );
        }
    }

    const unique = new Map<string, SealToolsTrajectoryRecord>();
    for (const record of records) {
        if (record.setupid === setupId && !completedCaseIds.has(record.rowid)) {
            continue;
        }
        const key = `${record.setupid}\u0000${record.rowid}\u0000${record.scenarioId}\u0000${record.callIndex}`;
        unique.set(key, record);
    }
    const reconciled = [...unique.values()];
    const rewritePath = `${trajectoryPath}.${process.pid}.rewrite`;
    fs.writeFileSync(
        rewritePath,
        reconciled.map((record) => JSON.stringify(record)).join("\n") +
            (reconciled.length === 0 ? "" : "\n"),
        "utf8",
    );
    const rewriteFd = fs.openSync(rewritePath, "r");
    try {
        fs.fsyncSync(rewriteFd);
    } finally {
        fs.closeSync(rewriteFd);
    }
    fs.renameSync(rewritePath, trajectoryPath);

    const responsesByCase = new Map<string, string[]>();
    for (const record of reconciled) {
        if (record.setupid !== setupId) continue;
        const response = sealToolsResponseText(record.response);
        if (response === undefined) continue;
        const responses = responsesByCase.get(record.rowid) ?? [];
        responses.push(response);
        responsesByCase.set(record.rowid, responses);
    }
    return responsesByCase;
}

export function assertSuccessfulTrajectoryCoverage<
    T extends { caseId: string },
>(
    successfulRows: readonly T[] | ReadonlySet<string>,
    responsesByCase: ReadonlyMap<string, readonly string[]>,
    isUsable: (row: T, responses: readonly string[] | undefined) => boolean = (
        _row,
        responses,
    ) => (responses?.length ?? 0) > 0,
): void {
    const rows = Array.isArray(successfulRows)
        ? successfulRows
        : [...successfulRows].map((caseId) => ({ caseId }) as T);
    const missing = rows.filter(
        (row) => !isUsable(row, responsesByCase.get(row.caseId)),
    );
    if (missing.length > 0) {
        throw new Error(
            `Checkpoint has ${missing.length} successful row(s) without raw trajectories that are parseable and complete; use a fresh --out-dir.`,
        );
    }
}

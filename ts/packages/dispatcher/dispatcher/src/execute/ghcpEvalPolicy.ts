// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { isGhcpEvalArtifact } from "./ghcpEvalArtifacts.js";

let executionFailureObserved = false;

export function markGhcpEvalExecutionFailure(recoverable = false): void {
    if (process.env.TYPEAGENT_GHCP_EVAL_FIXTURES !== undefined && !recoverable)
        executionFailureObserved = true;
}

export function ghcpEvalExecutionStopped(): boolean {
    return (
        process.env.TYPEAGENT_GHCP_EVAL_FIXTURES !== undefined &&
        executionFailureObserved
    );
}

export function recordGhcpEvalEvent(event: string, detail?: unknown): void {
    const file = process.env.TYPEAGENT_GHCP_EVAL_TRACE;
    if (!file) return;
    fs.appendFileSync(
        file,
        JSON.stringify({
            event,
            detail,
            processId: process.pid,
            monotonicMs: performance.now(),
            timestamp: new Date().toISOString(),
        }) + "\n",
    );
}

const reads = new Map<string, Set<string>>([
    ["github-cli", new Set(["prView", "prFiles", "prChecks", "issueView"])],
    [
        "ipconfig",
        new Set([
            "displayFullConfigurationInformation",
            "displayDNSResolverCacheContents",
        ]),
    ],
]);

export function isGhcpEvalReadOnlyAction(
    schemaName: string,
    actionName: string,
): boolean {
    return (
        reads.get(schemaName)?.has(actionName) === true ||
        (schemaName === "powershell.powershell-files" &&
            actionName === "readFile") ||
        (schemaName === "list" &&
            (actionName === "getList" || actionName === "listLists"))
    );
}

// An ordinary I/O failure is positive evidence, unlike an absent SDK error.
// Authorization, cancellation and uncertain delivery always take precedence.
export function isGhcpEvalRecoverableReadError(error: unknown): boolean {
    return (
        typeof error === "string" &&
        !/\b(denied|access_denied|permission_denied|unauthorized|forbidden|permission|policy|sandbox|rejected|EACCES|EPERM|401|403|cancel(?:led|ed|lation)?|execution_uncertain|uncertain|abort(?:ed)?)\b/i.test(
            error,
        ) &&
        /\b(ENOENT|ENOTDIR|EISDIR|ETIMEDOUT|ECONNRESET|EAI_AGAIN)\b/.test(error)
    );
}

/** Apply only to an explicitly isolated evaluation server, never normal sessions. */
export function assertGhcpEvalAction(
    schemaName: string,
    actionName: string,
    parameters: unknown,
    fixtureRoot = process.env.TYPEAGENT_GHCP_EVAL_FIXTURES,
): void {
    if (fixtureRoot === undefined) return;
    if (ghcpEvalExecutionStopped())
        throw new Error(
            "GHCP eval stopped execution after a failed or cancelled action",
        );
    if (
        schemaName === "list" ||
        schemaName === "dispatcher" ||
        schemaName.startsWith("dispatcher.") ||
        reads.get(schemaName)?.has(actionName)
    ) {
        return;
    }
    if (
        schemaName === "powershell.powershell-files" &&
        actionName === "readFile" &&
        typeof parameters === "object" &&
        parameters !== null &&
        "path" in parameters &&
        typeof parameters.path === "string"
    ) {
        const requested = fs.realpathSync(parameters.path).toLowerCase();
        const allowed = ["report-a.txt", "report-b.txt", "trip.txt"].map(
            (file) =>
                fs.realpathSync(path.join(fixtureRoot, file)).toLowerCase(),
        );
        if (allowed.includes(requested) || isGhcpEvalArtifact(parameters.path))
            return;
    }
    recordGhcpEvalEvent("action.denied", { schemaName, actionName });
    markGhcpEvalExecutionFailure();
    throw new Error(
        `GHCP eval policy denied ${schemaName}.${actionName} before execution`,
    );
}

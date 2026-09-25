// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { isGhcpEvalArtifact } from "./ghcpEvalArtifacts.js";
import {
    ghcpEvalFileActionAllowed,
    readGhcpEvalFilePolicy,
} from "./ghcpEvalFiles.js";

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
            (actionName === "readFile" || actionName === "listFiles")) ||
        (schemaName === "list" &&
            (actionName === "getList" || actionName === "listLists"))
    );
}

// An ordinary I/O failure is positive evidence, unlike an absent SDK error.
// Authorization, cancellation and uncertain delivery always take precedence.
export function isGhcpEvalRecoverableReadError(error: unknown): boolean {
    return (
        typeof error === "string" &&
        !/(deni(?:ed|al)|unauthoriz|forbidden|permission|policy|sandbox|reject|EACCES|EPERM|\b401\b|\b403\b|cancel|uncertain|abort)/i.test(
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
        (schemaName === "list" &&
            (!process.env.TYPEAGENT_GHCP_EVAL_FILE_POLICY ||
                (actionName === "listLists" &&
                    readGhcpEvalFilePolicy()?.allowListInventory === true))) ||
        schemaName === "dispatcher" ||
        schemaName.startsWith("dispatcher.") ||
        reads.get(schemaName)?.has(actionName)
    ) {
        return;
    }
    if (
        schemaName === "powershell.powershell-files" &&
        typeof parameters === "object" &&
        parameters !== null
    ) {
        const policy = readGhcpEvalFilePolicy();
        if (
            policy &&
            ghcpEvalFileActionAllowed(
                actionName,
                parameters as Record<string, unknown>,
                fixtureRoot,
                policy,
            )
        )
            return;
        if (
            actionName === "readFile" &&
            "path" in parameters &&
            typeof parameters.path === "string"
        ) {
            if (isGhcpEvalArtifact(parameters.path)) return;
            if (!policy) {
                const requested = fs
                    .realpathSync(parameters.path)
                    .toLowerCase();
                const allowed = [
                    "report-a.txt",
                    "report-b.txt",
                    "trip.txt",
                ].map((file) =>
                    fs.realpathSync(path.join(fixtureRoot, file)).toLowerCase(),
                );
                if (allowed.includes(requested)) return;
            }
        }
    }
    recordGhcpEvalEvent("action.denied", { schemaName, actionName });
    markGhcpEvalExecutionFailure();
    throw new Error(
        `GHCP eval policy denied ${schemaName}.${actionName} before execution`,
    );
}

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

export function markGhcpEvalExecutionFailure(): void {
    if (process.env.TYPEAGENT_GHCP_EVAL_FIXTURES !== undefined)
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

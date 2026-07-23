// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    isTypeAgentVariant,
    type RunManifest,
    type RunResult,
} from "./types.js";

export type RunIdentity = Pick<
    RunManifest,
    "runId" | "taskIds" | "matrix" | "variants" | "agent"
>;

export function validateResultRows(
    rows: RunResult[],
    identity: RunIdentity,
): void {
    const taskIds = new Set(identity.taskIds);
    if (taskIds.size !== identity.taskIds.length) {
        throw new Error("Manifest taskIds must be unique");
    }

    const models = new Map<string, string>();
    for (const entry of identity.matrix) {
        const matrixName = entry.name ?? entry.model;
        if (models.has(matrixName)) {
            throw new Error(
                `Manifest matrix name is duplicated: ${matrixName}`,
            );
        }
        models.set(matrixName, entry.model);
    }
    const variants = new Set(identity.variants);

    rows.forEach((row, index) => {
        const prefix = `Invalid results row ${index + 1}`;
        if (row.runId !== identity.runId) {
            throw new Error(
                `${prefix}: runId ${JSON.stringify(row.runId)} does not match ${JSON.stringify(identity.runId)}`,
            );
        }
        if (!taskIds.has(row.taskId)) {
            throw new Error(
                `${prefix}: unknown taskId ${JSON.stringify(row.taskId)}`,
            );
        }
        const expectedModel = models.get(row.matrixName);
        if (!expectedModel) {
            throw new Error(
                `${prefix}: unknown matrixName ${JSON.stringify(row.matrixName)}`,
            );
        }
        if (row.model !== expectedModel) {
            throw new Error(
                `${prefix}: model ${JSON.stringify(row.model)} does not match matrix ${JSON.stringify(row.matrixName)} model ${JSON.stringify(expectedModel)}`,
            );
        }
        if (!variants.has(row.variant)) {
            throw new Error(
                `${prefix}: unknown variant ${JSON.stringify(row.variant)}`,
            );
        }
        if (
            row.ok &&
            (row.defaultMainAgent !== true ||
                row.selectedAgentName !== undefined)
        ) {
            throw new Error(
                `${prefix}: session did not retain the default main agent; selected=${JSON.stringify(row.selectedAgentName)}`,
            );
        }
        if (row.swebench.instanceId !== row.taskId) {
            throw new Error(
                `${prefix}: SWE-bench instanceId does not match taskId ${JSON.stringify(row.taskId)}`,
            );
        }
        if (row.ok && isTypeAgentVariant(row.variant)) {
            if (
                (row.attemptedExploreCalls ?? 0) < 1 ||
                (row.completedExploreCalls ?? 0) < 1 ||
                row.successfulExploreCalls !== 1 ||
                row.outsideExploreInspection !== false ||
                row.mcpServerReady !== true ||
                row.mcpAdopted !== true ||
                row.exploreTelemetry?.status !== "completed" ||
                row.mcpToolTrace.filter(
                    (call) =>
                        call.server === "typeagent" &&
                        call.tool === "explore" &&
                        call.completed === true &&
                        call.success === true,
                ).length !== 1 ||
                row.mcpAdvertisedTools?.length !== 1 ||
                row.mcpAdvertisedTools[0] !== "explore" ||
                row.attemptedExplorerDelegations !== 0 ||
                row.completedExplorerDelegations !== 0 ||
                row.successfulExplorerDelegations !== 0 ||
                row.subagentAdopted !== false ||
                row.mainAgentRepositoryInspection !== false ||
                row.explorerSubagentTrace.length !== 0
            ) {
                throw new Error(
                    `${prefix}: successful TypeAgent treatment lacks exactly one successful exclusive explore invocation`,
                );
            }
            if (
                row.variant === "typeagent-lsp" &&
                (row.lspAdopted !== true ||
                    (row.lspCallCount ?? 0) < 1 ||
                    !row.typeAgentToolTrace?.calls.some(
                        (call) =>
                            call.tool === "lsp" && call.error === undefined,
                    ))
            ) {
                throw new Error(
                    `${prefix}: successful TypeAgent with LSP treatment lacks language-server adoption`,
                );
            }
        }
        if (row.ok && row.variant === "baseline") {
            if (row.mcpAdopted) {
                throw new Error(
                    `${prefix}: successful baseline unexpectedly adopted MCP`,
                );
            }
            if (
                row.subagentAdopted !== true ||
                (row.attemptedExplorerDelegations ?? 0) < 1 ||
                row.completedExplorerDelegations !== 1 ||
                row.successfulExplorerDelegations !== 1 ||
                row.mainAgentRepositoryInspection !== false ||
                row.explorerSubagentTrace.filter(
                    (call) =>
                        call.agentName === identity.agent.name &&
                        call.started === true &&
                        call.completed === true &&
                        call.success === true,
                ).length !== 1
            ) {
                throw new Error(
                    `${prefix}: successful baseline lacks exactly one successful explorer subagent delegation`,
                );
            }
        }
    });
}

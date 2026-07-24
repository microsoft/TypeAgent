// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { isDeepStrictEqual } from "node:util";
import {
    isTypeAgentVariant,
    type RunManifest,
    type RunResult,
    type TokenUsage,
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
        if (row.swebench.instanceId !== row.taskId) {
            throw new Error(
                `${prefix}: SWE-bench instanceId does not match taskId ${JSON.stringify(row.taskId)}`,
            );
        }
        if (row.ok && isTypeAgentVariant(row.variant)) {
            validateDirectTypeAgentRow(row, prefix);
        }
        if (row.ok && row.variant === "baseline") {
            if (
                row.defaultMainAgent !== true ||
                row.selectedAgentName !== undefined
            ) {
                throw new Error(
                    `${prefix}: session did not retain the default main agent; selected=${JSON.stringify(row.selectedAgentName)}`,
                );
            }
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
                (row.explorerRepositoryCalls ?? 0) < 1 ||
                row.firstAssistantActionExclusiveExplorer !== true ||
                row.explorerCompletedBeforeLaterAssistantAction !== true ||
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
                    `${prefix}: successful baseline lacks required Explorer delegation and execution integrity`,
                );
            }
        }
    });
}

function validateDirectTypeAgentRow(row: RunResult, prefix: string): void {
    const evidence = row.typeAgentDispatch;
    if (
        !evidence ||
        evidence.ingress !== "natural-language" ||
        evidence.submittedRequest !== row.query ||
        evidence.translationInvoked !== true ||
        evidence.translationRequestCount !== 1 ||
        !isOnlyExplorer(evidence.activeAgentNames) ||
        !isOnlyExplorer(evidence.activeSchemaNames)
    ) {
        throw new Error(
            `${prefix}: successful direct TypeAgent row lacks untouched natural-language translation evidence`,
        );
    }

    const action = evidence.translatedActions[0];
    if (
        evidence.translatedActions.length !== 1 ||
        action?.schemaName !== "explorer" ||
        action.actionName !== "exploreRepository" ||
        evidence.executionCount !== 1 ||
        evidence.outputMatchedExecution !== true ||
        evidence.executionRequestMatchedIngress !== true
    ) {
        throw new Error(
            `${prefix}: successful direct TypeAgent row lacks one matching executed Explorer action`,
        );
    }

    if (
        evidence.usedCopilot !== false ||
        evidence.usedMcp !== false ||
        row.mcpAdopted !== false ||
        row.attemptedExploreCalls !== 0 ||
        row.completedExploreCalls !== 0 ||
        row.successfulExploreCalls !== 0 ||
        row.outsideExploreInspection !== false ||
        row.mcpServerReady !== false ||
        row.mcpAdvertisedTools?.length !== 0 ||
        row.mcpToolTrace.length !== 0 ||
        row.subagentAdopted !== false ||
        row.attemptedExplorerDelegations !== 0 ||
        row.completedExplorerDelegations !== 0 ||
        row.successfulExplorerDelegations !== 0 ||
        row.failedExplorerDelegations !== 0 ||
        row.mainAgentRepositoryInspection !== false ||
        row.explorerSubagentTrace.length !== 0 ||
        row.toolTrace.length !== 0 ||
        row.events.length !== 0 ||
        row.selectedAgentName !== undefined ||
        row.defaultMainAgent !== false
    ) {
        throw new Error(
            `${prefix}: successful direct TypeAgent row contains Copilot, MCP, or subagent evidence`,
        );
    }

    const telemetry = row.exploreTelemetry;
    const invocation = telemetry?.invocations?.[0];
    if (
        telemetry?.schemaVersion !== 4 ||
        telemetry.status !== "completed" ||
        telemetry.invocations?.length !== 1 ||
        invocation?.status !== "completed" ||
        !invocation.actionTranslationAndCodeGenerationUsage ||
        !isDeepStrictEqual(
            invocation.usage,
            invocation.actionTranslationAndCodeGenerationUsage,
        ) ||
        !isDeepStrictEqual(invocation.usage, telemetry.usage) ||
        !invocation.result ||
        invocation.result.citationCount < 1 ||
        !telemetry.result ||
        !isDeepStrictEqual(invocation.result, telemetry.result) ||
        !matchesExplorerActionSequence(
            invocation.actionAttempts,
            invocation.submissionAction,
        )
    ) {
        throw new Error(
            `${prefix}: successful direct TypeAgent row lacks completed schema-v4 Explorer telemetry`,
        );
    }

    if (
        !row.dispatcherUsage ||
        !row.typeAgentUsage ||
        !row.combinedUsage ||
        row.dispatcherUsage.usageComplete === false ||
        row.typeAgentUsage.usageComplete === false ||
        row.dispatcherUsage.requestCount !== 1 ||
        !hasValidTokenUsage(row.dispatcherUsage) ||
        !hasValidTokenUsage(row.typeAgentUsage) ||
        !hasValidTokenUsage(row.combinedUsage) ||
        !isDeepStrictEqual(row.typeAgentUsage, telemetry.usage) ||
        !isCombinedUsage(
            row.combinedUsage,
            row.dispatcherUsage,
            row.typeAgentUsage,
        )
    ) {
        throw new Error(
            `${prefix}: successful direct TypeAgent row has inconsistent usage evidence`,
        );
    }

    if (
        !row.typeAgentToolTrace ||
        !isDeepStrictEqual(row.typeAgentToolTrace, telemetry.toolTrace) ||
        !row.typeAgentToolTrace.calls.some((call) => call.tool === "grep") ||
        !row.typeAgentToolTrace.calls.every(hasValidRipgrepEvidence)
    ) {
        throw new Error(
            `${prefix}: successful direct TypeAgent row has inconsistent repository-tool evidence`,
        );
    }

    const lspCalls =
        row.typeAgentToolTrace?.calls.filter((call) => call.tool === "lsp") ??
        [];
    const successfulLspCalls = lspCalls.filter(
        (call) => call.error === undefined && call.resultCount > 0,
    ).length;
    const traceLspResultCount = lspCalls.reduce(
        (total, call) => total + call.resultCount,
        0,
    );
    if (
        row.lspCallCount !== lspCalls.length ||
        row.lspResultCount !== traceLspResultCount ||
        (row.variant === "typeagent"
            ? row.lspAdopted !== false ||
              row.lspCallCount !== 0 ||
              row.lspResultCount !== 0 ||
              successfulLspCalls !== 0
            : row.lspAdopted !== true ||
              (row.lspCallCount ?? 0) < 1 ||
              successfulLspCalls < 1)
    ) {
        throw new Error(
            `${prefix}: successful direct TypeAgent row has invalid language-server evidence`,
        );
    }
}

function isOnlyExplorer(names: string[]): boolean {
    return names.length === 1 && names[0] === "explorer";
}

function matchesExplorerActionSequence(
    attempts:
        | Array<{
              index: number;
              actionName: string;
              status: "completed" | "failed";
          }>
        | undefined,
    submissionAction: "refineRepository" | "submitExploration" | undefined,
): boolean {
    if (
        !attempts ||
        !submissionAction ||
        attempts.length < 2 ||
        attempts.some((attempt, index) => attempt.index !== index)
    ) {
        return false;
    }

    let cursor = 0;
    while (
        attempts[cursor]?.actionName === "discoverRepository" &&
        attempts[cursor].status === "failed"
    ) {
        cursor += 1;
    }
    if (
        attempts[cursor]?.actionName !== "discoverRepository" ||
        attempts[cursor].status !== "completed"
    ) {
        return false;
    }
    cursor += 1;

    while (
        attempts[cursor]?.actionName === "refineRepository" &&
        attempts[cursor].status === "failed"
    ) {
        cursor += 1;
    }
    if (
        attempts[cursor]?.actionName !== "refineRepository" ||
        attempts[cursor].status !== "completed"
    ) {
        return false;
    }
    cursor += 1;

    if (submissionAction === "refineRepository") {
        return cursor === attempts.length;
    }

    const submissions = attempts.slice(cursor);
    return (
        submissions.length > 0 &&
        submissions.every((attempt, index) => {
            const isFinal = index === submissions.length - 1;
            return (
                attempt.actionName === "submitExploration" &&
                attempt.status === (isFinal ? "completed" : "failed")
            );
        })
    );
}

function isCombinedUsage(
    combined: NonNullable<RunResult["combinedUsage"]>,
    dispatcher: NonNullable<RunResult["dispatcherUsage"]>,
    explorer: NonNullable<RunResult["typeAgentUsage"]>,
): boolean {
    return (
        combined.inputTokens ===
            dispatcher.inputTokens + explorer.inputTokens &&
        combined.cachedInputTokens ===
            dispatcher.cachedInputTokens + explorer.cachedInputTokens &&
        combined.cacheWriteTokens ===
            dispatcher.cacheWriteTokens + explorer.cacheWriteTokens &&
        combined.outputTokens ===
            dispatcher.outputTokens + explorer.outputTokens &&
        combined.reasoningOutputTokens ===
            dispatcher.reasoningOutputTokens + explorer.reasoningOutputTokens &&
        combined.totalTokens === dispatcher.totalTokens + explorer.totalTokens
    );
}

function hasValidTokenUsage(usage: TokenUsage): boolean {
    const components = [
        usage.inputTokens,
        usage.cachedInputTokens,
        usage.cacheWriteTokens,
        usage.outputTokens,
        usage.reasoningOutputTokens,
        usage.totalTokens,
    ];
    return (
        components.every((value) => Number.isFinite(value) && value >= 0) &&
        usage.totalTokens === usage.inputTokens + usage.outputTokens
    );
}

function hasValidRipgrepEvidence(
    call: NonNullable<RunResult["typeAgentToolTrace"]>["calls"][number],
): boolean {
    if (call.tool !== "grep") {
        return true;
    }
    if (
        !call.input ||
        typeof call.input !== "object" ||
        Array.isArray(call.input)
    ) {
        return false;
    }
    const input = call.input as Record<string, unknown>;
    return (
        input.engine === "ripgrep" &&
        typeof input.ripgrepPath === "string" &&
        /(?:^|[/\\])rg(?:[.]exe)?$/.test(input.ripgrepPath)
    );
}

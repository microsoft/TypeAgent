// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { TOOL_BUDGET_EXHAUSTED } from "./copilotTools.js";
import { parseFinalAnswer } from "./score.js";
import {
    BENCHMARK_TOOL_CALL_LIMIT,
    isTypeAgentVariant,
    type BenchTask,
    type RunManifest,
    type RunResult,
    type TokenUsage,
} from "./types.js";

export type RunIdentity = Pick<
    RunManifest,
    "runId" | "taskIds" | "matrix" | "variants" | "agent" | "maxAttempts"
> & {
    tasks?: BenchTask[];
};

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
    const expectedTasks = identity.tasks
        ? new Map(identity.tasks.map((task) => [task.id, task]))
        : undefined;
    if (
        expectedTasks &&
        (expectedTasks.size !== identity.tasks!.length ||
            !isDeepStrictEqual(
                identity.tasks!.map((task) => task.id),
                identity.taskIds,
            ))
    ) {
        throw new Error("Run identity tasks must uniquely match taskIds");
    }
    const observedTasks = new Map<string, unknown>();
    const attemptHistories = new Map<string, RunResult[]>();

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
        if (
            !Number.isSafeInteger(row.attempt) ||
            row.attempt < 1 ||
            row.maxAttempts !== identity.maxAttempts ||
            row.attempt > row.maxAttempts
        ) {
            throw new Error(
                `${prefix}: invalid attempt ${row.attempt}/${row.maxAttempts}; expected maxAttempts=${identity.maxAttempts}`,
            );
        }
        const expectedTask = expectedTasks?.get(row.taskId);
        if (expectedTask && !taskMatchesRow(expectedTask, row)) {
            throw new Error(
                `${prefix}: task content does not match the selected cohort`,
            );
        }
        const observedTask = taskIdentity(row);
        const previousTask = observedTasks.get(row.taskId);
        if (
            previousTask !== undefined &&
            !isDeepStrictEqual(previousTask, observedTask)
        ) {
            throw new Error(
                `${prefix}: task content differs across arms or attempts`,
            );
        }
        observedTasks.set(row.taskId, observedTask);
        const attemptKey = `${row.taskId}\0${row.matrixName}\0${row.variant}`;
        const history = attemptHistories.get(attemptKey) ?? [];
        history.push(row);
        attemptHistories.set(attemptKey, history);
        if (isTypeAgentVariant(row.variant) && row.reusedFrom !== undefined) {
            throw new Error(
                `${prefix}: treatment attempts must be executed fresh`,
            );
        }
        if (row.ok && isTypeAgentVariant(row.variant)) {
            validateMcpTypeAgentRow(row, prefix);
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
                    `${prefix}: successful baseline lacks exactly one successful explorer subagent delegation`,
                );
            }
            if (!hasValidOuterUsage(row) || !hasValidRowRipgrep(row)) {
                throw new Error(
                    `${prefix}: successful baseline has invalid usage or ripgrep provenance`,
                );
            }
        }
    });

    for (const history of attemptHistories.values()) {
        history.forEach((row, index) => {
            if (row.attempt !== index + 1) {
                throw new Error(
                    `Invalid attempt history for ${row.taskId}/${row.matrixName}/${row.variant}: expected attempt ${index + 1}, observed ${row.attempt}`,
                );
            }
            if (index < history.length - 1 && row.ok) {
                throw new Error(
                    `Invalid attempt history for ${row.taskId}/${row.matrixName}/${row.variant}: successful attempt ${row.attempt} is not terminal`,
                );
            }
        });
    }
}

function validateMcpTypeAgentRow(row: RunResult, prefix: string): void {
    if (
        row.typeAgentDispatch !== undefined ||
        row.defaultMainAgent !== true ||
        row.selectedAgentName !== undefined ||
        row.mcpServerReady !== true ||
        row.mcpAdopted !== true ||
        row.reusedFrom !== undefined ||
        row.mcpAdvertisedTools?.length !== 1 ||
        row.mcpAdvertisedTools[0] !== "explore" ||
        row.attemptedExploreCalls !== 1 ||
        row.completedExploreCalls !== 1 ||
        row.successfulExploreCalls !== 1 ||
        row.outerLoopAbortedAfterExplore !== true ||
        row.usedRepair === true ||
        row.firstAssistantActionExclusiveExplore !== true ||
        row.exploreCompletedBeforeLaterAssistantAction !== true ||
        row.outsideExploreInspection !== false ||
        row.subagentAdopted !== false ||
        row.attemptedExplorerDelegations !== 0 ||
        row.completedExplorerDelegations !== 0 ||
        row.successfulExplorerDelegations !== 0 ||
        row.failedExplorerDelegations !== 0 ||
        row.mainAgentRepositoryInspection !== false ||
        row.explorerSubagentTrace.length !== 0 ||
        row.toolTrace.length !== 0
    ) {
        throw new Error(
            `${prefix}: successful Copilot MCP TypeAgent row lacks exclusive default-main-agent routing evidence`,
        );
    }

    const successfulCalls = row.mcpToolTrace.filter(
        (call) =>
            call.server === "typeagent" &&
            call.tool === "explore" &&
            call.completed === true &&
            call.success === true,
    );
    const successfulArguments = recordValue(successfulCalls[0]?.arguments);
    if (
        row.mcpToolTrace.length !== 1 ||
        successfulCalls.length !== 1 ||
        !successfulArguments ||
        Object.prototype.hasOwnProperty.call(successfulArguments, "query") ||
        mcpRelayValidationError(
            row.finalAnswer,
            successfulCalls[0]?.result,
            row.repoPath,
        )
    ) {
        throw new Error(
            `${prefix}: successful Copilot MCP TypeAgent row used a model-authored query or changed the Explorer result`,
        );
    }

    const telemetry = row.exploreTelemetry;
    const invocation = telemetry?.invocations?.[0];
    const hasExpectedExplorerTraces = matchesExplorerTraces(
        invocation?.reasoningTrace,
        invocation?.actionAttempts,
    );
    if (
        telemetry?.schemaVersion !== 4 ||
        telemetry.model !== row.model ||
        telemetry.status !== "completed" ||
        telemetry.invocations?.length !== 1 ||
        invocation?.status !== "completed" ||
        invocation.querySha256 !==
            createHash("sha256").update(row.query, "utf8").digest("hex") ||
        !invocation.actionTranslationAndCodeGenerationUsage ||
        !isDeepStrictEqual(
            invocation.usage,
            invocation.actionTranslationAndCodeGenerationUsage,
        ) ||
        !isDeepStrictEqual(invocation.usage, telemetry.usage) ||
        invocation.usage.requestCount < 3 ||
        invocation.usage.requestCount > 5 ||
        invocation.usage.requestCount !== invocation.reasoningTrace?.length ||
        !hasExpectedExplorerTraces ||
        !invocation.result ||
        invocation.result.citationCount < 1 ||
        !telemetry.result ||
        !isDeepStrictEqual(invocation.result, telemetry.result)
    ) {
        throw new Error(
            `${prefix}: successful Copilot MCP TypeAgent row lacks completed schema-v4 Explorer telemetry`,
        );
    }

    if (
        row.dispatcherUsage !== undefined ||
        !row.usage ||
        !row.typeAgentUsage ||
        !row.combinedUsage ||
        row.usage.usageComplete !== true ||
        row.typeAgentUsage.usageComplete !== true ||
        row.usage.models.length !== 1 ||
        row.usage.models[0] !== row.model ||
        row.usage.requestCount !== 1 ||
        !hasValidTokenUsage(row.usage) ||
        !hasValidTokenUsage(row.typeAgentUsage) ||
        !hasValidTokenUsage(row.combinedUsage) ||
        !isDeepStrictEqual(row.typeAgentUsage, telemetry.usage) ||
        !isCombinedUsage(row.combinedUsage, row.usage, row.typeAgentUsage)
    ) {
        throw new Error(
            `${prefix}: successful Copilot MCP TypeAgent row has inconsistent usage evidence`,
        );
    }

    if (!hasValidOuterAbortEvidence(row)) {
        throw new Error(
            `${prefix}: successful Copilot MCP TypeAgent row lacks ordered outer abort evidence`,
        );
    }

    const repositoryCalls = row.typeAgentToolTrace?.calls ?? [];
    const evidenceCalls = repositoryCalls.filter((call) => call.tool !== "lsp");
    if (
        !row.typeAgentToolTrace ||
        !isDeepStrictEqual(row.typeAgentToolTrace, telemetry.toolTrace) ||
        evidenceCalls.length > BENCHMARK_TOOL_CALL_LIMIT ||
        !row.typeAgentToolTrace.calls.some(
            (call) => call.tool === "grep" && call.error === undefined,
        ) ||
        !row.typeAgentToolTrace.calls.every((call) =>
            hasValidRipgrepEvidence(call, row),
        ) ||
        !hasValidRowRipgrep(row)
    ) {
        throw new Error(
            `${prefix}: successful Copilot MCP TypeAgent row has invalid ripgrep provenance or inconsistent repository-tool evidence`,
        );
    }

    const lspCalls = repositoryCalls.filter((call) => call.tool === "lsp");
    const adoptedLspCalls = lspCalls.filter((call) => call.discarded !== true);
    const lspResultCount = lspCalls.reduce(
        (total, call) => total + (call.resultCount ?? 0),
        0,
    );
    if (
        row.variant === "typeagent"
            ? row.lspAdopted !== false ||
              row.lspCallCount !== 0 ||
              row.lspResultCount !== 0 ||
              lspCalls.length !== 0
            : row.lspAdopted !== true ||
              row.lspCallCount !== lspCalls.length ||
              row.lspResultCount !== lspResultCount ||
              lspCalls.length > 2 ||
              !lspCalls.every(hasValidPinnedLspEvidence) ||
              adoptedLspCalls.length < 1
    ) {
        throw new Error(
            `${prefix}: successful Copilot MCP TypeAgent row has invalid language-server evidence`,
        );
    }
}

function hasValidPinnedLspEvidence(
    call: NonNullable<RunResult["typeAgentToolTrace"]>["calls"][number],
): boolean {
    if (call.error !== undefined) {
        return true;
    }
    const input = recordValue(call.input);
    const serverId = input?.serverId;
    const languageId = input?.languageId;
    return serverId === "pylsp"
        ? languageId === "python"
        : serverId === "typescript" &&
              new Set([
                  "javascript",
                  "javascriptreact",
                  "typescript",
                  "typescriptreact",
              ]).has(String(languageId));
}

function hasValidOuterAbortEvidence(row: RunResult): boolean {
    const successfulCall = row.mcpToolTrace.find(
        (call) =>
            call.server === "typeagent" &&
            call.tool === "explore" &&
            call.success === true,
    );
    if (!successfulCall) {
        return false;
    }
    const completionIndex = row.events.findIndex((event) => {
        const data = recordValue(event.data);
        return (
            event.type === "tool.execution_complete" &&
            data?.toolCallId === successfulCall.toolCallId &&
            data.success === true
        );
    });
    const abortIndex = row.events.findIndex(
        (event, index) => index > completionIndex && event.type === "abort",
    );
    const idleIndex = row.events.findIndex((event, index) => {
        const data = recordValue(event.data);
        return (
            index > abortIndex &&
            event.type === "session.idle" &&
            data?.aborted === true
        );
    });
    return (
        completionIndex >= 0 &&
        abortIndex > completionIndex &&
        idleIndex > abortIndex
    );
}

function matchesExplorerTraces(
    reasoningAttempts:
        | Array<{
              index: number;
              tool: string;
              actionName?: string;
              status: "completed" | "failed";
              error?: string;
          }>
        | undefined,
    actionAttempts:
        | Array<{
              index: number;
              actionName: string;
              status: "completed" | "failed";
              error?: string;
          }>
        | undefined,
): boolean {
    const expectedCompletedActions = [
        "discoverRepository",
        "refineRepository",
        "submitExploration",
    ] as const;
    if (
        !reasoningAttempts ||
        !actionAttempts ||
        reasoningAttempts.length < expectedCompletedActions.length ||
        reasoningAttempts.length > 5 ||
        actionAttempts.length !== reasoningAttempts.length
    ) {
        return false;
    }
    let expectedActionIndex = 0;
    for (let index = 0; index < reasoningAttempts.length; index++) {
        const reasoning = reasoningAttempts[index];
        const action = actionAttempts[index];
        const expectedAction = expectedCompletedActions[expectedActionIndex];
        if (
            reasoning.index === index &&
            reasoning.tool === "execute_action" &&
            reasoning.actionName === expectedAction &&
            action.index === index &&
            action.actionName === reasoning.actionName &&
            action.status === reasoning.status &&
            action.error === reasoning.error &&
            (reasoning.status === "completed"
                ? reasoning.error === undefined
                : typeof reasoning.error === "string" &&
                  reasoning.error.length > 0)
        ) {
            if (reasoning.status === "completed") {
                expectedActionIndex += 1;
            }
            continue;
        }
        return false;
    }
    return (
        expectedActionIndex === expectedCompletedActions.length &&
        reasoningAttempts.at(-1)?.actionName === "submitExploration" &&
        reasoningAttempts.at(-1)?.status === "completed"
    );
}

function isCombinedUsage(
    combined: NonNullable<RunResult["combinedUsage"]>,
    outer: NonNullable<RunResult["usage"]>,
    explorer: NonNullable<RunResult["typeAgentUsage"]>,
): boolean {
    return (
        combined.inputTokens === outer.inputTokens + explorer.inputTokens &&
        combined.cachedInputTokens ===
            outer.cachedInputTokens + explorer.cachedInputTokens &&
        combined.cacheWriteTokens ===
            outer.cacheWriteTokens + explorer.cacheWriteTokens &&
        combined.outputTokens === outer.outputTokens + explorer.outputTokens &&
        combined.reasoningOutputTokens ===
            outer.reasoningOutputTokens + explorer.reasoningOutputTokens &&
        combined.totalTokens === outer.totalTokens + explorer.totalTokens
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
    row: RunResult,
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
        input.ripgrepPath === row.ripgrepPath &&
        input.ripgrepSha256 === row.ripgrepSha256
    );
}

function hasValidOuterUsage(row: RunResult): boolean {
    return Boolean(
        row.usage &&
            row.usage.usageComplete === true &&
            row.usage.models.length === 1 &&
            row.usage.models[0] === row.model &&
            hasValidTokenUsage(row.usage) &&
            row.combinedUsage &&
            isDeepStrictEqual(row.combinedUsage, row.usage),
    );
}

function hasValidRowRipgrep(row: RunResult): boolean {
    if (
        typeof row.ripgrepPath !== "string" ||
        !/(?:^|[/\\])rg(?:[.]exe)?$/u.test(row.ripgrepPath) ||
        typeof row.ripgrepSha256 !== "string" ||
        !/^[a-f0-9]{64}$/u.test(row.ripgrepSha256)
    ) {
        return false;
    }
    const grepCalls = row.toolTrace.filter((call) => call.tool === "grep");
    if (grepCalls.length === 0) {
        return isTypeAgentVariant(row.variant);
    }
    const hasValidExecution = (call: (typeof grepCalls)[number]) =>
        call.execution?.engine === "ripgrep" &&
        call.execution.executable === row.ripgrepPath &&
        call.execution.ripgrepSha256 === row.ripgrepSha256;
    return (
        grepCalls.some((call) => call.ok && hasValidExecution(call)) &&
        grepCalls.every(
            (call) =>
                (call.execution === undefined &&
                    call.output === TOOL_BUDGET_EXHAUSTED) ||
                (!call.ok && call.execution === undefined) ||
                hasValidExecution(call),
        )
    );
}

function mcpRelayValidationError(
    finalAnswer: string,
    result: unknown,
    repoPath?: string,
): string | undefined {
    const innerText = extractMcpResultText(result);
    if (!innerText) {
        return "TypeAgent MCP result did not contain text evidence.";
    }
    if (finalAnswer !== `<final_answer>\n${innerText}\n</final_answer>`) {
        return "TypeAgent MCP relay changed the Explorer result text.";
    }
    const inner = parseFinalAnswer(
        innerText.includes("<final_answer>")
            ? innerText
            : `<final_answer>\n${innerText}\n</final_answer>`,
        repoPath,
    );
    const outer = parseFinalAnswer(finalAnswer, repoPath);
    if (
        !inner.valid ||
        inner.nBrokenLines > 0 ||
        inner.citations.length === 0 ||
        !outer.valid ||
        outer.nBrokenLines > 0 ||
        outer.citations.length === 0
    ) {
        return "TypeAgent MCP relay contains malformed locations.";
    }
    const identity = (citation: {
        path: string;
        startLine: number;
        endLine: number;
    }) => `${citation.path}\0${citation.startLine}\0${citation.endLine}`;
    const expected = inner.citations.map(identity);
    const actual = outer.citations.map(identity);
    return isDeepStrictEqual(expected, actual)
        ? undefined
        : "TypeAgent MCP relay changed Explorer locations.";
}

function taskMatchesRow(task: BenchTask, row: RunResult): boolean {
    return (
        row.taskId === task.id &&
        row.rowIndex === task.swebench.rowIndex &&
        row.repoPath === task.repoPath &&
        row.query === task.query &&
        isDeepStrictEqual(row.swebench, task.swebench)
    );
}

function taskIdentity(row: RunResult): unknown {
    return {
        rowIndex: row.rowIndex,
        repoPath: row.repoPath,
        query: row.query,
        swebench: row.swebench,
    };
}

function extractMcpResultText(value: unknown): string | undefined {
    if (typeof value === "string") {
        return value;
    }
    const record = recordValue(value);
    if (typeof record?.content === "string") {
        return record.content;
    }
    if (Array.isArray(record?.content)) {
        const text = record.content
            .map((item) => recordValue(item)?.text)
            .filter((item): item is string => typeof item === "string")
            .join("\n");
        return text || undefined;
    }
    return undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

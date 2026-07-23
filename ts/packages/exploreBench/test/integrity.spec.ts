// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import { validateResultRows, type RunIdentity } from "../src/integrity.js";
import { scoreSwebench } from "../src/score.js";
import type { RunResult } from "../src/types.js";

const identity: RunIdentity = {
    runId: "run-a",
    taskIds: ["repo__repo-1"],
    matrix: [{ name: "matrix-a", model: "route-a" }],
    variants: ["baseline", "typeagent"],
    agent: {
        name: "explorer",
        description: "benchmark explorer",
        tools: ["read", "grep", "glob", "bash"],
        prompt: "explore only",
        file: "/repo/.copilot/agents/explorer.md",
        sha256: "a".repeat(64),
    },
};

const row: RunResult = {
    runId: "run-a",
    taskId: "repo__repo-1",
    rowIndex: 0,
    matrixName: "matrix-a",
    model: "route-a",
    variant: "baseline",
    provider: {
        type: "openai-compatible",
        baseUrl: "http://localhost:4627/v1",
        apiKeyEnv: "CUSTOM_PROVIDER_API_KEY",
        hasApiKey: true,
        wireApi: "responses",
    },
    repoPath: "/repo",
    query: "find bug",
    swebench: {
        dataset: "princeton-nlp/SWE-bench_Verified",
        split: "test",
        rowIndex: 0,
        instanceId: "repo__repo-1",
        patch: "",
        dockerImage: "image",
    },
    ok: true,
    durationMs: 1,
    attempt: 1,
    maxAttempts: 2,
    finalAnswer: "<final_answer>\npkg/a.py:1 reason\n</final_answer>",
    score: scoreSwebench("", ""),
    mcpAdopted: false,
    subagentAdopted: true,
    defaultMainAgent: true,
    attemptedExplorerDelegations: 1,
    completedExplorerDelegations: 1,
    successfulExplorerDelegations: 1,
    failedExplorerDelegations: 0,
    mainAgentRepositoryInspection: false,
    explorerSubagentTrace: [
        {
            toolCallId: "task-1",
            agentName: "explorer",
            started: true,
            completed: true,
            success: true,
        },
    ],
    mcpToolTrace: [],
    toolTrace: [],
    events: [],
};

test("accepts rows that belong to the manifest", () => {
    assert.doesNotThrow(() => validateResultRows([row], identity));
});

test("rejects mixed run, task, matrix model, and variant rows", () => {
    for (const invalid of [
        { ...row, runId: "run-b" },
        {
            ...row,
            taskId: "other",
            swebench: { ...row.swebench, instanceId: "other" },
        },
        { ...row, matrixName: "other" },
        { ...row, model: "route-b" },
        { ...row, variant: "other" as RunResult["variant"] },
    ]) {
        assert.throws(
            () => validateResultRows([invalid], identity),
            /Invalid results row 1/,
        );
    }
});

test("rejects successful treatment rows without one exclusive MCP invocation", () => {
    assert.throws(
        () =>
            validateResultRows(
                [
                    {
                        ...row,
                        variant: "typeagent",
                        mcpAdopted: true,
                        subagentAdopted: false,
                        attemptedExplorerDelegations: 0,
                        completedExplorerDelegations: 0,
                        successfulExplorerDelegations: 0,
                        explorerSubagentTrace: [],
                    },
                ],
                identity,
            ),
        /exactly one successful exclusive explore invocation/,
    );
});

test("requires recorded language-server adoption for the LSP treatment", () => {
    const lspIdentity: RunIdentity = {
        ...identity,
        variants: ["typeagent-lsp"],
    };
    const lspCall = {
        tool: "lsp",
        durationMs: 1,
        input: {
            method: "definition",
            path: "pkg/a.py",
            line: 1,
            symbol: "target",
        },
        resultCount: 1,
        outputBytes: 20,
        truncated: false,
    };
    const lspRow: RunResult = {
        ...row,
        variant: "typeagent-lsp",
        mcpAdopted: true,
        lspAdopted: true,
        lspCallCount: 1,
        lspResultCount: 1,
        subagentAdopted: false,
        attemptedExploreCalls: 1,
        completedExploreCalls: 1,
        successfulExploreCalls: 1,
        outsideExploreInspection: false,
        mcpServerReady: true,
        mcpAdvertisedTools: ["explore"],
        attemptedExplorerDelegations: 0,
        completedExplorerDelegations: 0,
        successfulExplorerDelegations: 0,
        explorerSubagentTrace: [],
        mcpToolTrace: [
            {
                toolCallId: "explore-1",
                server: "typeagent",
                tool: "explore",
                completed: true,
                success: true,
            },
        ],
        typeAgentToolTrace: {
            calls: [lspCall],
            totalCalls: 1,
            totalOutputBytes: 20,
        },
        exploreTelemetry: {
            schemaVersion: 1,
            model: "route-a",
            status: "completed",
            usage: {
                requestCount: 1,
                inputTokens: 1,
                cachedInputTokens: 0,
                cacheWriteTokens: 0,
                outputTokens: 1,
                reasoningOutputTokens: 0,
                totalTokens: 2,
            },
            toolTrace: {
                calls: [lspCall],
                totalCalls: 1,
                totalOutputBytes: 20,
            },
        },
    };

    assert.doesNotThrow(() => validateResultRows([lspRow], lspIdentity));
    assert.throws(
        () =>
            validateResultRows([{ ...lspRow, lspAdopted: false }], lspIdentity),
        /language-server adoption/i,
    );
});

test("rejects successful rows that did not retain the default main agent", () => {
    assert.throws(
        () =>
            validateResultRows(
                [
                    {
                        ...row,
                        defaultMainAgent: false,
                        selectedAgentName: "explorer",
                    },
                ],
                identity,
            ),
        /default main agent/i,
    );
});

test("rejects successful baseline rows without one explorer delegation", () => {
    assert.throws(
        () =>
            validateResultRows(
                [
                    {
                        ...row,
                        subagentAdopted: false,
                        attemptedExplorerDelegations: 0,
                        completedExplorerDelegations: 0,
                        successfulExplorerDelegations: 0,
                        explorerSubagentTrace: [],
                    },
                ],
                identity,
            ),
        /exactly one successful explorer subagent delegation/i,
    );
});

test("accepts failed task-schema attempts before one successful delegation", () => {
    assert.doesNotThrow(() =>
        validateResultRows(
            [
                {
                    ...row,
                    attemptedExplorerDelegations: 2,
                    failedExplorerDelegations: 1,
                    explorerSubagentTrace: [
                        {
                            toolCallId: "task-invalid",
                            agentName: "explorer",
                            started: false,
                            completed: false,
                            success: false,
                            error: '"name": Required',
                        },
                        row.explorerSubagentTrace[0],
                    ],
                },
            ],
            identity,
        ),
    );
});

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { TOOL_BUDGET_EXHAUSTED } from "../src/copilotTools.js";
import { validateResultRows, type RunIdentity } from "../src/integrity.js";
import { scoreSwebench } from "../src/score.js";
import type { RunResult, TypeAgentUsage } from "../src/types.js";

const ripgrepPath = "/copilot/ripgrep/bin/darwin-arm64/rg";
const ripgrepSha256 = "a".repeat(64);

const identity: RunIdentity = {
    runId: "run-a",
    maxAttempts: 2,
    taskIds: ["repo__repo-1"],
    matrix: [{ name: "matrix-a", model: "route-a" }],
    variants: ["baseline", "typeagent", "typeagent-lsp"],
    agent: {
        name: "explorer",
        description: "benchmark explorer",
        tools: ["read", "grep", "glob", "bash"],
        prompt: "explore only",
        file: "/repo/.copilot/agents/explorer.md",
        sha256: "b".repeat(64),
    },
    tasks: [
        {
            id: "repo__repo-1",
            repoPath: "/repo",
            query: baseQuery(),
            swebench: {
                dataset: "princeton-nlp/SWE-bench_Verified",
                split: "test",
                rowIndex: 0,
                instanceId: "repo__repo-1",
                patch: "",
                dockerImage: "image",
            },
        },
    ],
};

test("accepts the Copilot subagent baseline and both Copilot MCP treatments", () => {
    assert.doesNotThrow(() =>
        validateResultRows(
            [
                baselineRow(),
                treatmentRow("typeagent"),
                treatmentRow("typeagent-lsp"),
            ],
            identity,
        ),
    );
});

test("keeps LSP calls additive to the eight-call evidence budget", () => {
    const candidate = treatmentRow("typeagent-lsp");
    const trace = candidate.typeAgentToolTrace!;
    trace.calls.push(...Array.from({ length: 6 }, () => readCall()));
    trace.totalCalls = trace.calls.length;
    trace.totalOutputBytes = trace.calls.reduce(
        (total, call) => total + call.outputBytes,
        0,
    );
    candidate.exploreTelemetry!.toolTrace = structuredClone(trace);
    candidate.exploreTelemetry!.invocations![0].toolTrace =
        structuredClone(trace);

    assert.doesNotThrow(() => validateResultRows([candidate], identity));

    trace.calls.push(readCall());
    trace.totalCalls = trace.calls.length;
    trace.totalOutputBytes = trace.calls.reduce(
        (total, call) => total + call.outputBytes,
        0,
    );
    candidate.exploreTelemetry!.toolTrace = structuredClone(trace);
    candidate.exploreTelemetry!.invocations![0].toolTrace =
        structuredClone(trace);
    assert.throws(
        () => validateResultRows([candidate], identity),
        /repository-tool evidence/i,
    );
});

test("rejects mixed run, task, matrix model, and variant rows", () => {
    const row = baselineRow();
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

test("rejects direct-dispatch treatment evidence", () => {
    const candidate = treatmentRow("typeagent");
    candidate.typeAgentDispatch = {
        ingress: "natural-language",
        submittedRequest: candidate.query,
        translationInvoked: false,
        translationRequestCount: 0,
        activeAgentNames: ["explorer"],
        activeSchemaNames: ["explorer"],
        translatedActions: [],
        executionCount: 1,
        outputMatchedExecution: true,
        executionRequestMatchedIngress: true,
        usedCopilot: false,
        usedMcp: false,
    };
    candidate.mcpAdopted = false;
    candidate.mcpServerReady = false;
    candidate.defaultMainAgent = false;

    assert.throws(
        () => validateResultRows([candidate], identity),
        /Copilot MCP/i,
    );
});

test("rejects reused treatment attempts even when they failed", () => {
    const candidate = treatmentRow("typeagent");
    candidate.ok = false;
    candidate.reusedFrom = {
        originalRunId: "old-run",
        sourceRunId: "cache-run",
        resultsPath: "/tmp/results.jsonl",
        importedAt: "2026-07-26T00:00:00.000Z",
    };

    assert.throws(
        () => validateResultRows([candidate], identity),
        /executed fresh/i,
    );
});

test("requires canonical cohort content and contiguous attempt histories", () => {
    const changedQuery = treatmentRow("typeagent");
    changedQuery.query = "different query";
    assert.throws(
        () => validateResultRows([changedQuery], identity),
        /selected cohort/i,
    );

    const failed = baselineRow();
    failed.ok = false;
    const succeeded = baselineRow();
    succeeded.attempt = 2;
    assert.doesNotThrow(() =>
        validateResultRows([failed, succeeded], identity),
    );

    for (const rows of [
        [{ ...failed, attempt: 2 }],
        [failed, { ...succeeded, attempt: 1 }],
        [failed, { ...succeeded, attempt: 3 }],
        [baselineRow(), { ...failed, attempt: 2 }],
    ]) {
        assert.throws(() => validateResultRows(rows, identity), /attempt/i);
    }
});

test("fails closed on every MCP routing and ingress mutation", () => {
    const mutations: Array<{
        name: string;
        apply(candidate: RunResult): void;
    }> = [
        {
            name: "custom agent",
            apply: (row) => (row.defaultMainAgent = false),
        },
        {
            name: "selected agent",
            apply: (row) => (row.selectedAgentName = "explorer"),
        },
        {
            name: "server not ready",
            apply: (row) => (row.mcpServerReady = false),
        },
        { name: "MCP not adopted", apply: (row) => (row.mcpAdopted = false) },
        {
            name: "wrong advertised tool",
            apply: (row) => (row.mcpAdvertisedTools = ["other"]),
        },
        { name: "no attempt", apply: (row) => (row.attemptedExploreCalls = 0) },
        {
            name: "no completion",
            apply: (row) => (row.completedExploreCalls = 0),
        },
        {
            name: "retry attempt",
            apply: (row) => (row.attemptedExploreCalls = 2),
        },
        {
            name: "retry completion",
            apply: (row) => (row.completedExploreCalls = 2),
        },
        {
            name: "no success",
            apply: (row) => (row.successfulExploreCalls = 0),
        },
        {
            name: "missing outer abort",
            apply: (row) => (row.outerLoopAbortedAfterExplore = false),
        },
        { name: "outer repair", apply: (row) => (row.usedRepair = true) },
        {
            name: "duplicate success",
            apply: (row) => (row.successfulExploreCalls = 2),
        },
        {
            name: "outside inspection",
            apply: (row) => (row.outsideExploreInspection = true),
        },
        {
            name: "non-exclusive first action",
            apply: (row) => (row.firstAssistantActionExclusiveExplore = false),
        },
        {
            name: "early later action",
            apply: (row) =>
                (row.exploreCompletedBeforeLaterAssistantAction = false),
        },
        {
            name: "subagent adopted",
            apply: (row) => (row.subagentAdopted = true),
        },
        {
            name: "subagent attempted",
            apply: (row) => (row.attemptedExplorerDelegations = 1),
        },
        {
            name: "main inspection",
            apply: (row) => (row.mainAgentRepositoryInspection = true),
        },
        { name: "missing MCP trace", apply: (row) => (row.mcpToolTrace = []) },
        {
            name: "extra failed MCP call",
            apply: (row) =>
                row.mcpToolTrace.push({
                    toolCallId: "mcp-2",
                    server: "typeagent",
                    tool: "explore",
                    arguments: {},
                    completed: true,
                    success: false,
                }),
        },
        {
            name: "unexpected model-authored query",
            apply: (row) => {
                row.mcpToolTrace[0].arguments = { query: row.query };
            },
        },
        {
            name: "wrong Explorer request digest",
            apply: (row) => {
                const invocation = row.exploreTelemetry?.invocations?.[0];
                if (invocation) {
                    invocation.querySha256 = "0".repeat(64);
                }
            },
        },
        {
            name: "reordered relay",
            apply: (row) => {
                row.finalAnswer =
                    "<final_answer>\npkg/a.py:1\npkg/b.py:2\n</final_answer>";
                row.mcpToolTrace[0].result = {
                    content: "pkg/b.py:2\npkg/a.py:1",
                };
            },
        },
        {
            name: "changed relay",
            apply: (row) => {
                row.finalAnswer =
                    "<final_answer>\npkg/other.py:1\n</final_answer>";
            },
        },
        {
            name: "changed relay text with same citation",
            apply: (row) => {
                row.finalAnswer =
                    "<final_answer>\npkg/a.py:1\n\n</final_answer>";
            },
        },
    ];

    for (const mutation of mutations) {
        const candidate = treatmentRow("typeagent");
        mutation.apply(candidate);
        assert.throws(
            () => validateResultRows([candidate], identity),
            /Copilot MCP/i,
            mutation.name,
        );
    }
});

test("requires ordered outer completion, abort, and aborted-idle events", () => {
    for (const events of [
        [],
        [
            { type: "abort", data: { reason: "user" } },
            {
                type: "tool.execution_complete",
                data: { toolCallId: "mcp-1", success: true },
            },
            { type: "session.idle", data: { aborted: true } },
        ],
        [
            {
                type: "tool.execution_complete",
                data: { toolCallId: "mcp-1", success: true },
            },
            { type: "session.idle", data: { aborted: true } },
        ],
        [
            {
                type: "tool.execution_complete",
                data: { toolCallId: "mcp-1", success: true },
            },
            { type: "abort", data: { reason: "user" } },
            { type: "session.idle", data: { aborted: false } },
        ],
    ]) {
        const candidate = treatmentRow("typeagent");
        candidate.events = events;
        assert.throws(
            () => validateResultRows([candidate], identity),
            /ordered outer abort/i,
        );
    }
});

test("requires complete outer plus inner token accounting", () => {
    const mutations: Array<{
        name: string;
        apply(candidate: RunResult): void;
    }> = [
        { name: "missing outer", apply: (row) => delete row.usage },
        { name: "missing inner", apply: (row) => delete row.typeAgentUsage },
        { name: "missing combined", apply: (row) => delete row.combinedUsage },
        {
            name: "dispatcher usage present",
            apply: (row) => {
                row.dispatcherUsage = usage(1, 1, 1);
            },
        },
        {
            name: "wrong outer model",
            apply: (row) => {
                row.usage!.models = ["other-route"];
            },
        },
        {
            name: "incomplete outer usage",
            apply: (row) => {
                row.usage!.usageComplete = false;
            },
        },
        {
            name: "missing outer completeness",
            apply: (row) => {
                delete row.usage!.usageComplete;
            },
        },
        {
            name: "missing inner completeness",
            apply: (row) => {
                delete row.typeAgentUsage!.usageComplete;
            },
        },
        {
            name: "second outer request",
            apply: (row) => {
                row.usage!.requestCount = 2;
            },
        },
        {
            name: "double counted combined token",
            apply: (row) => {
                row.combinedUsage!.inputTokens += 1;
                row.combinedUsage!.totalTokens += 1;
            },
        },
    ];

    for (const mutation of mutations) {
        const candidate = treatmentRow("typeagent");
        mutation.apply(candidate);
        assert.throws(
            () => validateResultRows([candidate], identity),
            /usage evidence/i,
            mutation.name,
        );
    }
});

test("requires one completed schema-v4 Explorer invocation", () => {
    const mutations: Array<{
        name: string;
        apply(candidate: RunResult): void;
    }> = [
        {
            name: "missing telemetry",
            apply: (row) => delete row.exploreTelemetry,
        },
        {
            name: "legacy schema",
            apply: (row) => (row.exploreTelemetry!.schemaVersion = 3),
        },
        {
            name: "failed aggregate",
            apply: (row) => (row.exploreTelemetry!.status = "failed"),
        },
        {
            name: "duplicate invocation",
            apply: (row) =>
                row.exploreTelemetry!.invocations!.push(
                    structuredClone(row.exploreTelemetry!.invocations![0]),
                ),
        },
        {
            name: "failed invocation",
            apply: (row) =>
                (row.exploreTelemetry!.invocations![0].status = "failed"),
        },
        {
            name: "missing inner request",
            apply: (row) => setInnerRequestCount(row, 2),
        },
        {
            name: "extra inner request",
            apply: (row) => setInnerRequestCount(row, 6),
        },
        {
            name: "wrong telemetry model",
            apply: (row) => {
                row.exploreTelemetry!.model = "other-route";
            },
        },
        {
            name: "missing reasoning trace",
            apply: (row) =>
                delete row.exploreTelemetry!.invocations![0].reasoningTrace,
        },
        {
            name: "mismatched reasoning trace",
            apply: (row) => {
                row.exploreTelemetry!.invocations![0].reasoningTrace![1].actionName =
                    "submitExploration";
            },
        },
        {
            name: "non-contiguous action indexes",
            apply: (row) => {
                row.exploreTelemetry!.invocations![0].actionAttempts![1].index = 2;
            },
        },
        {
            name: "wrong three-request order",
            apply: (row) => {
                setInnerRequestCount(row, 3);
                const invocation = row.exploreTelemetry!.invocations![0];
                invocation.reasoningTrace = [
                    completedReasoningAction(0, "discoverRepository"),
                    completedReasoningAction(1, "submitExploration"),
                    completedReasoningAction(2, "refineRepository"),
                ];
                invocation.actionAttempts = [
                    completedAction(0, "discoverRepository"),
                    completedAction(1, "submitExploration"),
                    completedAction(2, "refineRepository"),
                ];
            },
        },
        {
            name: "legacy compound repair sequence",
            apply: (row) => {
                setInnerRequestCount(row, 3);
                const invocation = row.exploreTelemetry!.invocations![0];
                invocation.reasoningTrace = [
                    completedReasoningAction(0, "discoverRepository"),
                    {
                        ...completedReasoningAction(
                            1,
                            "refineAndSubmitExploration",
                        ),
                        status: "failed",
                        error: "grounding failure",
                    },
                    completedReasoningAction(2, "refineAndSubmitExploration"),
                ];
                invocation.actionAttempts = [
                    completedAction(0, "discoverRepository"),
                    {
                        index: 1,
                        actionName: "refineAndSubmitExploration",
                        status: "failed",
                        error: "grounding failure",
                    },
                    completedAction(2, "refineAndSubmitExploration"),
                ];
            },
        },
        {
            name: "completed action after submission",
            apply: (row) => {
                setInnerRequestCount(row, 4);
                const invocation = row.exploreTelemetry!.invocations![0];
                invocation.reasoningTrace!.push(
                    completedReasoningAction(3, "submitExploration"),
                );
                invocation.actionAttempts!.push(
                    completedAction(3, "submitExploration"),
                );
            },
        },
        {
            name: "failed compound action",
            apply: (row) => {
                const invocation = row.exploreTelemetry!.invocations![0];
                invocation.reasoningTrace![1].status = "failed";
                invocation.actionAttempts![1].status = "failed";
            },
        },
    ];

    for (const mutation of mutations) {
        const candidate = treatmentRow("typeagent");
        mutation.apply(candidate);
        assert.throws(
            () => validateResultRows([candidate], identity),
            /Explorer telemetry/i,
            mutation.name,
        );
    }
});

test("rejects a hidden third request that repairs compound submission", () => {
    const candidate = treatmentRow("typeagent-lsp");
    setInnerRequestCount(candidate, 3);
    const invocation = candidate.exploreTelemetry!.invocations![0];
    invocation.reasoningTrace = [
        completedReasoningAction(0, "discoverRepository"),
        {
            ...completedReasoningAction(1, "refineAndSubmitExploration"),
            status: "failed",
            error: "grounding failed",
        },
        completedReasoningAction(2, "refineAndSubmitExploration"),
    ];
    invocation.actionAttempts = [
        completedAction(0, "discoverRepository"),
        {
            ...completedAction(1, "refineAndSubmitExploration"),
            status: "failed",
            error: "grounding failed",
        },
        completedAction(2, "refineAndSubmitExploration"),
    ];

    assert.throws(
        () => validateResultRows([candidate], identity),
        /Explorer telemetry/i,
    );
});

test("accepts one bounded failed refinement followed by the three completed phases", () => {
    const candidate = treatmentRow("typeagent");
    setInnerRequestCount(candidate, 4);
    const invocation = candidate.exploreTelemetry!.invocations![0];
    invocation.reasoningTrace = [
        completedReasoningAction(0, "discoverRepository"),
        {
            ...completedReasoningAction(1, "refineRepository"),
            status: "failed",
            error: "invalid generated program",
        },
        completedReasoningAction(2, "refineRepository"),
        completedReasoningAction(3, "submitExploration"),
    ];
    invocation.actionAttempts = [
        completedAction(0, "discoverRepository"),
        {
            ...completedAction(1, "refineRepository"),
            status: "failed",
            error: "invalid generated program",
        },
        completedAction(2, "refineRepository"),
        completedAction(3, "submitExploration"),
    ];

    assert.doesNotThrow(() => validateResultRows([candidate], identity));
});

test("requires the shared packaged ripgrep path and digest per row", () => {
    for (const [name, apply] of [
        [
            "wrong treatment path",
            (row: RunResult) =>
                ((
                    row.typeAgentToolTrace!.calls[0].input as Record<
                        string,
                        unknown
                    >
                ).ripgrepPath = "/usr/bin/rg"),
        ],
        [
            "wrong treatment digest",
            (row: RunResult) =>
                ((
                    row.typeAgentToolTrace!.calls[0].input as Record<
                        string,
                        unknown
                    >
                ).ripgrepSha256 = "c".repeat(64)),
        ],
        [
            "wrong baseline digest",
            (row: RunResult) =>
                (row.toolTrace[0].execution!.ripgrepSha256 = "c".repeat(64)),
        ],
    ] as const) {
        const candidate = name.startsWith("wrong baseline")
            ? baselineRow()
            : treatmentRow("typeagent");
        apply(candidate);
        if (candidate.exploreTelemetry && candidate.typeAgentToolTrace) {
            candidate.exploreTelemetry.toolTrace = structuredClone(
                candidate.typeAgentToolTrace,
            );
            candidate.exploreTelemetry.invocations![0].toolTrace =
                structuredClone(candidate.typeAgentToolTrace);
        }
        assert.throws(
            () => validateResultRows([candidate], identity),
            /ripgrep provenance/i,
            name,
        );
    }
});

test("allows a rejected pre-execution baseline grep but requires one valid execution", () => {
    const rejectedGrep = {
        tool: "grep",
        args: { pattern: "" },
        ok: false,
        durationMs: 0,
        output: "",
        error: "pattern must not be empty",
    } as const;
    const withSuccessfulGrep = baselineRow();
    withSuccessfulGrep.toolTrace.push(rejectedGrep, {
        tool: "grep",
        args: { pattern: "more" },
        ok: true,
        durationMs: 0,
        output: TOOL_BUDGET_EXHAUSTED,
    });
    assert.doesNotThrow(() =>
        validateResultRows([withSuccessfulGrep], identity),
    );

    const withoutSuccessfulGrep = baselineRow();
    withoutSuccessfulGrep.toolTrace = [
        rejectedGrep,
        ...withoutSuccessfulGrep.toolTrace.filter(
            (call) => call.tool !== "grep",
        ),
    ];
    assert.throws(
        () => validateResultRows([withoutSuccessfulGrep], identity),
        /ripgrep provenance/i,
    );
});

test("requires mode-correct language-server evidence", () => {
    const plain = treatmentRow("typeagent");
    plain.lspAdopted = true;
    assert.throws(
        () => validateResultRows([plain], identity),
        /language-server/i,
    );

    const lsp = treatmentRow("typeagent-lsp");
    lsp.lspCallCount = 0;
    assert.throws(
        () => validateResultRows([lsp], identity),
        /language-server/i,
    );

    const mismatchedResults = treatmentRow("typeagent-lsp");
    mismatchedResults.lspResultCount = 0;
    assert.throws(
        () => validateResultRows([mismatchedResults], identity),
        /language-server/i,
    );

    const emptyNavigation = treatmentRow("typeagent-lsp");
    const emptyLspCall = emptyNavigation.typeAgentToolTrace!.calls.find(
        (call) => call.tool === "lsp",
    )!;
    emptyLspCall.resultCount = 0;
    emptyNavigation.lspResultCount = 0;
    emptyNavigation.exploreTelemetry!.toolTrace = structuredClone(
        emptyNavigation.typeAgentToolTrace!,
    );
    emptyNavigation.exploreTelemetry!.invocations![0].toolTrace =
        structuredClone(emptyNavigation.typeAgentToolTrace!);
    assert.doesNotThrow(() => validateResultRows([emptyNavigation], identity));

    const readBeforeNavigation = treatmentRow("typeagent-lsp");
    const trace = readBeforeNavigation.typeAgentToolTrace!;
    trace.calls = [trace.calls[0], trace.calls[2], trace.calls[1]];
    readBeforeNavigation.exploreTelemetry!.toolTrace = structuredClone(trace);
    readBeforeNavigation.exploreTelemetry!.invocations![0].toolTrace =
        structuredClone(trace);
    assert.doesNotThrow(() =>
        validateResultRows([readBeforeNavigation], identity),
    );

    const repairedNavigation = treatmentRow("typeagent-lsp");
    const repairedTrace = repairedNavigation.typeAgentToolTrace!;
    repairedTrace.calls.splice(1, 0, {
        ...lspCall(),
        input: {
            method: "definition",
            path: "pkg/a.py",
            line: 1,
            symbol: "target",
        },
        resultCount: 0,
        outputBytes: 0,
        error: "Language-server selection failed",
    });
    repairedTrace.totalCalls = repairedTrace.calls.length;
    repairedNavigation.lspCallCount = 2;
    repairedNavigation.exploreTelemetry!.toolTrace =
        structuredClone(repairedTrace);
    repairedNavigation.exploreTelemetry!.invocations![0].toolTrace =
        structuredClone(repairedTrace);
    assert.doesNotThrow(() =>
        validateResultRows([repairedNavigation], identity),
    );

    const failedNavigation = treatmentRow("typeagent-lsp");
    const failedTrace = failedNavigation.typeAgentToolTrace!;
    const failedCall = failedTrace.calls.find((call) => call.tool === "lsp")!;
    failedCall.resultCount = 0;
    failedCall.outputBytes = 0;
    failedCall.error = "Language-server selection failed";
    failedNavigation.lspCallCount = 1;
    failedNavigation.lspResultCount = 0;
    failedNavigation.exploreTelemetry!.toolTrace = structuredClone(failedTrace);
    failedNavigation.exploreTelemetry!.invocations![0].toolTrace =
        structuredClone(failedTrace);
    assert.doesNotThrow(() => validateResultRows([failedNavigation], identity));

    const discardedNavigation = structuredClone(failedNavigation);
    discardedNavigation.typeAgentToolTrace!.calls.find(
        (call) => call.tool === "lsp",
    )!.discarded = true;
    discardedNavigation.exploreTelemetry!.toolTrace = structuredClone(
        discardedNavigation.typeAgentToolTrace!,
    );
    discardedNavigation.exploreTelemetry!.invocations![0].toolTrace =
        structuredClone(discardedNavigation.typeAgentToolTrace!);
    assert.throws(
        () => validateResultRows([discardedNavigation], identity),
        /language-server/i,
    );

    for (const [name, mutate] of [
        [
            "missing server",
            (call: ReturnType<typeof lspCall>) =>
                delete (call.input as Partial<typeof call.input>).serverId,
        ],
        [
            "unpinned server",
            (call: ReturnType<typeof lspCall>) =>
                (call.input.serverId = "pyright"),
        ],
        [
            "mismatched language",
            (call: ReturnType<typeof lspCall>) =>
                (call.input.languageId = "typescript"),
        ],
    ] as const) {
        const candidate = treatmentRow("typeagent-lsp");
        const call = candidate.typeAgentToolTrace!.calls.find(
            (item) => item.tool === "lsp",
        )! as ReturnType<typeof lspCall>;
        mutate(call);
        candidate.exploreTelemetry!.toolTrace = structuredClone(
            candidate.typeAgentToolTrace!,
        );
        candidate.exploreTelemetry!.invocations![0].toolTrace = structuredClone(
            candidate.typeAgentToolTrace!,
        );
        assert.throws(
            () => validateResultRows([candidate], identity),
            /language-server/i,
            name,
        );
    }
});

test("requires baseline delegation and ordering without constraining main-agent wording", () => {
    for (const [name, apply] of [
        [
            "no repository call",
            (row: RunResult) => (row.explorerRepositoryCalls = 0),
        ],
        [
            "non-exclusive first action",
            (row: RunResult) =>
                (row.firstAssistantActionExclusiveExplorer = false),
        ],
        [
            "early later action",
            (row: RunResult) =>
                (row.explorerCompletedBeforeLaterAssistantAction = false),
        ],
    ] as const) {
        const candidate = baselineRow();
        apply(candidate);
        assert.throws(
            () => validateResultRows([candidate], identity),
            /baseline/i,
            name,
        );
    }

    const synthesized = baselineRow();
    synthesized.explorerSubagentTrace[0].arguments = { prompt: "summary" };
    synthesized.finalAnswer = "<final_answer>\npkg/other.py:1\n</final_answer>";
    assert.doesNotThrow(() => validateResultRows([synthesized], identity));
});

function baselineRow(): RunResult {
    const finalAnswer = "<final_answer>\npkg/a.py:1\n</final_answer>";
    return {
        ...baseRow("baseline", finalAnswer),
        usage: outerUsage(),
        combinedUsage: outerUsage(),
        mcpAdopted: false,
        mcpServerReady: false,
        mcpAdvertisedTools: [],
        attemptedExploreCalls: 0,
        completedExploreCalls: 0,
        successfulExploreCalls: 0,
        outsideExploreInspection: false,
        firstAssistantActionExclusiveExplore: false,
        exploreCompletedBeforeLaterAssistantAction: false,
        subagentAdopted: true,
        defaultMainAgent: true,
        attemptedExplorerDelegations: 1,
        completedExplorerDelegations: 1,
        successfulExplorerDelegations: 1,
        failedExplorerDelegations: 0,
        explorerRepositoryCalls: 2,
        firstAssistantActionExclusiveExplorer: true,
        explorerCompletedBeforeLaterAssistantAction: true,
        mainAgentRepositoryInspection: false,
        explorerSubagentTrace: [
            {
                toolCallId: "task-1",
                agentName: "explorer",
                arguments: { prompt: baseQuery() },
                started: true,
                completed: true,
                success: true,
                resultContent: finalAnswer,
            },
        ],
        mcpToolTrace: [],
        toolTrace: [
            {
                tool: "grep",
                args: { pattern: "bug" },
                ok: true,
                durationMs: 1,
                output: "pkg/a.py:1:bug",
                execution: {
                    engine: "ripgrep",
                    executable: ripgrepPath,
                    ripgrepSha256,
                },
            },
            {
                tool: "read",
                args: { path: "pkg/a.py", offset: 1, limit: 1 },
                ok: true,
                durationMs: 1,
                output: "pkg/a.py:1: bug",
                readRange: { path: "pkg/a.py", startLine: 1, endLine: 1 },
            },
        ],
        events: [],
    };
}

function treatmentRow(variant: "typeagent" | "typeagent-lsp"): RunResult {
    const inner = usage(3, 100, 20);
    const outer = outerUsage();
    const lspCalls = variant === "typeagent-lsp" ? [lspCall()] : [];
    const calls = [grepCall(), ...lspCalls, readCall()];
    const toolTrace = {
        calls,
        totalCalls: calls.length,
        totalOutputBytes: calls.reduce(
            (total, call) => total + call.outputBytes,
            0,
        ),
    };
    return {
        ...baseRow(variant, "<final_answer>\npkg/a.py:1\n</final_answer>"),
        usage: outer,
        typeAgentUsage: inner,
        combinedUsage: {
            inputTokens: outer.inputTokens + inner.inputTokens,
            cachedInputTokens:
                outer.cachedInputTokens + inner.cachedInputTokens,
            cacheWriteTokens: outer.cacheWriteTokens + inner.cacheWriteTokens,
            outputTokens: outer.outputTokens + inner.outputTokens,
            reasoningOutputTokens:
                outer.reasoningOutputTokens + inner.reasoningOutputTokens,
            totalTokens: outer.totalTokens + inner.totalTokens,
        },
        mcpAdopted: true,
        mcpServerReady: true,
        mcpAdvertisedTools: ["explore"],
        attemptedExploreCalls: 1,
        completedExploreCalls: 1,
        successfulExploreCalls: 1,
        outerLoopAbortedAfterExplore: true,
        outsideExploreInspection: false,
        firstAssistantActionExclusiveExplore: true,
        exploreCompletedBeforeLaterAssistantAction: true,
        subagentAdopted: false,
        defaultMainAgent: true,
        attemptedExplorerDelegations: 0,
        completedExplorerDelegations: 0,
        successfulExplorerDelegations: 0,
        failedExplorerDelegations: 0,
        explorerRepositoryCalls: 0,
        firstAssistantActionExclusiveExplorer: false,
        explorerCompletedBeforeLaterAssistantAction: false,
        mainAgentRepositoryInspection: false,
        explorerSubagentTrace: [],
        mcpToolTrace: [
            {
                toolCallId: "mcp-1",
                server: "typeagent",
                tool: "explore",
                arguments: {},
                completed: true,
                success: true,
                result: { content: "pkg/a.py:1" },
            },
        ],
        toolTrace: [],
        events: [
            {
                type: "tool.execution_complete",
                data: { toolCallId: "mcp-1", success: true },
            },
            { type: "abort", data: { reason: "user" } },
            { type: "session.idle", data: { aborted: true } },
        ],
        lspAdopted: variant === "typeagent-lsp",
        lspCallCount: lspCalls.length,
        lspResultCount: lspCalls.reduce(
            (total, call) => total + call.resultCount,
            0,
        ),
        typeAgentToolTrace: structuredClone(toolTrace),
        exploreTelemetry: {
            schemaVersion: 4,
            model: "route-a",
            status: "completed",
            usage: structuredClone(inner),
            toolTrace: structuredClone(toolTrace),
            invocations: [
                {
                    index: 0,
                    status: "completed",
                    querySha256: createHash("sha256")
                        .update(baseQuery(), "utf8")
                        .digest("hex"),
                    usage: structuredClone(inner),
                    actionTranslationAndCodeGenerationUsage:
                        structuredClone(inner),
                    toolTrace: structuredClone(toolTrace),
                    reasoningTrace: [
                        completedReasoningAction(0, "discoverRepository"),
                        completedReasoningAction(1, "refineRepository"),
                        completedReasoningAction(2, "submitExploration"),
                    ],
                    actionAttempts: [
                        completedAction(0, "discoverRepository"),
                        completedAction(1, "refineRepository"),
                        completedAction(2, "submitExploration"),
                    ],
                    result: { citationCount: 1, truncated: false },
                },
            ],
            result: { citationCount: 1, truncated: false },
        },
    };
}

function baseRow(
    variant: RunResult["variant"],
    finalAnswer: string,
): RunResult {
    return {
        runId: "run-a",
        taskId: "repo__repo-1",
        rowIndex: 0,
        matrixName: "matrix-a",
        model: "route-a",
        variant,
        provider: {
            type: "openai-compatible",
            baseUrl: "http://localhost:4627/v1",
            apiKeyEnv: "CUSTOM_PROVIDER_API_KEY",
            hasApiKey: true,
            wireApi: "responses",
        },
        repoPath: "/repo",
        query: baseQuery(),
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
        finalAnswer,
        score: scoreSwebench("", ""),
        ripgrepPath,
        ripgrepSha256,
        mcpAdopted: false,
        subagentAdopted: false,
        defaultMainAgent: true,
        explorerSubagentTrace: [],
        mcpToolTrace: [],
        toolTrace: [],
        events: [],
    };
}

function baseQuery(): string {
    return "find bug\nwith all details";
}

function outerUsage() {
    return {
        source: "assistant.usage" as const,
        requestCount: 1,
        usageComplete: true,
        models: ["route-a"],
        inputTokens: 20,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 5,
        reasoningOutputTokens: 0,
        totalTokens: 25,
    };
}

function usage(
    requestCount: number,
    inputTokens: number,
    outputTokens: number,
): TypeAgentUsage {
    return {
        requestCount,
        usageComplete: true,
        inputTokens,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens,
        reasoningOutputTokens: 0,
        totalTokens: inputTokens + outputTokens,
    };
}

function setInnerRequestCount(row: RunResult, requestCount: number): void {
    const telemetry = row.exploreTelemetry!;
    const invocation = telemetry.invocations![0];
    telemetry.usage.requestCount = requestCount;
    invocation.usage.requestCount = requestCount;
    invocation.actionTranslationAndCodeGenerationUsage!.requestCount =
        requestCount;
    row.typeAgentUsage!.requestCount = requestCount;
}

function completedAction(index: number, actionName: string) {
    return { index, actionName, status: "completed" as const };
}

function completedReasoningAction(index: number, actionName: string) {
    return {
        index,
        tool: "execute_action",
        actionName,
        status: "completed" as const,
    };
}

function grepCall() {
    return {
        tool: "grep",
        durationMs: 1,
        input: {
            engine: "ripgrep",
            ripgrepPath,
            ripgrepSha256,
        },
        resultCount: 1,
        outputBytes: 20,
        truncated: false,
    };
}

function lspCall() {
    return {
        tool: "lsp",
        durationMs: 1,
        input: {
            method: "definition",
            path: "pkg/a.py",
            line: 1,
            symbol: "target",
            serverId: "pylsp",
            languageId: "python",
        },
        resultCount: 1,
        outputBytes: 20,
        truncated: false,
    };
}

function readCall() {
    return {
        tool: "read",
        durationMs: 1,
        input: { path: "pkg/a.py", offset: 0, limit: 1 },
        resultCount: 1,
        outputBytes: 20,
        truncated: false,
    };
}

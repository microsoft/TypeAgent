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
    explorerRepositoryCalls: 1,
    firstAssistantActionExclusiveExplorer: true,
    explorerCompletedBeforeLaterAssistantAction: true,
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

test("accepts direct TypeAgent rows without a Copilot main agent", () => {
    assert.doesNotThrow(() =>
        validateResultRows([typeAgentRow("typeagent")], identity),
    );
});

test("accepts refinement programs that validate and submit their own locations", () => {
    const candidate = typeAgentRow("typeagent");
    const invocation = candidate.exploreTelemetry!.invocations![0];
    invocation.actionAttempts = [
        completedAction(0, "discoverRepository"),
        completedAction(1, "refineRepository"),
    ];
    invocation.submissionAction = "refineRepository";
    candidate.typeAgentUsage!.requestCount = 2;
    candidate.exploreTelemetry!.usage.requestCount = 2;
    invocation.usage.requestCount = 2;
    invocation.actionTranslationAndCodeGenerationUsage!.requestCount = 2;

    assert.doesNotThrow(() => validateResultRows([candidate], identity));
});

test("requires explicit positive result evidence for refinement auto-submission", () => {
    const makeCandidate = () => {
        const candidate = typeAgentRow("typeagent");
        const invocation = candidate.exploreTelemetry!.invocations![0];
        invocation.actionAttempts = [
            completedAction(0, "discoverRepository"),
            completedAction(1, "refineRepository"),
        ];
        invocation.submissionAction = "refineRepository";
        return candidate;
    };
    const mutations: Array<(candidate: RunResult) => void> = [
        (candidate) => {
            delete candidate.exploreTelemetry!.invocations![0].submissionAction;
        },
        (candidate) => {
            delete candidate.exploreTelemetry!.invocations![0].result;
        },
        (candidate) => {
            candidate.exploreTelemetry!.invocations![0].result!.citationCount = 0;
            candidate.exploreTelemetry!.result!.citationCount = 0;
        },
        (candidate) => {
            candidate.exploreTelemetry!.invocations![0].result!.truncated =
                true;
        },
    ];

    for (const mutate of mutations) {
        const candidate = makeCandidate();
        mutate(candidate);
        assert.throws(
            () => validateResultRows([candidate], identity),
            /Explorer telemetry/i,
        );
    }
});

test("preserves exact raw ingress independently of the parameterless action", () => {
    const candidate = typeAgentRow("typeagent");
    candidate.query = "find\r\nbug\r\ndetails";
    candidate.typeAgentDispatch!.submittedRequest = candidate.query;
    candidate.typeAgentDispatch!.translatedActions[0].parameters = {};

    assert.doesNotThrow(() => validateResultRows([candidate], identity));
});

test("accepts repaired submission attempts after discovery and refinement", () => {
    const candidate = typeAgentRow("typeagent");
    candidate.exploreTelemetry!.invocations![0].actionAttempts = [
        completedAction(0, "discoverRepository"),
        completedAction(1, "refineRepository"),
        failedAction(2, "submitExploration"),
        failedAction(3, "submitExploration"),
        completedAction(4, "submitExploration"),
    ];

    assert.doesNotThrow(() => validateResultRows([candidate], identity));
});

test("requires explicit submission provenance for repaired submissions", () => {
    const candidate = typeAgentRow("typeagent");
    delete candidate.exploreTelemetry!.invocations![0].submissionAction;

    assert.throws(
        () => validateResultRows([candidate], identity),
        /Explorer telemetry/i,
    );
});

test("accepts failed generated programs before each completed phase", () => {
    const candidate = typeAgentRow("typeagent");
    candidate.exploreTelemetry!.invocations![0].actionAttempts = [
        failedAction(0, "discoverRepository"),
        failedAction(1, "discoverRepository"),
        completedAction(2, "discoverRepository"),
        failedAction(3, "refineRepository"),
        completedAction(4, "refineRepository"),
        failedAction(5, "submitExploration"),
        completedAction(6, "submitExploration"),
    ];

    assert.doesNotThrow(() => validateResultRows([candidate], identity));
});

test("rejects every direct TypeAgent dispatch and isolation mutation", () => {
    const mutations: Array<{
        name: string;
        apply(candidate: RunResult): void;
    }> = [
        {
            name: "missing dispatch evidence",
            apply: (candidate) => delete candidate.typeAgentDispatch,
        },
        {
            name: "non-natural-language ingress",
            apply: (candidate) => {
                candidate.typeAgentDispatch!.ingress = "typed-action" as never;
            },
        },
        {
            name: "changed submitted request",
            apply: (candidate) => {
                candidate.typeAgentDispatch!.submittedRequest = "changed";
            },
        },
        {
            name: "translation not invoked",
            apply: (candidate) => {
                candidate.typeAgentDispatch!.translationInvoked = false;
            },
        },
        {
            name: "zero translations",
            apply: (candidate) => {
                candidate.typeAgentDispatch!.translationRequestCount = 0;
            },
        },
        {
            name: "duplicate translations",
            apply: (candidate) => {
                candidate.typeAgentDispatch!.translationRequestCount = 2;
            },
        },
        {
            name: "additional active agent",
            apply: (candidate) => {
                candidate.typeAgentDispatch!.activeAgentNames.push("chat");
            },
        },
        {
            name: "additional active schema",
            apply: (candidate) => {
                candidate.typeAgentDispatch!.activeSchemaNames.push("chat");
            },
        },
        {
            name: "missing translated action",
            apply: (candidate) => {
                candidate.typeAgentDispatch!.translatedActions = [];
            },
        },
        {
            name: "duplicate translated action",
            apply: (candidate) => {
                candidate.typeAgentDispatch!.translatedActions.push(
                    structuredClone(
                        candidate.typeAgentDispatch!.translatedActions[0],
                    ),
                );
            },
        },
        {
            name: "wrong translated schema",
            apply: (candidate) => {
                candidate.typeAgentDispatch!.translatedActions[0].schemaName =
                    "chat";
            },
        },
        {
            name: "wrong translated action",
            apply: (candidate) => {
                candidate.typeAgentDispatch!.translatedActions[0].actionName =
                    "discoverRepository";
            },
        },
        {
            name: "execution used a different request",
            apply: (candidate) => {
                candidate.typeAgentDispatch!.executionRequestMatchedIngress =
                    false;
            },
        },
        {
            name: "duplicate execution",
            apply: (candidate) => {
                candidate.typeAgentDispatch!.executionCount = 2;
            },
        },
        {
            name: "output not produced by execution",
            apply: (candidate) => {
                candidate.typeAgentDispatch!.outputMatchedExecution = false;
            },
        },
        {
            name: "dispatch used Copilot",
            apply: (candidate) => {
                candidate.typeAgentDispatch!.usedCopilot = true;
            },
        },
        {
            name: "dispatch used MCP",
            apply: (candidate) => {
                candidate.typeAgentDispatch!.usedMcp = true;
            },
        },
        {
            name: "MCP adopted",
            apply: (candidate) => {
                candidate.mcpAdopted = true;
            },
        },
        {
            name: "MCP explore attempted",
            apply: (candidate) => {
                candidate.attemptedExploreCalls = 1;
            },
        },
        {
            name: "MCP explore completed",
            apply: (candidate) => {
                candidate.completedExploreCalls = 1;
            },
        },
        {
            name: "MCP explore succeeded",
            apply: (candidate) => {
                candidate.successfulExploreCalls = 1;
            },
        },
        {
            name: "outside Explorer inspection",
            apply: (candidate) => {
                candidate.outsideExploreInspection = true;
            },
        },
        {
            name: "MCP server ready",
            apply: (candidate) => {
                candidate.mcpServerReady = true;
            },
        },
        {
            name: "MCP tool advertised",
            apply: (candidate) => {
                candidate.mcpAdvertisedTools = ["explore"];
            },
        },
        {
            name: "MCP trace recorded",
            apply: (candidate) => {
                candidate.mcpToolTrace = [
                    {
                        toolCallId: "mcp-1",
                        server: "typeagent",
                        tool: "explore",
                        completed: true,
                        success: true,
                    },
                ];
            },
        },
        {
            name: "subagent adopted",
            apply: (candidate) => {
                candidate.subagentAdopted = true;
            },
        },
        {
            name: "subagent attempted",
            apply: (candidate) => {
                candidate.attemptedExplorerDelegations = 1;
            },
        },
        {
            name: "subagent completed",
            apply: (candidate) => {
                candidate.completedExplorerDelegations = 1;
            },
        },
        {
            name: "subagent succeeded",
            apply: (candidate) => {
                candidate.successfulExplorerDelegations = 1;
            },
        },
        {
            name: "subagent failed",
            apply: (candidate) => {
                candidate.failedExplorerDelegations = 1;
            },
        },
        {
            name: "subagent trace recorded",
            apply: (candidate) => {
                candidate.explorerSubagentTrace = [
                    structuredClone(row.explorerSubagentTrace[0]),
                ];
            },
        },
        {
            name: "Copilot main-agent inspection",
            apply: (candidate) => {
                candidate.mainAgentRepositoryInspection = true;
            },
        },
        {
            name: "Copilot tool trace recorded",
            apply: (candidate) => {
                candidate.toolTrace = [
                    {
                        tool: "grep",
                        args: {},
                        ok: true,
                        durationMs: 1,
                        output: "match",
                    },
                ];
            },
        },
        {
            name: "Copilot event recorded",
            apply: (candidate) => {
                candidate.events = [{ type: "assistant.message" }];
            },
        },
        {
            name: "Copilot selected agent recorded",
            apply: (candidate) => {
                candidate.selectedAgentName = "explorer";
            },
        },
        {
            name: "Copilot default main agent recorded",
            apply: (candidate) => {
                candidate.defaultMainAgent = true;
            },
        },
    ];

    for (const mutation of mutations) {
        const candidate = typeAgentRow("typeagent");
        mutation.apply(candidate);
        assert.throws(
            () => validateResultRows([candidate], identity),
            /direct TypeAgent/i,
            mutation.name,
        );
    }
});

test("rejects every direct TypeAgent Explorer telemetry mutation", () => {
    const mutations: Array<{
        name: string;
        apply(candidate: RunResult): void;
    }> = [
        {
            name: "missing telemetry",
            apply: (candidate) => delete candidate.exploreTelemetry,
        },
        {
            name: "legacy telemetry schema",
            apply: (candidate) => {
                candidate.exploreTelemetry!.schemaVersion = 3;
            },
        },
        {
            name: "failed aggregate telemetry",
            apply: (candidate) => {
                candidate.exploreTelemetry!.status = "failed";
            },
        },
        {
            name: "missing invocation",
            apply: (candidate) => {
                candidate.exploreTelemetry!.invocations = [];
            },
        },
        {
            name: "duplicate invocation",
            apply: (candidate) => {
                candidate.exploreTelemetry!.invocations!.push(
                    structuredClone(
                        candidate.exploreTelemetry!.invocations![0],
                    ),
                );
            },
        },
        {
            name: "failed invocation",
            apply: (candidate) => {
                candidate.exploreTelemetry!.invocations![0].status = "failed";
            },
        },
        {
            name: "missing action-generation usage",
            apply: (candidate) => {
                delete candidate.exploreTelemetry!.invocations![0]
                    .actionTranslationAndCodeGenerationUsage;
            },
        },
        {
            name: "action-generation usage differs from invocation usage",
            apply: (candidate) => {
                const usage =
                    candidate.exploreTelemetry!.invocations![0]
                        .actionTranslationAndCodeGenerationUsage!;
                usage.inputTokens += 1;
                usage.totalTokens += 1;
            },
        },
        {
            name: "invocation usage differs from aggregate telemetry usage",
            apply: (candidate) => {
                const invocation = candidate.exploreTelemetry!.invocations![0];
                invocation.usage.inputTokens += 1;
                invocation.usage.totalTokens += 1;
                invocation.actionTranslationAndCodeGenerationUsage =
                    structuredClone(invocation.usage);
            },
        },
        {
            name: "missing action attempts",
            apply: (candidate) => {
                delete candidate.exploreTelemetry!.invocations![0]
                    .actionAttempts;
            },
        },
        {
            name: "missing invocation result",
            apply: (candidate) => {
                delete candidate.exploreTelemetry!.invocations![0].result;
            },
        },
        {
            name: "missing aggregate result",
            apply: (candidate) => {
                delete candidate.exploreTelemetry!.result;
            },
        },
        {
            name: "zero grounded locations",
            apply: (candidate) => {
                candidate.exploreTelemetry!.invocations![0].result!.citationCount = 0;
                candidate.exploreTelemetry!.result!.citationCount = 0;
            },
        },
        {
            name: "invocation result differs from aggregate",
            apply: (candidate) => {
                candidate.exploreTelemetry!.invocations![0].result!.truncated =
                    true;
            },
        },
        {
            name: "missing refinement",
            apply: (candidate) => {
                candidate.exploreTelemetry!.invocations![0].actionAttempts = [
                    completedAction(0, "discoverRepository"),
                    completedAction(1, "submitExploration"),
                ];
            },
        },
        {
            name: "missing discovery",
            apply: (candidate) => {
                candidate.exploreTelemetry!.invocations![0].actionAttempts = [
                    completedAction(0, "refineRepository"),
                    completedAction(1, "submitExploration"),
                ];
            },
        },
        {
            name: "missing submission",
            apply: (candidate) => {
                candidate.exploreTelemetry!.invocations![0].actionAttempts = [
                    completedAction(0, "discoverRepository"),
                    completedAction(1, "refineRepository"),
                ];
            },
        },
        {
            name: "out-of-order actions",
            apply: (candidate) => {
                candidate.exploreTelemetry!.invocations![0].actionAttempts = [
                    completedAction(0, "refineRepository"),
                    completedAction(1, "discoverRepository"),
                    completedAction(2, "submitExploration"),
                ];
            },
        },
        {
            name: "failed refinement",
            apply: (candidate) => {
                candidate.exploreTelemetry!.invocations![0].actionAttempts![1].status =
                    "failed";
            },
        },
        {
            name: "successful submission followed by another submission",
            apply: (candidate) => {
                candidate.exploreTelemetry!.invocations![0].actionAttempts = [
                    completedAction(0, "discoverRepository"),
                    completedAction(1, "refineRepository"),
                    completedAction(2, "submitExploration"),
                    completedAction(3, "submitExploration"),
                ];
            },
        },
        {
            name: "failed final submission",
            apply: (candidate) => {
                candidate.exploreTelemetry!.invocations![0].actionAttempts![2] =
                    failedAction(2, "submitExploration");
            },
        },
        {
            name: "additional failed action attempt",
            apply: (candidate) => {
                candidate.exploreTelemetry!.invocations![0].actionAttempts!.push(
                    {
                        index: 3,
                        actionName: "refineRepository",
                        status: "failed",
                    },
                );
            },
        },
        {
            name: "repeated discovery before submission",
            apply: (candidate) => {
                candidate.exploreTelemetry!.invocations![0].actionAttempts = [
                    completedAction(0, "discoverRepository"),
                    completedAction(1, "refineRepository"),
                    failedAction(2, "discoverRepository"),
                    completedAction(3, "submitExploration"),
                ];
            },
        },
        {
            name: "repeated refinement before submission",
            apply: (candidate) => {
                candidate.exploreTelemetry!.invocations![0].actionAttempts = [
                    completedAction(0, "discoverRepository"),
                    completedAction(1, "refineRepository"),
                    failedAction(2, "refineRepository"),
                    completedAction(3, "submitExploration"),
                ];
            },
        },
        {
            name: "non-contiguous submission retry index",
            apply: (candidate) => {
                candidate.exploreTelemetry!.invocations![0].actionAttempts = [
                    completedAction(0, "discoverRepository"),
                    completedAction(1, "refineRepository"),
                    failedAction(2, "submitExploration"),
                    completedAction(4, "submitExploration"),
                ];
            },
        },
        {
            name: "incorrect action-attempt index",
            apply: (candidate) => {
                candidate.exploreTelemetry!.invocations![0].actionAttempts![1].index = 2;
            },
        },
    ];

    for (const mutation of mutations) {
        const candidate = typeAgentRow("typeagent");
        mutation.apply(candidate);
        assert.throws(
            () => validateResultRows([candidate], identity),
            /Explorer telemetry/i,
            mutation.name,
        );
    }
});

test("requires exact usage and repository-tool evidence", () => {
    const mutations: Array<{
        name: string;
        expected: RegExp;
        apply(candidate: RunResult): void;
    }> = [
        {
            name: "missing dispatcher usage",
            expected: /usage evidence/i,
            apply: (candidate) => delete candidate.dispatcherUsage,
        },
        {
            name: "missing Explorer usage",
            expected: /usage evidence/i,
            apply: (candidate) => delete candidate.typeAgentUsage,
        },
        {
            name: "missing combined usage",
            expected: /usage evidence/i,
            apply: (candidate) => delete candidate.combinedUsage,
        },
        {
            name: "duplicate dispatcher request count",
            expected: /usage evidence/i,
            apply: (candidate) => {
                candidate.dispatcherUsage!.requestCount = 2;
            },
        },
        {
            name: "dispatcher total disagrees with its token components",
            expected: /usage evidence/i,
            apply: (candidate) => {
                candidate.dispatcherUsage!.totalTokens += 1;
                candidate.combinedUsage!.totalTokens += 1;
            },
        },
        {
            name: "combined usage contains a negative component",
            expected: /usage evidence/i,
            apply: (candidate) => {
                candidate.combinedUsage!.cacheWriteTokens = -1;
            },
        },
        {
            name: "combined usage contains a non-finite component",
            expected: /usage evidence/i,
            apply: (candidate) => {
                candidate.combinedUsage!.reasoningOutputTokens =
                    Number.POSITIVE_INFINITY;
            },
        },
        {
            name: "telemetry usage differs from executed action",
            expected: /usage evidence/i,
            apply: (candidate) => {
                candidate.exploreTelemetry!.usage.inputTokens += 1;
                candidate.exploreTelemetry!.usage.totalTokens += 1;
                const invocation = candidate.exploreTelemetry!.invocations![0];
                invocation.usage = structuredClone(
                    candidate.exploreTelemetry!.usage,
                );
                invocation.actionTranslationAndCodeGenerationUsage =
                    structuredClone(candidate.exploreTelemetry!.usage);
            },
        },
        {
            name: "combined usage double counts a token",
            expected: /usage evidence/i,
            apply: (candidate) => {
                candidate.combinedUsage!.inputTokens += 1;
                candidate.combinedUsage!.totalTokens += 1;
            },
        },
        {
            name: "row tool trace differs from telemetry",
            expected: /repository-tool evidence/i,
            apply: (candidate) => {
                candidate.typeAgentToolTrace!.totalOutputBytes += 1;
            },
        },
        {
            name: "grep trace omits ripgrep engine",
            expected: /repository-tool evidence/i,
            apply: (candidate) => {
                candidate.typeAgentToolTrace!.calls[0].input = {
                    ripgrepPath: "/usr/bin/rg",
                };
                candidate.exploreTelemetry!.toolTrace.calls[0].input = {
                    ripgrepPath: "/usr/bin/rg",
                };
            },
        },
        {
            name: "grep trace omits ripgrep executable",
            expected: /repository-tool evidence/i,
            apply: (candidate) => {
                candidate.typeAgentToolTrace!.calls[0].input = {
                    engine: "ripgrep",
                };
                candidate.exploreTelemetry!.toolTrace.calls[0].input = {
                    engine: "ripgrep",
                };
            },
        },
        {
            name: "tool trace contains no ripgrep call",
            expected: /repository-tool evidence/i,
            apply: (candidate) => {
                candidate.typeAgentToolTrace = {
                    calls: [],
                    totalCalls: 0,
                    totalOutputBytes: 0,
                };
                candidate.exploreTelemetry!.toolTrace = structuredClone(
                    candidate.typeAgentToolTrace,
                );
            },
        },
    ];

    for (const mutation of mutations) {
        const candidate = typeAgentRow("typeagent");
        mutation.apply(candidate);
        assert.throws(
            () => validateResultRows([candidate], identity),
            mutation.expected,
            mutation.name,
        );
    }
});

test("requires mode-correct language-server evidence", () => {
    const plainMutations: Array<{
        name: string;
        apply(candidate: RunResult): void;
    }> = [
        {
            name: "plain arm adopted LSP",
            apply: (candidate) => {
                candidate.lspAdopted = true;
            },
        },
        {
            name: "plain arm counted an LSP call",
            apply: (candidate) => {
                candidate.lspCallCount = 1;
            },
        },
        {
            name: "plain arm recorded a successful LSP call",
            apply: (candidate) => {
                candidate.typeAgentToolTrace!.calls.push(lspCall());
                candidate.typeAgentToolTrace!.totalCalls += 1;
                candidate.typeAgentToolTrace!.totalOutputBytes += 20;
                candidate.exploreTelemetry!.toolTrace = structuredClone(
                    candidate.typeAgentToolTrace!,
                );
            },
        },
    ];
    for (const mutation of plainMutations) {
        const candidate = typeAgentRow("typeagent");
        mutation.apply(candidate);
        assert.throws(
            () => validateResultRows([candidate], identity),
            /language-server evidence/i,
            mutation.name,
        );
    }

    const lspIdentity: RunIdentity = {
        ...identity,
        variants: ["typeagent-lsp"],
    };
    const lspRow = typeAgentRow("typeagent-lsp");

    assert.doesNotThrow(() => validateResultRows([lspRow], lspIdentity));
    for (const [name, apply] of [
        [
            "LSP arm did not adopt LSP",
            (candidate: RunResult) => {
                candidate.lspAdopted = false;
            },
        ],
        [
            "LSP arm counted no calls",
            (candidate: RunResult) => {
                candidate.lspCallCount = 0;
            },
        ],
        [
            "LSP arm count differs from its trace",
            (candidate: RunResult) => {
                candidate.lspCallCount = 2;
            },
        ],
        [
            "LSP arm result count differs from its trace",
            (candidate: RunResult) => {
                candidate.lspResultCount = (candidate.lspResultCount ?? 0) + 1;
            },
        ],
        [
            "LSP arm recorded no successful call",
            (candidate: RunResult) => {
                candidate.typeAgentToolTrace!.calls.find(
                    (call) => call.tool === "lsp",
                )!.error = "failed";
                candidate.exploreTelemetry!.toolTrace.calls.find(
                    (call) => call.tool === "lsp",
                )!.error = "failed";
            },
        ],
        [
            "LSP arm recorded only an empty navigation result",
            (candidate: RunResult) => {
                candidate.lspResultCount = 0;
                candidate.typeAgentToolTrace!.calls.find(
                    (call) => call.tool === "lsp",
                )!.resultCount = 0;
                candidate.exploreTelemetry!.toolTrace.calls.find(
                    (call) => call.tool === "lsp",
                )!.resultCount = 0;
            },
        ],
    ] as const) {
        const candidate = structuredClone(lspRow);
        apply(candidate);
        assert.throws(
            () => validateResultRows([candidate], lspIdentity),
            /language-server evidence/i,
            name,
        );
    }
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
        /Explorer delegation and execution integrity/i,
    );
});

test("rejects successful baseline rows without execution-order evidence", () => {
    for (const candidate of [
        { ...row, explorerRepositoryCalls: 0 },
        { ...row, firstAssistantActionExclusiveExplorer: false },
        { ...row, explorerCompletedBeforeLaterAssistantAction: false },
    ]) {
        assert.throws(
            () => validateResultRows([candidate], identity),
            /execution integrity/i,
        );
    }
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

function typeAgentRow(variant: "typeagent" | "typeagent-lsp"): RunResult {
    const lspCalls = variant === "typeagent-lsp" ? [lspCall()] : [];
    const toolCalls = [grepCall(), ...lspCalls];
    const typeAgentUsage = {
        requestCount: 3,
        usageComplete: true,
        inputTokens: 100,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 20,
        reasoningOutputTokens: 0,
        totalTokens: 120,
    };
    const dispatcherUsage = {
        requestCount: 1,
        usageComplete: true,
        inputTokens: 25,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 5,
        reasoningOutputTokens: 0,
        totalTokens: 30,
    };
    const toolTrace = {
        calls: toolCalls,
        totalCalls: toolCalls.length,
        totalOutputBytes: toolCalls.reduce(
            (total, call) => total + call.outputBytes,
            0,
        ),
    };
    return {
        ...row,
        variant,
        dispatcherUsage,
        typeAgentUsage,
        combinedUsage: {
            inputTokens: 125,
            cachedInputTokens: 0,
            cacheWriteTokens: 0,
            outputTokens: 25,
            reasoningOutputTokens: 0,
            totalTokens: 150,
        },
        mcpAdopted: false,
        lspAdopted: variant === "typeagent-lsp",
        lspCallCount: lspCalls.length,
        lspResultCount: lspCalls.reduce(
            (total, call) => total + call.resultCount,
            0,
        ),
        subagentAdopted: false,
        defaultMainAgent: false,
        attemptedExploreCalls: 0,
        completedExploreCalls: 0,
        successfulExploreCalls: 0,
        outsideExploreInspection: false,
        mcpServerReady: false,
        mcpAdvertisedTools: [],
        attemptedExplorerDelegations: 0,
        completedExplorerDelegations: 0,
        successfulExplorerDelegations: 0,
        failedExplorerDelegations: 0,
        mainAgentRepositoryInspection: false,
        explorerSubagentTrace: [],
        mcpToolTrace: [],
        toolTrace: [],
        events: [],
        typeAgentToolTrace: structuredClone(toolTrace),
        typeAgentDispatch: {
            ingress: "natural-language",
            submittedRequest: row.query,
            translationInvoked: true,
            translationRequestCount: 1,
            activeAgentNames: ["explorer"],
            activeSchemaNames: ["explorer"],
            translatedActions: [
                {
                    schemaName: "explorer",
                    actionName: "exploreRepository",
                    parameters: {},
                },
            ],
            executionCount: 1,
            outputMatchedExecution: true,
            executionRequestMatchedIngress: true,
            usedCopilot: false,
            usedMcp: false,
        },
        exploreTelemetry: {
            schemaVersion: 4,
            model: row.model,
            status: "completed",
            usage: structuredClone(typeAgentUsage),
            toolTrace,
            invocations: [
                {
                    index: 0,
                    status: "completed",
                    usage: structuredClone(typeAgentUsage),
                    actionTranslationAndCodeGenerationUsage:
                        structuredClone(typeAgentUsage),
                    toolTrace,
                    actionAttempts: [
                        completedAction(0, "discoverRepository"),
                        completedAction(1, "refineRepository"),
                        completedAction(2, "submitExploration"),
                    ],
                    submissionAction: "submitExploration",
                    result: { citationCount: 1, truncated: false },
                },
            ],
            result: { citationCount: 1, truncated: false },
        },
    };
}

function completedAction(index: number, actionName: string) {
    return { index, actionName, status: "completed" as const };
}

function failedAction(index: number, actionName: string) {
    return { index, actionName, status: "failed" as const };
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
        },
        resultCount: 1,
        outputBytes: 20,
        truncated: false,
    };
}

function grepCall() {
    return {
        tool: "grep",
        durationMs: 1,
        input: {
            engine: "ripgrep",
            ripgrepPath: "/usr/bin/rg",
        },
        resultCount: 1,
        outputBytes: 20,
        truncated: false,
    };
}

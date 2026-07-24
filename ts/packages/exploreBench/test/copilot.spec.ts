// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
    buildAgentRoutingConfig,
    buildBenchmarkPrompt,
    buildBenchmarkSystemMessage,
    buildCustomAgentConfig,
    inspectCopilotToolTrace,
    normalizeRpcUsage,
    resolveCopilotPath,
    runCopilot,
    shouldRepairFinalAnswer,
    summarizeCopilotUsage,
    treatmentValidationError,
    validateObservedUsageModels,
    type CopilotRunOptions,
} from "../src/copilot.js";
import { readExploreTelemetry } from "../src/exploreTelemetry.js";
import type { ExploreTelemetry } from "../src/types.js";

function options(): CopilotRunOptions {
    return {
        repoPath: "/repo",
        ripgrepPath: "/copilot/ripgrep/rg",
        prompt: "find bug",
        model: "azure/gpt-5.6-luna",
        variant: "baseline",
        providerBaseUrl: "http://localhost:4627/v1",
        apiKeyEnv: "CUSTOM_PROVIDER_API_KEY",
        agent: {
            name: "explorer",
            description: "benchmark explorer",
            tools: ["read", "grep", "glob", "ls"],
            prompt: "explore only",
            file: "/repo/.copilot/agents/explorer.md",
            sha256: "a".repeat(64),
        },
        telemetryFile: "/telemetry/row.json",
        timeoutMs: 1_000,
    };
}

test("builds the baseline prompt with its explicit required path", () => {
    const baseline = buildBenchmarkSystemMessage();
    assert.match(baseline, /default main agent/i);
    assert.match(baseline, /exactly one successful delegation/i);
    assert.match(baseline, /Do not inspect the repository yourself/i);
    assert.match(baseline, /at most six repository-relative file paths/i);
    assert.doesNotMatch(baseline, /short reason/i);
    assert.match(
        buildBenchmarkPrompt("find bug"),
        /^Use the explorer subagent\./,
    );
});

test("rejects legacy TypeAgent variants before starting Copilot", async () => {
    await assert.rejects(
        runCopilot(
            {} as never,
            {
                ...options(),
                variant: "typeagent" as never,
            } as CopilotRunOptions,
        ),
        /Copilot runner supports only the baseline arm/i,
    );
});

test("keeps the default main agent and exposes only the arm's required path", () => {
    assert.deepEqual(buildAgentRoutingConfig(options().agent), {
        availableTools: ["builtin:task", "custom:*"],
        customAgents: [
            {
                name: "explorer",
                displayName: "explorer",
                description: "benchmark explorer",
                tools: ["read", "grep", "glob", "ls"],
                prompt: "explore only",
                infer: true,
            },
        ],
        defaultAgent: {
            excludedTools: ["read", "grep", "glob", "ls"],
        },
    });
});

test("builds the explorer as an inferable subagent with bounded repository tools", () => {
    assert.deepEqual(buildCustomAgentConfig(options().agent), {
        name: "explorer",
        displayName: "explorer",
        description: "benchmark explorer",
        tools: ["read", "grep", "glob", "ls"],
        prompt: "explore only",
        infer: true,
    });
});

test("requires one completed explorer delegation in baseline sessions", () => {
    const valid = inspectCopilotToolTrace([
        assistantTask("task-1"),
        taskStart("task-1"),
        subagentStarted("task-1"),
        subagentToolStart("task-1", "grep-1", "grep"),
        subagentCompleted("task-1"),
        complete("task-1", true),
        assistantAnswer("<final_answer>\npkg/a.py:1 reason\n</final_answer>"),
    ]);
    assert.equal(valid.attemptedExplorerDelegations, 1);
    assert.equal(valid.completedExplorerDelegations, 1);
    assert.equal(valid.failedExplorerDelegations, 0);
    assert.equal(valid.mainAgentRepositoryInspection, false);
    assert.equal(treatmentValidationError(valid), undefined);

    assert.match(
        treatmentValidationError(inspectCopilotToolTrace([])) ?? "",
        /at least one explorer subagent attempt/i,
    );
    assert.match(
        treatmentValidationError(
            inspectCopilotToolTrace([
                assistantTask("task-1"),
                taskStart("task-1"),
                subagentStarted("task-1"),
                subagentFailed("task-1"),
                complete("task-1", false),
            ]),
        ) ?? "",
        /successful explorer subagent delegation/i,
    );
});

test("allows failed task-schema attempts before one successful explorer delegation", () => {
    const inspection = inspectCopilotToolTrace([
        assistantTask("task-invalid", "", { name: undefined }),
        taskStart("task-invalid", { name: undefined }),
        complete("task-invalid", false),
        assistantTask("task-valid"),
        taskStart("task-valid"),
        subagentStarted("task-valid"),
        subagentToolStart("task-valid", "grep-1", "grep"),
        subagentCompleted("task-valid"),
        complete("task-valid", true),
        assistantAnswer("<final_answer>\npkg/a.py:1 reason\n</final_answer>"),
    ]);
    assert.equal(inspection.attemptedExplorerDelegations, 2);
    assert.equal(inspection.successfulExplorerDelegations, 1);
    assert.equal(inspection.failedExplorerDelegations, 1);
    assert.equal(treatmentValidationError(inspection), undefined);
});

test("detects repository inspection by the default main agent", () => {
    const inspection = inspectCopilotToolTrace([
        assistantTask("task-1"),
        taskStart("task-1"),
        subagentStarted("task-1"),
        subagentToolStart("task-1", "grep-1", "grep"),
        subagentCompleted("task-1"),
        complete("task-1", true),
        {
            type: "tool.execution_start",
            data: { toolCallId: "read-1", toolName: "read" },
        },
    ]);
    assert.equal(inspection.mainAgentRepositoryInspection, true);
    assert.match(
        treatmentValidationError(inspection) ?? "",
        /default main agent inspected the repository/i,
    );
});

test("requires an exclusive synchronous explorer task as the first baseline action", () => {
    const prose = inspectCopilotToolTrace([
        assistantTask("task-1", "I will delegate."),
        taskStart("task-1"),
        subagentStarted("task-1"),
        subagentCompleted("task-1"),
        complete("task-1", true),
    ]);
    assert.match(
        treatmentValidationError(prose) ?? "",
        /first assistant action.*explorer task/i,
    );

    const background = inspectCopilotToolTrace([
        assistantTask("task-1", "", { mode: "background" }),
        taskStart("task-1", { mode: "background" }),
        subagentStarted("task-1"),
        subagentCompleted("task-1"),
        complete("task-1", true),
    ]);
    assert.match(
        treatmentValidationError(background) ?? "",
        /synchronous explorer task/i,
    );
});

test("repairs only answers without a parseable citation", () => {
    assert.equal(shouldRepairFinalAnswer("plain prose"), true);
    assert.equal(
        shouldRepairFinalAnswer("<final_answer>\n</final_answer>"),
        true,
    );
    assert.equal(
        shouldRepairFinalAnswer(
            "<final_answer>\nsrc/index.ts:10-12 reason\n</final_answer>",
        ),
        false,
    );
});

test("sums Copilot usage without double-counting cache or reasoning subsets", () => {
    assert.deepEqual(
        summarizeCopilotUsage([
            {
                model: "azure/gpt-5.6-luna",
                inputTokens: 100,
                cacheReadTokens: 40,
                cacheWriteTokens: 5,
                outputTokens: 20,
                reasoningTokens: 10,
            },
            {
                model: "azure/gpt-5.6-luna",
                inputTokens: 50,
                outputTokens: 5,
            },
        ]),
        {
            source: "assistant.usage",
            requestCount: 2,
            usageComplete: true,
            models: ["azure/gpt-5.6-luna"],
            inputTokens: 150,
            cachedInputTokens: 40,
            cacheWriteTokens: 5,
            outputTokens: 25,
            reasoningOutputTokens: 10,
            totalTokens: 175,
        },
    );
});

test("requires Copilot usage to name exactly the requested LiteLLM route", () => {
    const usage = {
        source: "assistant.usage" as const,
        requestCount: 1,
        models: ["azure/gpt-5.6-luna"],
        inputTokens: 10,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 2,
        reasoningOutputTokens: 0,
        totalTokens: 12,
    };
    assert.equal(
        validateObservedUsageModels(usage, "azure/gpt-5.6-luna"),
        undefined,
    );
    assert.match(
        validateObservedUsageModels(usage, "azure/gpt-5.6-sol") ?? "",
        /do not match requested route/,
    );
});

test("normalizes the Copilot usage RPC fallback", () => {
    assert.deepEqual(
        normalizeRpcUsage({
            totalUserRequests: 1,
            modelMetrics: {
                "azure/gpt-5.6-sol": {
                    requests: { count: 2 },
                    usage: {
                        inputTokens: 80,
                        outputTokens: 12,
                        cacheReadTokens: 20,
                        cacheWriteTokens: 0,
                        reasoningTokens: 7,
                    },
                },
            },
        }),
        {
            source: "rpc",
            requestCount: 2,
            usageComplete: true,
            models: ["azure/gpt-5.6-sol"],
            inputTokens: 80,
            cachedInputTokens: 20,
            cacheWriteTokens: 0,
            outputTokens: 12,
            reasoningOutputTokens: 7,
            totalTokens: 92,
        },
    );
});

test("reads schema-v1 TypeAgent telemetry", async () => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "explore-bench-telemetry-"),
    );
    try {
        const telemetryPath = path.join(directory, "telemetry.json");
        await writeFile(telemetryPath, JSON.stringify(validTelemetry()));
        const telemetry = await readExploreTelemetry(
            telemetryPath,
            "azure/gpt-5.6-luna",
        );
        assert.equal(telemetry.usage.cacheWriteTokens, 0);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("preserves validated host-owned ripgrep execution telemetry", async () => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "explore-bench-ripgrep-telemetry-"),
    );
    try {
        const telemetryPath = path.join(directory, "telemetry.json");
        const telemetry = validTelemetry();
        telemetry.toolTrace.calls[0].execution = {
            engine: "ripgrep",
            executable: "rg",
        };
        await writeFile(telemetryPath, JSON.stringify(telemetry));

        const parsed = await readExploreTelemetry(
            telemetryPath,
            "azure/gpt-5.6-luna",
        );

        assert.deepEqual(parsed.toolTrace.calls[0]?.execution, {
            engine: "ripgrep",
            executable: "rg",
        });
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("rejects malformed ripgrep execution telemetry", async () => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "explore-bench-invalid-ripgrep-telemetry-"),
    );
    try {
        const telemetryPath = path.join(directory, "telemetry.json");
        for (const execution of [
            { engine: "other", executable: "rg" },
            { engine: "ripgrep" },
        ]) {
            const telemetry = validTelemetry();
            telemetry.toolTrace.calls[0].execution = execution as never;
            await writeFile(telemetryPath, JSON.stringify(telemetry));

            await assert.rejects(
                readExploreTelemetry(telemetryPath, "azure/gpt-5.6-luna"),
                /execution/i,
            );
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("accepts glob and LSP calls in TypeAgent repository telemetry", async () => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "explore-bench-glob-telemetry-"),
    );
    try {
        const telemetryPath = path.join(directory, "telemetry.json");
        for (const tool of ["glob", "lsp"]) {
            const telemetry = validTelemetry();
            telemetry.toolTrace.calls[0].tool = tool;
            await writeFile(telemetryPath, JSON.stringify(telemetry));

            const parsed = await readExploreTelemetry(
                telemetryPath,
                "azure/gpt-5.6-luna",
            );

            assert.equal(parsed.toolTrace.calls[0]?.tool, tool);
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("aggregates every schema-v2 TypeAgent telemetry invocation", async () => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "explore-bench-telemetry-v2-"),
    );
    try {
        const telemetryPath = path.join(directory, "telemetry.json");
        const first = validTelemetry();
        await writeFile(
            telemetryPath,
            JSON.stringify({
                schemaVersion: 2,
                model: first.model,
                invocations: [
                    {
                        index: 0,
                        status: "completed",
                        usage: first.usage,
                        toolTrace: first.toolTrace,
                        result: first.result,
                    },
                    {
                        index: 1,
                        status: "failed",
                        usage: {
                            ...first.usage,
                            requestCount: 1,
                            inputTokens: 7,
                            outputTokens: 3,
                            totalTokens: 10,
                        },
                        toolTrace: {
                            calls: [],
                            totalCalls: 0,
                            totalOutputBytes: 0,
                        },
                        error: "generation failed",
                    },
                ],
            }),
        );

        const telemetry = await readExploreTelemetry(
            telemetryPath,
            "azure/gpt-5.6-luna",
        );

        assert.equal(telemetry.schemaVersion, 2);
        assert.equal(telemetry.status, "failed");
        assert.equal(telemetry.invocations?.length, 2);
        assert.deepEqual(telemetry.usage, {
            requestCount: 3,
            usageComplete: true,
            inputTokens: 37,
            cachedInputTokens: 0,
            cacheWriteTokens: 0,
            outputTokens: 8,
            reasoningOutputTokens: 0,
            totalTokens: 45,
        });
        assert.equal(telemetry.toolTrace.totalCalls, 1);
        assert.equal(telemetry.error, "generation failed");
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("reads schema-v3 telemetry with dispatcher and Code Mode token breakdowns", async () => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "explore-bench-telemetry-v3-"),
    );
    try {
        const telemetryPath = path.join(directory, "telemetry.json");
        const first = validTelemetry();
        await writeFile(
            telemetryPath,
            JSON.stringify({
                schemaVersion: 3,
                model: first.model,
                invocations: [
                    {
                        index: 0,
                        status: "completed",
                        usage: {
                            ...first.usage,
                            requestCount: 3,
                            inputTokens: 40,
                            outputTokens: 7,
                            totalTokens: 47,
                        },
                        translationUsage: {
                            ...first.usage,
                            requestCount: 1,
                            inputTokens: 10,
                            outputTokens: 2,
                            totalTokens: 12,
                        },
                        codeModeUsage: first.usage,
                        toolTrace: first.toolTrace,
                        result: first.result,
                    },
                ],
            }),
        );

        const telemetry = await readExploreTelemetry(
            telemetryPath,
            "azure/gpt-5.6-luna",
        );

        assert.equal(telemetry.schemaVersion, 3);
        assert.equal(telemetry.usage.totalTokens, 47);
        assert.equal(
            telemetry.invocations?.[0]?.translationUsage?.totalTokens,
            12,
        );
        assert.equal(
            telemetry.invocations?.[0]?.codeModeUsage?.totalTokens,
            35,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("reads schema-v4 action translation and Code Mode generation usage", async () => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "explore-bench-telemetry-v3-agentic-"),
    );
    try {
        const telemetryPath = path.join(directory, "telemetry.json");
        const first = validTelemetry();
        await writeFile(
            telemetryPath,
            JSON.stringify({
                schemaVersion: 4,
                model: first.model,
                invocations: [
                    {
                        index: 0,
                        status: "completed",
                        usage: first.usage,
                        actionTranslationAndCodeGenerationUsage: first.usage,
                        toolTrace: first.toolTrace,
                        result: first.result,
                    },
                ],
            }),
        );

        const telemetry = await readExploreTelemetry(
            telemetryPath,
            "azure/gpt-5.6-luna",
        );

        assert.equal(telemetry.schemaVersion, 4);
        assert.equal(telemetry.usage.totalTokens, 35);
        assert.equal(
            telemetry.invocations?.[0]?.actionTranslationAndCodeGenerationUsage
                ?.totalTokens,
            35,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("rejects an unknown schema-v4 submission action", async () => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "explore-bench-telemetry-v4-submission-"),
    );
    try {
        const telemetryPath = path.join(directory, "telemetry.json");
        const first = validTelemetry();
        await writeFile(
            telemetryPath,
            JSON.stringify({
                schemaVersion: 4,
                model: first.model,
                invocations: [
                    {
                        index: 0,
                        status: "completed",
                        usage: first.usage,
                        actionTranslationAndCodeGenerationUsage: first.usage,
                        toolTrace: first.toolTrace,
                        submissionAction: "hiddenSubmission",
                        result: first.result,
                    },
                ],
            }),
        );

        await assert.rejects(
            readExploreTelemetry(telemetryPath, "azure/gpt-5.6-luna"),
            /submissionAction must be 'refineRepository' or 'submitExploration'/,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("rejects schema-v4 usage that would undercount inner action generation", async () => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "explore-bench-telemetry-v4-mismatch-"),
    );
    try {
        const telemetryPath = path.join(directory, "telemetry.json");
        const first = validTelemetry();
        await writeFile(
            telemetryPath,
            JSON.stringify({
                schemaVersion: 4,
                model: first.model,
                invocations: [
                    {
                        index: 0,
                        status: "completed",
                        usage: first.usage,
                        actionTranslationAndCodeGenerationUsage: {
                            ...first.usage,
                            inputTokens: first.usage.inputTokens - 1,
                            outputTokens: first.usage.outputTokens + 1,
                        },
                        toolTrace: first.toolTrace,
                        result: first.result,
                    },
                ],
            }),
        );

        await assert.rejects(
            readExploreTelemetry(telemetryPath, "azure/gpt-5.6-luna"),
            /usage must equal actionTranslationAndCodeGenerationUsage/,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("resolves the packaged native Copilot executable", async () => {
    const saved = process.env.COPILOT_CLI_PATH;
    delete process.env.COPILOT_CLI_PATH;
    try {
        const localRequire = createRequire(import.meta.url);
        const copilotRequire = createRequire(
            localRequire.resolve("@github/copilot/package.json"),
        );
        const expected = await realpath(
            copilotRequire.resolve(
                `@github/copilot-${process.platform}-${process.arch}`,
            ),
        );
        assert.equal(await resolveCopilotPath(), expected);
    } finally {
        if (saved === undefined) {
            delete process.env.COPILOT_CLI_PATH;
        } else {
            process.env.COPILOT_CLI_PATH = saved;
        }
    }
});

function complete(id: string, success: boolean): Record<string, unknown> {
    return {
        type: "tool.execution_complete",
        data: {
            toolCallId: id,
            success,
            ...(success
                ? { result: { content: "pkg/a.py:10" } }
                : { error: { message: "failed" } }),
        },
    };
}

function assistantAnswer(content: string): Record<string, unknown> {
    return {
        type: "assistant.message",
        data: { content, toolRequests: [] },
    };
}

function taskArguments(
    overrides: Record<string, unknown> = {},
): Record<string, unknown> {
    return {
        description: "Explore issue",
        prompt: "find bug",
        agent_type: "explorer",
        name: "explorer",
        mode: "sync",
        ...overrides,
    };
}

function assistantTask(
    id: string,
    content = "",
    overrides: Record<string, unknown> = {},
): Record<string, unknown> {
    return {
        type: "assistant.message",
        data: {
            content,
            toolRequests: [
                {
                    toolCallId: id,
                    name: "task",
                    arguments: taskArguments(overrides),
                },
            ],
        },
    };
}

function taskStart(
    id: string,
    overrides: Record<string, unknown> = {},
): Record<string, unknown> {
    return {
        type: "tool.execution_start",
        data: {
            toolCallId: id,
            toolName: "task",
            arguments: taskArguments(overrides),
        },
    };
}

function subagentStarted(id: string): Record<string, unknown> {
    return {
        type: "subagent.started",
        agentId: id,
        data: { toolCallId: id, agentName: "explorer" },
    };
}

function subagentCompleted(id: string): Record<string, unknown> {
    return {
        type: "subagent.completed",
        agentId: id,
        data: { toolCallId: id, agentName: "explorer" },
    };
}

function subagentFailed(id: string): Record<string, unknown> {
    return {
        type: "subagent.failed",
        agentId: id,
        data: { toolCallId: id, agentName: "explorer", error: "failed" },
    };
}

function subagentToolStart(
    parentId: string,
    id: string,
    toolName: string,
): Record<string, unknown> {
    return {
        type: "tool.execution_start",
        agentId: parentId,
        data: { toolCallId: id, toolName, parentToolCallId: parentId },
    };
}

function validTelemetry(): ExploreTelemetry {
    return {
        schemaVersion: 1,
        model: "azure/gpt-5.6-luna",
        status: "completed",
        usage: {
            requestCount: 2,
            inputTokens: 30,
            cachedInputTokens: 0,
            cacheWriteTokens: 0,
            outputTokens: 5,
            reasoningOutputTokens: 0,
            totalTokens: 35,
        },
        toolTrace: {
            calls: [
                {
                    tool: "grep",
                    startedAt: "2026-07-16T00:00:00.000Z",
                    durationMs: 4,
                    input: { pattern: "bug" },
                    resultCount: 1,
                    outputBytes: 20,
                    truncated: false,
                },
            ],
            totalCalls: 1,
            totalOutputBytes: 20,
        },
        result: { citationCount: 1, truncated: false },
    };
}

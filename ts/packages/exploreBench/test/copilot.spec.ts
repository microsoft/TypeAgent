// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
    addUsage,
    buildAgentRoutingConfig,
    buildBenchmarkPrompt,
    buildBenchmarkSystemMessage,
    buildCustomAgentConfig,
    buildMcpServerConfig,
    inspectCopilotToolTrace,
    normalizeRpcUsage,
    readExploreTelemetry,
    readExploreTelemetryEventually,
    resolveCopilotPath,
    shouldRepairFinalAnswer,
    summarizeCopilotUsage,
    treatmentValidationError,
    validateObservedUsageModels,
    type CopilotRunOptions,
} from "../src/copilot.js";
import type { ExploreTelemetry } from "../src/types.js";

function options(variant: CopilotRunOptions["variant"]): CopilotRunOptions {
    return {
        repoPath: "/repo",
        prompt: "find bug",
        model: "azure/gpt-5.6-luna",
        variant,
        providerBaseUrl: "http://localhost:4627/v1",
        apiKeyEnv: "CUSTOM_PROVIDER_API_KEY",
        agent: {
            name: "explorer",
            description: "benchmark explorer",
            tools: ["read", "grep", "glob", "bash"],
            prompt: "explore only",
            file: "/repo/.copilot/agents/explorer.md",
            sha256: "a".repeat(64),
        },
        mcp: {
            command: "/mcp/server",
            args: ["--stdio"],
            cwd: "/mcp",
            envVars: ["TYPEAGENT_MODEL_API_KEY"],
        },
        telemetryFile: "/telemetry/row.json",
        timeoutMs: 1_000,
    };
}

test("builds arm-specific main-agent prompts with explicit required paths", () => {
    const treatment = buildBenchmarkSystemMessage("typeagent");
    const baseline = buildBenchmarkSystemMessage("baseline");
    assert.match(
        treatment,
        /first assistant action MUST be exactly one call to it/,
    );
    assert.match(treatment, /Wait for its result/);
    assert.match(treatment, /do not call any other tool/);
    assert.match(treatment, /at most six repository-relative file paths/i);
    assert.doesNotMatch(treatment, /short reason/i);
    assert.match(baseline, /default main agent/i);
    assert.match(baseline, /exactly one successful delegation/i);
    assert.match(baseline, /Do not inspect the repository yourself/i);
    assert.match(baseline, /at most six repository-relative file paths/i);
    assert.doesNotMatch(baseline, /short reason/i);
    assert.match(
        buildBenchmarkPrompt("baseline", "find bug"),
        /^Use the explorer subagent\./,
    );
    assert.match(
        buildBenchmarkPrompt("typeagent", "find bug"),
        /^Use the explore tool\./,
    );
    assert.equal(
        buildBenchmarkSystemMessage("typeagent-lsp"),
        buildBenchmarkSystemMessage("typeagent"),
    );
});

test("keeps the default main agent and exposes only the arm's required path", () => {
    assert.deepEqual(
        buildAgentRoutingConfig("baseline", options("baseline").agent),
        {
            availableTools: ["builtin:task", "custom:*"],
            customAgents: [
                {
                    name: "explorer",
                    displayName: "explorer",
                    description: "benchmark explorer",
                    tools: ["read", "grep", "glob", "bash"],
                    prompt: "explore only",
                    infer: true,
                },
            ],
            defaultAgent: {
                excludedTools: ["read", "grep", "glob", "bash"],
            },
        },
    );
    assert.deepEqual(
        buildAgentRoutingConfig("typeagent", options("typeagent").agent),
        { availableTools: ["mcp:*"] },
    );
    assert.deepEqual(
        buildAgentRoutingConfig(
            "typeagent-lsp",
            options("typeagent-lsp").agent,
        ),
        { availableTools: ["mcp:*"] },
    );
});

test("builds the explorer as an inferable subagent with bounded repository tools", () => {
    assert.deepEqual(buildCustomAgentConfig(options("baseline").agent), {
        name: "explorer",
        displayName: "explorer",
        description: "benchmark explorer",
        tools: ["read", "grep", "glob", "bash"],
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
    assert.equal(
        treatmentValidationError("baseline", valid, false, [], undefined),
        undefined,
    );

    assert.match(
        treatmentValidationError(
            "baseline",
            inspectCopilotToolTrace([]),
            false,
            [],
            undefined,
        ) ?? "",
        /at least one explorer subagent attempt/i,
    );
    assert.match(
        treatmentValidationError(
            "baseline",
            inspectCopilotToolTrace([
                assistantTask("task-1"),
                taskStart("task-1"),
                subagentStarted("task-1"),
                subagentFailed("task-1"),
                complete("task-1", false),
            ]),
            false,
            [],
            undefined,
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
    assert.equal(
        treatmentValidationError("baseline", inspection, false, [], undefined),
        undefined,
    );
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
        treatmentValidationError(
            "baseline",
            inspection,
            false,
            [],
            undefined,
        ) ?? "",
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
        treatmentValidationError("baseline", prose, false, [], undefined) ?? "",
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
        treatmentValidationError(
            "baseline",
            background,
            false,
            [],
            undefined,
        ) ?? "",
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

test("builds one-tool native MCP config without putting secrets in arguments", () => {
    const outerCredential = "outer-secret";
    const innerCredential = "inner-secret";
    const modelEnvironment = {
        CUSTOM_PROVIDER_API_KEY: outerCredential,
        TYPEAGENT_MODEL_API_KEY: innerCredential,
    };
    const config = buildMcpServerConfig(options("typeagent"), modelEnvironment);
    assert.equal(config.type, "stdio");
    assert.equal(config.command, "/mcp/server");
    assert.deepEqual(config.tools, ["explore"]);
    assert.equal(config.workingDirectory, "/mcp");
    assert.deepEqual(config.env, modelEnvironment);
    assert.match(config.args?.join(" ") ?? "", /--repo \/repo/);
    assert.match(config.args?.join(" ") ?? "", /--max-tool-calls 8/);
    assert.match(config.args?.join(" ") ?? "", /--model azure\/gpt-5.6-luna/);
    assert.doesNotMatch(config.args?.join(" ") ?? "", /secret/);
    assert.equal(config.timeout, 300_000);

    const lspConfig = buildMcpServerConfig(
        options("typeagent-lsp"),
        modelEnvironment,
    );
    assert.ok(lspConfig.args?.includes("--enable-lsp"));
    assert.match(
        lspConfig.args?.join(" ") ?? "",
        /--request-timeout-ms 120000/,
    );
    assert.ok(!config.args?.includes("--enable-lsp"));
});

test("requires a successful language-server call only in the LSP arm", () => {
    const inspection = inspectCopilotToolTrace([
        assistantExplore("call-1"),
        start("call-1"),
        complete("call-1", true),
    ]);
    assert.match(
        treatmentValidationError(
            "typeagent-lsp",
            inspection,
            true,
            ["explore"],
            validTelemetry(),
        ) ?? "",
        /language-server navigation/i,
    );
    assert.equal(
        treatmentValidationError(
            "typeagent-lsp",
            inspection,
            true,
            ["explore"],
            lspTelemetry(),
        ),
        undefined,
    );
});

test("allows failed MCP attempts before one successful explore invocation", () => {
    const events = [
        assistantExplore("call-1"),
        start("call-1"),
        complete("call-1", false),
        start("call-2"),
        complete("call-2", false),
        start("call-3"),
        complete("call-3", true),
    ];
    const inspection = inspectCopilotToolTrace(events);
    assert.equal(inspection.attemptedExploreCalls, 3);
    assert.equal(inspection.completedExploreCalls, 3);
    assert.equal(inspection.successfulExploreCalls, 1);
    assert.equal(
        treatmentValidationError(
            "typeagent",
            inspection,
            true,
            ["explore"],
            validTelemetry(),
        ),
        undefined,
    );
});

test("requires one successful MCP invocation and rejects every outside tool start", () => {
    const missing = inspectCopilotToolTrace([]);
    assert.match(
        treatmentValidationError(
            "typeagent",
            missing,
            true,
            ["explore"],
            undefined,
        ) ?? "",
        /at least one explore attempt/i,
    );

    const valid = inspectCopilotToolTrace([
        assistantExplore("call-1"),
        start("call-1"),
        complete("call-1", true),
    ]);
    assert.equal(
        treatmentValidationError(
            "typeagent",
            valid,
            true,
            ["explore"],
            validTelemetry(),
        ),
        undefined,
    );

    const outside = inspectCopilotToolTrace([
        assistantExplore("call-1"),
        start("call-1"),
        complete("call-1", true),
        {
            type: "tool.execution_start",
            data: { toolCallId: "read-1", toolName: "read" },
        },
    ]);
    assert.equal(outside.outsideExploreInspection, true);
    assert.match(
        treatmentValidationError(
            "typeagent",
            outside,
            true,
            ["explore"],
            validTelemetry(),
        ) ?? "",
        /outside explore/i,
    );

    const single = validTelemetry();
    const repeatedTelemetry: ExploreTelemetry = {
        ...single,
        schemaVersion: 2,
        invocations: [
            {
                index: 0,
                status: single.status,
                usage: single.usage,
                toolTrace: single.toolTrace,
                ...(single.result ? { result: single.result } : {}),
            },
            {
                index: 1,
                status: single.status,
                usage: single.usage,
                toolTrace: single.toolTrace,
                ...(single.result ? { result: single.result } : {}),
            },
        ],
    };
    assert.match(
        treatmentValidationError(
            "typeagent",
            valid,
            true,
            ["explore"],
            repeatedTelemetry,
        ) ?? "",
        /telemetry for exactly one explore invocation/i,
    );

    assert.match(
        treatmentValidationError("typeagent", valid, true, ["explore"], {
            ...single,
            usage: { ...single.usage, usageComplete: false },
        }) ?? "",
        /usage is incomplete/i,
    );
});

test("requires explore to be the first prose-free assistant action", () => {
    const proseInspection = inspectCopilotToolTrace([
        assistantExplore("call-1", "I will inspect the repository first."),
        start("call-1"),
        complete("call-1", true),
    ]);
    assert.match(
        treatmentValidationError(
            "typeagent",
            proseInspection,
            true,
            ["explore"],
            validTelemetry(),
        ) ?? "",
        /first assistant action/i,
    );

    const parallelInspection = inspectCopilotToolTrace([
        {
            type: "assistant.message",
            data: {
                content: "",
                toolRequests: [
                    assistantExploreRequest("call-1"),
                    { toolCallId: "read-1", name: "read", arguments: {} },
                ],
            },
        },
        start("call-1"),
        complete("call-1", true),
    ]);
    assert.match(
        treatmentValidationError(
            "typeagent",
            parallelInspection,
            true,
            ["explore"],
            validTelemetry(),
        ) ?? "",
        /exactly one TypeAgent explore request/i,
    );
});

test("requires explore to complete before a later assistant action", () => {
    const inspection = inspectCopilotToolTrace([
        assistantExplore("call-1"),
        start("call-1"),
        assistantAnswer("Searching is complete."),
        complete("call-1", true),
    ]);
    assert.match(
        treatmentValidationError(
            "typeagent",
            inspection,
            true,
            ["explore"],
            validTelemetry(),
        ) ?? "",
        /before any later assistant action/i,
    );
});

test("allows citation repair after the exclusive explore call completes", () => {
    const inspection = inspectCopilotToolTrace([
        assistantExplore("call-1"),
        start("call-1"),
        complete("call-1", true),
        assistantAnswer("The likely file is pkg/a.py."),
        assistantAnswer(
            "<final_answer>\npkg/a.py:10 likely fix\n</final_answer>",
        ),
    ]);
    assert.equal(
        treatmentValidationError(
            "typeagent",
            inspection,
            true,
            ["explore"],
            validTelemetry(),
        ),
        undefined,
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

test("reads schema-v1 TypeAgent telemetry and combines token usage", async () => {
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
        assert.deepEqual(
            addUsage(
                {
                    inputTokens: 100,
                    cachedInputTokens: 20,
                    cacheWriteTokens: 3,
                    outputTokens: 10,
                    reasoningOutputTokens: 5,
                    totalTokens: 110,
                },
                telemetry.usage,
            ),
            {
                inputTokens: 130,
                cachedInputTokens: 20,
                cacheWriteTokens: 3,
                outputTokens: 15,
                reasoningOutputTokens: 5,
                totalTokens: 145,
            },
        );
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

test("waits for terminal TypeAgent telemetry after an outer timeout", async () => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "explore-bench-late-telemetry-"),
    );
    try {
        const telemetryPath = path.join(directory, "telemetry.json");
        const pending = readExploreTelemetryEventually(
            telemetryPath,
            "azure/gpt-5.6-luna",
            1_000,
            10,
        );
        setTimeout(() => {
            void writeFile(telemetryPath, JSON.stringify(validTelemetry()));
        }, 40);

        const telemetry = await pending;
        assert.equal(telemetry.usage.totalTokens, 35);
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

function start(id: string): Record<string, unknown> {
    return {
        type: "tool.execution_start",
        data: {
            toolCallId: id,
            toolName: "typeagent-explore",
            mcpServerName: "typeagent",
            mcpToolName: "explore",
            arguments: { query: "bug" },
        },
    };
}

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

function assistantExplore(id: string, content = ""): Record<string, unknown> {
    return {
        type: "assistant.message",
        data: {
            content,
            toolRequests: [assistantExploreRequest(id)],
        },
    };
}

function assistantExploreRequest(id: string): Record<string, unknown> {
    return {
        toolCallId: id,
        name: "typeagent-explore",
        mcpServerName: "typeagent",
        mcpToolName: "explore",
        arguments: { query: "bug" },
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

function lspTelemetry(): ExploreTelemetry {
    const telemetry = validTelemetry();
    const lspCall = {
        tool: "lsp",
        startedAt: "2026-07-16T00:00:01.000Z",
        durationMs: 5,
        input: {
            method: "definition",
            path: "pkg/a.py",
            line: 1,
            symbol: "target",
        },
        resultCount: 1,
        outputBytes: 30,
        truncated: false,
    };
    return {
        ...telemetry,
        toolTrace: {
            calls: [...telemetry.toolTrace.calls, lspCall],
            totalCalls: telemetry.toolTrace.totalCalls + 1,
            totalOutputBytes: telemetry.toolTrace.totalOutputBytes + 30,
        },
    };
}

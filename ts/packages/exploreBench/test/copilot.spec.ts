// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { SessionEvent } from "@github/copilot-sdk";
import {
    addUsage,
    buildAgentRoutingConfig,
    buildBenchmarkPrompt,
    buildBenchmarkSystemMessage,
    buildCustomAgentConfig,
    buildMcpServerConfig,
    inspectCopilotToolTrace,
    normalizeRpcUsage,
    outerRelayValidationError,
    readExploreTelemetry,
    readExploreTelemetryEventually,
    reconcileCopilotUsage,
    resolveCopilotPath,
    relayTypeAgentExplore,
    runCopilot,
    shouldRepairFinalAnswer,
    summarizeCopilotUsage,
    treatmentValidationError,
    validateObservedUsageModels,
    type CopilotRunOptions,
    type TypeAgentRelaySession,
} from "../src/copilot.js";
import {
    createTrajectoryFiles,
    validateTrajectoryFile,
} from "../src/trajectory.js";
import type { ExploreTelemetry } from "../src/types.js";

function options(variant: CopilotRunOptions["variant"]): CopilotRunOptions {
    return {
        rowName: "row",
        attempt: 1,
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
            pythonLspCommand: "/workspace/python-lsp/.venv/bin/pylsp",
            typescriptLspCommand: "/runtime/node",
            typescriptLspArgs: [
                "/workspace/typescript-language-server/lib/cli.mjs",
                "--stdio",
            ],
        },
        telemetryFile: "/telemetry/row.json",
        trajectoryFiles: {
            main: "/trajectories/typeagent-main-row-luna.jsonl",
            ...(variant === "baseline"
                ? {}
                : {
                      codeMode:
                          "/trajectories/typeagent-codemode-row-luna.jsonl",
                  }),
        },
        timeoutMs: 1_000,
        ripgrepPath: "/packaged/rg",
    };
}

test("builds arm-specific main-agent prompts with explicit required paths", () => {
    const treatment = buildBenchmarkSystemMessage("typeagent");
    const baseline = buildBenchmarkSystemMessage("baseline");
    assert.match(
        treatment,
        /first assistant action MUST be exactly one call to it/,
    );
    assert.match(
        treatment,
        /call explore with no arguments.*server binds the complete current user message/i,
    );
    assert.match(
        treatment,
        /host relays a successful result and ends the turn/i,
    );
    assert.match(
        treatment,
        /do not add prose or call another tool after explore/i,
    );
    assert.match(treatment, /at most six repository-relative file paths/i);
    assert.doesNotMatch(treatment, /short reason/i);
    assert.match(baseline, /default main agent/i);
    assert.match(baseline, /exactly one successful delegation/i);
    assert.match(
        baseline,
        /copy the complete user message byte-for-byte into the task prompt argument/i,
    );
    assert.match(baseline, /Do not inspect the repository yourself/i);
    assert.match(baseline, /at most six repository-relative file paths/i);
    assert.doesNotMatch(baseline, /short reason/i);
    assert.equal(buildBenchmarkPrompt("baseline", "find bug"), "find bug");
    assert.equal(buildBenchmarkPrompt("typeagent", "find bug"), "find bug");
    assert.equal(
        buildBenchmarkSystemMessage("typeagent-lsp"),
        buildBenchmarkSystemMessage("typeagent"),
    );

    const rawQuery = "  preserve CRLF\r\nand Unicode λ exactly  ";
    assert.equal(buildBenchmarkPrompt("typeagent", rawQuery), rawQuery);
});

test("captures separate main and Code Mode trajectories when session creation fails", async (t) => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "explore-copilot-trajectory-failure-"),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    const apiKeyEnv = "EXPLORE_BENCH_TRAJECTORY_TEST_KEY";
    const previousSecret = process.env[apiKeyEnv];
    const secret = "trajectory-test-secret";
    process.env[apiKeyEnv] = secret;
    t.after(() => {
        if (previousSecret === undefined) {
            delete process.env[apiKeyEnv];
        } else {
            process.env[apiKeyEnv] = previousSecret;
        }
    });
    const trajectoryFiles = createTrajectoryFiles(
        path.join(directory, "results.jsonl"),
        "row",
        "azure/gpt-5.6-luna",
        "typeagent",
        1,
    );
    const runOptions: CopilotRunOptions = {
        ...options("typeagent"),
        repoPath: directory,
        apiKeyEnv,
        mcp: { ...options("typeagent").mcp, envVars: [] },
        telemetryFile: path.join(directory, "telemetry.json"),
        trajectoryFiles,
    };
    const zeroUsage = {
        requestCount: 0,
        usageComplete: false,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
    };
    await writeFile(
        runOptions.telemetryFile,
        JSON.stringify({
            schemaVersion: 4,
            model: runOptions.model,
            invocations: [
                {
                    index: 0,
                    status: "failed",
                    startedAt: "2026-07-26T00:00:00.000Z",
                    durationMs: 1,
                    querySha256: "a".repeat(64),
                    usage: zeroUsage,
                    actionTranslationAndCodeGenerationUsage: zeroUsage,
                    toolTrace: {
                        calls: [],
                        totalCalls: 0,
                        totalOutputBytes: 0,
                    },
                    error: "failed before the first request",
                },
            ],
        }),
    );
    const client = {
        createSession: async () => {
            throw new Error(`session creation failed: ${secret}`);
        },
    } as unknown as Parameters<typeof runCopilot>[0];

    const output = await runCopilot(client, runOptions);

    assert.equal(output.ok, false);
    assert.equal(
        output.exploreTelemetry?.invocations?.[0]?.usage.requestCount,
        0,
    );
    assert.ok(trajectoryFiles.codeMode);
    await validateTrajectoryFile(trajectoryFiles.main, {
        rowName: "row",
        model: runOptions.model,
        variant: "typeagent",
        attempt: 1,
        system: "main",
    });
    await validateTrajectoryFile(trajectoryFiles.codeMode, {
        rowName: "row",
        model: runOptions.model,
        variant: "typeagent",
        attempt: 1,
        system: "codemode",
    });
    const [main, codeMode] = await Promise.all(
        [trajectoryFiles.main, trajectoryFiles.codeMode].map(async (file) =>
            (await readFile(file, "utf8"))
                .trim()
                .split("\n")
                .map((line) => JSON.parse(line)),
        ),
    );
    assert.deepEqual(
        main.map((record) => record.role),
        ["system", "user", "assistant"],
    );
    assert.deepEqual(
        codeMode.map((record) => record.role),
        ["system", "user", "assistant"],
    );
    assert.doesNotMatch(
        JSON.stringify([main, codeMode]),
        /trajectory-test-secret/,
    );
});

test("relays a successful MCP result and aborts before outer synthesis", async () => {
    const nativeText = "  pkg/a.py:1\r\npkg/λ.ts:2  ";
    const session = fakeRelaySession(
        [
            relayStart("call-1"),
            relayComplete(
                "call-1",
                true,
                nativeText,
                "truncated model content",
            ),
        ],
        { sendAck: "after-events", abortAck: "after-events" },
    );

    await assert.doesNotReject(async () => {
        assert.deepEqual(
            await relayTypeAgentExplore(session, "find bug", 1_000),
            {
                finalAnswer: `<final_answer>\n${nativeText}\n</final_answer>`,
                outerLoopAbortedAfterExplore: true,
            },
        );
    });
    assert.equal(session.abortCalls, 1);
    assert.deepEqual(session.prompts, ["find bug"]);
    assert.deepEqual(session.emittedTypes, [
        "tool.execution_start",
        "tool.execution_complete",
        "abort",
        "session.idle",
    ]);
});

test("fails closed on ambiguous or non-text native MCP results", async () => {
    for (const contents of [
        [
            { type: "text" as const, text: "pkg/a.py:1" },
            { type: "text" as const, text: "pkg/b.py:2" },
        ],
        [{ type: "terminal" as const, text: "pkg/a.py:1" }],
        [],
    ]) {
        await assert.rejects(
            relayTypeAgentExplore(
                fakeRelaySession([
                    relayStart("call-1"),
                    relayComplete(
                        "call-1",
                        true,
                        undefined,
                        "concise",
                        contents,
                    ),
                ]),
                "find bug",
                1_000,
            ),
            /exactly one non-empty native text block/i,
        );
    }
});

test("supports SDK send and abort acknowledgement before their events", async () => {
    const session = fakeRelaySession(
        [relayStart("call-1"), relayComplete("call-1", true, "pkg/a.py:1")],
        { sendAck: "before-events", abortAck: "before-events" },
    );

    assert.equal(
        (await relayTypeAgentExplore(session, "find bug", 1_000)).finalAnswer,
        "<final_answer>\npkg/a.py:1\n</final_answer>",
    );
    assert.deepEqual(session.emittedTypes, [
        "tool.execution_start",
        "tool.execution_complete",
        "abort",
        "session.idle",
    ]);
});

test("fails closed when relay ordering or the controlled abort is invalid", async () => {
    await assert.rejects(
        relayTypeAgentExplore(
            fakeRelaySession([
                relayComplete("call-1", true, "pkg/a.py:1"),
                relayIdle(false),
            ]),
            "find bug",
            1_000,
        ),
        /idle without an observed abort/i,
    );

    await assert.rejects(
        relayTypeAgentExplore(
            fakeRelaySession(
                [relayStart("call-1"), relayComplete("call-1", false)],
                { emitAbort: false },
            ),
            "find bug",
            1_000,
        ),
        /failed explore/i,
    );

    await assert.rejects(
        relayTypeAgentExplore(
            fakeRelaySession(
                [
                    relayStart("call-1"),
                    relayComplete("call-1", true, "pkg/a.py:1"),
                ],
                { emitAbort: false },
            ),
            "find bug",
            1_000,
        ),
        /idle without an observed abort/i,
    );

    await assert.rejects(
        relayTypeAgentExplore(
            fakeRelaySession(
                [
                    relayStart("call-1"),
                    relayComplete("call-1", true, "pkg/a.py:1"),
                ],
                { emitAssistantProse: true },
            ),
            "find bug",
            1_000,
        ),
        /emitted prose/i,
    );

    await assert.rejects(
        relayTypeAgentExplore(
            fakeRelaySession([
                relayStart("call-1"),
                relayComplete("call-1", true, " \n "),
            ]),
            "find bug",
            1_000,
        ),
        /exactly one non-empty native text block/i,
    );

    await assert.rejects(
        relayTypeAgentExplore(
            fakeRelaySession(
                [
                    relayStart("call-1"),
                    relayComplete("call-1", true, "pkg/a.py:1"),
                ],
                { abortError: new Error("abort failed") },
            ),
            "find bug",
            1_000,
        ),
        /abort failed/i,
    );

    await assert.rejects(
        relayTypeAgentExplore(
            fakeRelaySession(
                [
                    relayStart("call-1"),
                    relayComplete("call-1", true, "pkg/a.py:1"),
                ],
                { abortEvents: [relayIdle(true), relayAbort()] },
            ),
            "find bug",
            1_000,
        ),
        /idle without an observed abort/i,
    );
});

test("rejects post-result assistant deltas", async () => {
    for (const delta of [
        relayMessageDelta("unexpected synthesis"),
        relayStreamingDelta(),
    ]) {
        await assert.rejects(
            relayTypeAgentExplore(
                fakeRelaySession(
                    [
                        relayStart("call-1"),
                        relayComplete("call-1", true, "pkg/a.py:1"),
                    ],
                    { abortEvents: [delta, relayAbort(), relayIdle(true)] },
                ),
                "find bug",
                1_000,
            ),
            /emitted prose/i,
        );
    }
});

test("bounds send and abort acknowledgement by the relay timeout", async () => {
    await assert.rejects(
        relayTypeAgentExplore(
            fakeRelaySession([], { sendAck: "never" }),
            "find bug",
            20,
        ),
        /send acknowledgement timed out/i,
    );

    await assert.rejects(
        relayTypeAgentExplore(
            fakeRelaySession(
                [
                    relayStart("call-1"),
                    relayComplete("call-1", true, "pkg/a.py:1"),
                ],
                { abortAck: "never" },
            ),
            "find bug",
            20,
        ),
        /abort acknowledgement timed out/i,
    );
});

test("requires one outer request only for TypeAgent relay arms", () => {
    assert.equal(
        outerRelayValidationError("typeagent", true, false, 1),
        undefined,
    );
    assert.match(
        outerRelayValidationError("typeagent", false, false, 1) ?? "",
        /did not abort/i,
    );
    assert.match(
        outerRelayValidationError("typeagent", true, true, 1) ?? "",
        /repair/i,
    );
    assert.match(
        outerRelayValidationError("typeagent-lsp", true, false, 2) ?? "",
        /exactly one outer model request/i,
    );
    assert.equal(
        outerRelayValidationError("baseline", false, true, 2),
        undefined,
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

test("builds one-tool native MCP config with the shared packaged ripgrep", () => {
    const outerCredential = "outer-secret";
    const innerCredential = "inner-secret";
    const modelEnvironment = {
        CUSTOM_PROVIDER_API_KEY: outerCredential,
        TYPEAGENT_MODEL_API_KEY: innerCredential,
    };
    const packagedRipgrep = "/copilot/ripgrep/bin/darwin-arm64/rg";
    const config = buildMcpServerConfig(
        options("typeagent"),
        modelEnvironment,
        packagedRipgrep,
    );
    assert.equal(config.type, "stdio");
    assert.equal(config.command, "/mcp/server");
    assert.deepEqual(config.tools, ["explore"]);
    assert.equal(config.workingDirectory, "/mcp");
    assert.deepEqual(config.env, {
        ...modelEnvironment,
        TYPEAGENT_RIPGREP_PATH: packagedRipgrep,
        TYPEAGENT_EXPLORE_EXPECTED_QUERY: "find bug",
    });
    assert.doesNotMatch(config.args?.join(" ") ?? "", /find bug/);
    assert.match(config.args?.join(" ") ?? "", /--repo \/repo/);
    assert.match(config.args?.join(" ") ?? "", /--max-tool-calls 8/);
    assert.match(config.args?.join(" ") ?? "", /--model azure\/gpt-5.6-luna/);
    assert.match(config.args?.join(" ") ?? "", /--request-timeout-ms 120000/);
    assert.match(
        config.args?.join(" ") ?? "",
        /--trajectory-file \/trajectories\/typeagent-codemode-row-luna[.]jsonl/,
    );
    assert.doesNotMatch(config.args?.join(" ") ?? "", /secret/);
    assert.equal(config.timeout, 300_000);

    const lspConfig = buildMcpServerConfig(
        options("typeagent-lsp"),
        modelEnvironment,
        packagedRipgrep,
    );
    assert.ok(lspConfig.args?.includes("--enable-lsp"));
    assert.match(
        lspConfig.args?.join(" ") ?? "",
        /--request-timeout-ms 120000/,
    );
    assert.match(
        lspConfig.args?.join(" ") ?? "",
        /--python-lsp-command \/workspace\/python-lsp\/[.]venv\/bin\/pylsp/,
    );
    assert.match(
        lspConfig.args?.join(" ") ?? "",
        /--typescript-lsp-command \/runtime\/node/,
    );
    assert.match(
        lspConfig.args?.join(" ") ?? "",
        /--typescript-lsp-arg \/workspace\/typescript-language-server\/lib\/cli[.]mjs --typescript-lsp-arg --stdio/,
    );
    assert.deepEqual(
        lspConfig.args?.flatMap((argument, index, args) =>
            args[index - 1] === "--lsp-only-server" ? [argument] : [],
        ),
        ["pylsp", "typescript"],
    );
    assert.ok(!config.args?.includes("--enable-lsp"));
    assert.ok(!config.args?.includes("--python-lsp-command"));
});

test("rejects MCP arguments that override benchmark-owned execution flags", () => {
    const candidate = options("typeagent");
    for (const argument of [
        "--enable-lsp",
        "--python-lsp-command",
        "--python-lsp-arg=--unsafe",
        "--typescript-lsp-command=/tmp/server",
        "--typescript-lsp-arg=--unsafe",
        "--lsp-server-command=pylsp=/tmp/server",
        "--lsp-server-arg=pylsp=--unsafe",
        "--disable-lsp-server=pylsp",
        "--lsp-only-server=pylsp",
        "--trajectory-file=/tmp/messages.jsonl",
    ]) {
        candidate.mcp.args = [argument];
        assert.throws(
            () =>
                buildMcpServerConfig(
                    candidate,
                    {
                        CUSTOM_PROVIDER_API_KEY: "outer-secret",
                        TYPEAGENT_MODEL_API_KEY: "inner-secret",
                    },
                    "/packaged/rg",
                ),
            /benchmark-owned MCP argument/i,
            argument,
        );
    }
});

test("requires a non-discarded language-server attempt only in the LSP arm", () => {
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

    const readBeforeNavigation = lspTelemetry();
    readBeforeNavigation.toolTrace.calls = [
        readBeforeNavigation.toolTrace.calls[0],
        readBeforeNavigation.toolTrace.calls[2],
        readBeforeNavigation.toolTrace.calls[1],
    ];
    assert.equal(
        treatmentValidationError(
            "typeagent-lsp",
            inspection,
            true,
            ["explore"],
            readBeforeNavigation,
        ),
        undefined,
    );

    const emptyNavigation = lspTelemetry();
    emptyNavigation.toolTrace.calls[1].resultCount = 0;
    assert.equal(
        treatmentValidationError(
            "typeagent-lsp",
            inspection,
            true,
            ["explore"],
            emptyNavigation,
        ),
        undefined,
    );

    const failedNavigation = lspTelemetry();
    failedNavigation.toolTrace.calls[1].error = "navigation failed";
    assert.equal(
        treatmentValidationError(
            "typeagent-lsp",
            inspection,
            true,
            ["explore"],
            failedNavigation,
        ),
        undefined,
    );

    const discardedNavigation = lspTelemetry();
    discardedNavigation.toolTrace.calls[1].discarded = true;
    assert.match(
        treatmentValidationError(
            "typeagent-lsp",
            inspection,
            true,
            ["explore"],
            discardedNavigation,
        ) ?? "",
        /language-server navigation/i,
    );
});

test("rejects retries before a successful explore invocation", () => {
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
    assert.match(
        treatmentValidationError(
            "typeagent",
            inspection,
            true,
            ["explore"],
            validTelemetry(),
        ) ?? "",
        /exactly one explore attempt/i,
    );
});

test("records MCP call offsets and duration from observed SDK events", () => {
    const inspection = inspectCopilotToolTrace([
        { ...start("call-1"), observedAtOffsetMs: 12 },
        { ...complete("call-1", true), observedAtOffsetMs: 47 },
    ]);

    assert.deepEqual(inspection.mcpToolTrace, [
        {
            toolCallId: "call-1",
            server: "typeagent",
            tool: "explore",
            arguments: { query: "bug" },
            startedOffsetMs: 12,
            durationMs: 35,
            completed: true,
            success: true,
            result: { content: "pkg/a.py:10" },
        },
    ]);
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
        /exactly one explore attempt/i,
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

test("requires live Copilot usage to match accumulated RPC metrics", () => {
    const live = [
        {
            model: "azure/gpt-5.6-sol",
            inputTokens: 80,
            outputTokens: 12,
            cacheReadTokens: 20,
            cacheWriteTokens: 0,
            reasoningTokens: 7,
        },
    ];
    const rpc = {
        totalUserRequests: 1,
        modelMetrics: {
            "azure/gpt-5.6-sol": {
                requests: { count: 1 },
                usage: {
                    inputTokens: 80,
                    outputTokens: 12,
                    cacheReadTokens: 20,
                    cacheWriteTokens: 0,
                    reasoningTokens: 7,
                },
            },
        },
    };

    assert.equal(reconcileCopilotUsage(live, rpc).source, "assistant.usage");
    assert.throws(
        () =>
            reconcileCopilotUsage(live, {
                ...rpc,
                modelMetrics: {
                    "azure/gpt-5.6-sol": {
                        ...rpc.modelMetrics["azure/gpt-5.6-sol"],
                        requests: { count: 2 },
                    },
                },
            }),
        /does not match authoritative RPC metrics/i,
    );
    assert.throws(
        () => reconcileCopilotUsage(live, {}),
        /authoritative RPC metrics are missing/i,
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
            if (tool === "lsp") {
                telemetry.toolTrace.calls[0].discarded = true;
            }
            await writeFile(telemetryPath, JSON.stringify(telemetry));

            const parsed = await readExploreTelemetry(
                telemetryPath,
                "azure/gpt-5.6-luna",
            );

            assert.equal(parsed.toolTrace.calls[0]?.tool, tool);
            assert.equal(
                parsed.toolTrace.calls[0]?.discarded,
                tool === "lsp" ? true : undefined,
            );
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
            requestCount: 4,
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
                            requestCount: 4,
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
        const rawTelemetry = {
            schemaVersion: 4,
            model: first.model,
            invocations: [
                {
                    index: 0,
                    status: "completed",
                    startedAt: "2026-07-26T00:00:00.000Z",
                    durationMs: 123,
                    querySha256: "a".repeat(64),
                    usage: first.usage,
                    actionTranslationAndCodeGenerationUsage: first.usage,
                    toolTrace: first.toolTrace,
                    result: first.result,
                },
            ],
        };
        await writeFile(telemetryPath, JSON.stringify(rawTelemetry));

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
        assert.equal(
            telemetry.invocations?.[0]?.startedAt,
            "2026-07-26T00:00:00.000Z",
        );
        assert.equal(telemetry.invocations?.[0]?.durationMs, 123);
        assert.equal(telemetry.invocations?.[0]?.querySha256, "a".repeat(64));

        rawTelemetry.invocations[0].durationMs = -1;
        await writeFile(telemetryPath, JSON.stringify(rawTelemetry));
        await assert.rejects(
            readExploreTelemetry(telemetryPath, "azure/gpt-5.6-luna"),
            /durationMs must be a non-negative integer/,
        );

        rawTelemetry.invocations[0].durationMs = 1;
        rawTelemetry.invocations[0].startedAt = "not-a-timestamp";
        await writeFile(telemetryPath, JSON.stringify(rawTelemetry));
        await assert.rejects(
            readExploreTelemetry(telemetryPath, "azure/gpt-5.6-luna"),
            /startedAt must be an ISO timestamp/,
        );

        rawTelemetry.invocations[0].startedAt = "2026-07-26T00:00:00.000Z";
        rawTelemetry.invocations[0].querySha256 = "A".repeat(64);
        await writeFile(telemetryPath, JSON.stringify(rawTelemetry));
        await assert.rejects(
            readExploreTelemetry(telemetryPath, "azure/gpt-5.6-luna"),
            /querySha256 must be a lowercase SHA-256 digest/,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("accepts zero usage only for a failed Code Mode invocation", async (t) => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "explore-bench-telemetry-zero-failure-"),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    const telemetryPath = path.join(directory, "telemetry.json");
    const zeroUsage = {
        requestCount: 0,
        usageComplete: false,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
    };
    const invocation = {
        index: 0,
        status: "failed",
        startedAt: "2026-07-26T00:00:00.000Z",
        durationMs: 1,
        querySha256: "a".repeat(64),
        usage: zeroUsage,
        actionTranslationAndCodeGenerationUsage: zeroUsage,
        toolTrace: { calls: [], totalCalls: 0, totalOutputBytes: 0 },
        error: "failed before the first request",
    };
    const telemetry = {
        schemaVersion: 4,
        model: "azure/gpt-5.6-luna",
        invocations: [invocation],
    };
    await writeFile(telemetryPath, JSON.stringify(telemetry));

    const parsed = await readExploreTelemetry(
        telemetryPath,
        "azure/gpt-5.6-luna",
    );
    assert.equal(parsed.invocations?.[0]?.usage.requestCount, 0);

    invocation.status = "completed";
    await writeFile(telemetryPath, JSON.stringify(telemetry));
    await assert.rejects(
        readExploreTelemetry(telemetryPath, "azure/gpt-5.6-luna"),
        /requestCount must be a positive integer/i,
    );
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
                        querySha256: "a".repeat(64),
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

interface FakeRelaySession extends TypeAgentRelaySession {
    abortCalls: number;
    emittedTypes: SessionEvent["type"][];
    prompts: string[];
}

function fakeRelaySession(
    sendEvents: SessionEvent[],
    options: {
        emitAbort?: boolean;
        emitAssistantProse?: boolean;
        abortError?: Error;
        sendAck?: "before-events" | "after-events" | "never";
        abortAck?: "before-events" | "after-events" | "never";
        abortEvents?: SessionEvent[];
    } = {},
): FakeRelaySession {
    const handlers = new Set<(event: SessionEvent) => void>();
    const session: FakeRelaySession = {
        abortCalls: 0,
        emittedTypes: [],
        prompts: [],
        on(handler) {
            handlers.add(handler);
            return () => handlers.delete(handler);
        },
        send(message) {
            session.prompts.push(message.prompt);
            if (options.sendAck === "never") {
                return new Promise<string>(() => {});
            }
            if (options.sendAck === "after-events") {
                emitAll(sendEvents);
                return Promise.resolve("message-1");
            }
            setImmediate(() => emitAll(sendEvents));
            return Promise.resolve("message-1");
        },
        abort() {
            session.abortCalls += 1;
            if (options.abortError) {
                return Promise.reject(options.abortError);
            }
            const abortEvents = options.abortEvents ?? [
                ...(options.emitAssistantProse
                    ? [relayAssistant("unexpected synthesis")]
                    : []),
                ...(options.emitAbort === false ? [] : [relayAbort()]),
                relayIdle(true),
            ];
            if (options.abortAck === "never") {
                emitAll(abortEvents);
                return new Promise<void>(() => {});
            }
            if (options.abortAck === "after-events") {
                emitAll(abortEvents);
                return Promise.resolve();
            }
            setImmediate(() => emitAll(abortEvents));
            return Promise.resolve();
        },
    };
    return session;

    function emit(event: SessionEvent): void {
        session.emittedTypes.push(event.type);
        for (const handler of handlers) {
            handler(event);
        }
    }

    function emitAll(events: SessionEvent[]): void {
        for (const event of events) {
            emit(event);
        }
    }
}

function relayStart(id: string): SessionEvent {
    return {
        type: "tool.execution_start",
        id: `start-${id}`,
        parentId: null,
        timestamp: "2026-07-26T00:00:00.000Z",
        data: {
            toolCallId: id,
            toolName: "typeagent-explore",
            mcpServerName: "typeagent",
            mcpToolName: "explore",
            arguments: {},
        },
    };
}

function relayComplete(
    id: string,
    success: boolean,
    nativeText?: string,
    conciseContent = "truncated concise content",
    contents: NonNullable<
        Extract<
            SessionEvent,
            { type: "tool.execution_complete" }
        >["data"]["result"]
    >["contents"] = [{ type: "text", text: nativeText ?? "" }],
): SessionEvent {
    return {
        type: "tool.execution_complete",
        id: `complete-${id}`,
        parentId: `start-${id}`,
        timestamp: "2026-07-26T00:00:01.000Z",
        data: {
            toolCallId: id,
            success,
            ...(success
                ? { result: { content: conciseContent, contents } }
                : { error: { message: "failed explore" } }),
        },
    };
}

function relayAbort(): SessionEvent {
    return {
        type: "abort",
        id: "abort-1",
        parentId: null,
        timestamp: "2026-07-26T00:00:02.000Z",
        data: { reason: "user_initiated" },
    };
}

function relayIdle(aborted: boolean): SessionEvent {
    return {
        type: "session.idle",
        id: "idle-1",
        parentId: null,
        timestamp: "2026-07-26T00:00:03.000Z",
        ephemeral: true,
        data: { aborted },
    };
}

function relayAssistant(content: string): SessionEvent {
    return {
        type: "assistant.message",
        id: "assistant-1",
        parentId: null,
        timestamp: "2026-07-26T00:00:02.000Z",
        data: {
            content,
            messageId: "message-2",
        },
    };
}

function relayMessageDelta(content: string): SessionEvent {
    return {
        type: "assistant.message_delta",
        id: "assistant-delta-1",
        parentId: null,
        timestamp: "2026-07-26T00:00:02.000Z",
        ephemeral: true,
        data: {
            deltaContent: content,
            messageId: "message-2",
        },
    };
}

function relayStreamingDelta(): SessionEvent {
    return {
        type: "assistant.streaming_delta",
        id: "assistant-streaming-1",
        parentId: null,
        timestamp: "2026-07-26T00:00:02.000Z",
        ephemeral: true,
        data: { totalResponseSizeBytes: 1 },
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
        arguments: {},
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
            requestCount: 3,
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
    const readCall = {
        tool: "read",
        startedAt: "2026-07-16T00:00:02.000Z",
        durationMs: 3,
        input: { path: "pkg/a.py", offset: 0, limit: 10 },
        resultCount: 10,
        outputBytes: 100,
        truncated: false,
    };
    return {
        ...telemetry,
        toolTrace: {
            calls: [...telemetry.toolTrace.calls, lspCall, readCall],
            totalCalls: telemetry.toolTrace.totalCalls + 2,
            totalOutputBytes: telemetry.toolTrace.totalOutputBytes + 130,
        },
    };
}

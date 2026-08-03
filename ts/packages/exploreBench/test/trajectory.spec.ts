// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { SessionEvent } from "@github/copilot-sdk";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
    codeModeTrajectoryInvocationCount,
    codeModeTrajectoryFiles,
    createTrajectoryFiles,
    normalizeCopilotTrajectory,
    validateRunTrajectoryFiles,
    validateTrajectoryFile,
    writeUnavailableTrajectoryFile,
    writeTrajectoryFile,
} from "../src/trajectory.js";
import type {
    BenchmarkVariant,
    NormalizedTrajectoryRecord,
    RunResult,
} from "../src/types.js";

const model = "azure/gpt-5.6-luna";

test("creates exact arm filenames in unique attempt directories", () => {
    const output = "/runs/results.jsonl";
    const row = "django__django-123";
    const baseline = createTrajectoryFiles(output, row, model, "baseline", 1);
    const typeagent = createTrajectoryFiles(output, row, model, "typeagent", 1);
    const lsp = createTrajectoryFiles(output, row, model, "typeagent-lsp", 2);
    const retry = createTrajectoryFiles(output, row, model, "typeagent", 2);

    assert.equal(
        path.basename(baseline.main),
        "baseline-django__django-123-luna.jsonl",
    );
    assert.equal(baseline.codeMode, undefined);
    assert.equal(
        path.basename(typeagent.main),
        "typeagent-main-django__django-123-luna.jsonl",
    );
    assert.equal(
        path.basename(typeagent.codeMode!),
        "typeagent-codemode-django__django-123-luna.jsonl",
    );
    assert.equal(
        path.basename(lsp.main),
        "typeagent-lsp-main-django__django-123-luna.jsonl",
    );
    assert.equal(
        path.basename(lsp.codeMode!),
        "typeagent-lsp-codemode-django__django-123-luna.jsonl",
    );
    assert.match(path.basename(path.dirname(typeagent.main)), /attempt-1/);
    assert.match(path.basename(path.dirname(retry.main)), /attempt-2/);
    assert.notEqual(path.dirname(typeagent.main), path.dirname(retry.main));
});

test("rejects retries that reuse a prior attempt trajectory path", async (t) => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "explore-trajectory-retry-"),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    const files = createTrajectoryFiles(
        path.join(directory, "results.jsonl"),
        "row",
        model,
        "baseline",
        1,
    );
    await writeTrajectoryFile(files.main, completeRecords("copilot-sdk"));
    const first = {
        taskId: "row",
        model,
        variant: "baseline",
        attempt: 1,
        usage: completeMainUsage(),
        trajectoryFiles: files,
    } as RunResult;

    await assert.rejects(
        validateRunTrajectoryFiles([first, { ...first, attempt: 2 }]),
        /unique trajectory paths/i,
    );
});

test("derives one deterministic JSONL path per Code Mode invocation", () => {
    const first =
        "/runs/trajectories/attempt/typeagent-codemode-row-luna.jsonl";

    assert.deepEqual(codeModeTrajectoryFiles(first, 3), [
        first,
        "/runs/trajectories/attempt/typeagent-codemode-row-luna-invocation-2.jsonl",
        "/runs/trajectories/attempt/typeagent-codemode-row-luna-invocation-3.jsonl",
    ]);
    assert.throws(() => codeModeTrajectoryFiles(first, 0), /positive integer/i);
});

test("counts attempted Code Mode executions when telemetry is absent or short", () => {
    assert.equal(codeModeTrajectoryInvocationCount(2, undefined), 2);
    assert.equal(codeModeTrajectoryInvocationCount(2, 1), 2);
    assert.equal(codeModeTrajectoryInvocationCount(1, 2), 2);
    assert.equal(codeModeTrajectoryInvocationCount(0, undefined), 1);
    assert.throws(
        () => codeModeTrajectoryInvocationCount(-1, undefined),
        /non-negative integer/i,
    );
    assert.throws(
        () => codeModeTrajectoryInvocationCount(1, 1.5),
        /non-negative integer/i,
    );
});

test("normalizes root and subagent messages, tool calls, and request usage", () => {
    const events = [
        event("system.message", {
            role: "system",
            content: "system instructions",
        }),
        event("user.message", { content: "find code" }),
        event("assistant.message", {
            apiCallId: "api-main",
            messageId: "message-main",
            model,
            content: "",
            toolRequests: [
                {
                    toolCallId: "task-1",
                    name: "task",
                    arguments: { prompt: "find code" },
                },
            ],
        }),
        event("tool.execution_start", {
            toolCallId: "task-1",
            toolName: "task",
            arguments: { prompt: "find code" },
            model,
        }),
        event(
            "assistant.message",
            {
                apiCallId: "api-child",
                messageId: "message-child",
                model,
                content: "child answer",
            },
            "explorer-1",
        ),
        event(
            "assistant.usage",
            {
                apiCallId: "api-child",
                model,
                inputTokens: 100,
                outputTokens: 20,
                cacheReadTokens: 10,
                reasoningTokens: 5,
            },
            "explorer-1",
        ),
        event("tool.execution_complete", {
            toolCallId: "task-1",
            success: true,
            model,
            result: { content: "child answer" },
        }),
        event("assistant.usage", {
            apiCallId: "api-main",
            model,
            inputTokens: 50,
            outputTokens: 10,
        }),
    ];

    const records = normalizeCopilotTrajectory(events, model, ["find code"]);

    assert.deepEqual(
        records.map((record) => record.role),
        ["system", "user", "assistant", "assistant", "tool"],
    );
    assert.equal(records[1].content, "[REDACTED]");
    assert.equal(records[2].tool_calls[0].id, "task-1");
    assert.equal(records[2].usage.totalTokens, 60);
    assert.equal(records[2].usageModel, model);
    assert.equal(records[3].agentId, "explorer-1");
    assert.equal(records[3].usage.totalTokens, 120);
    assert.equal(records[3].usageModel, model);
    assert.equal(records[4].tool_call_id, "task-1");
});

test("keeps standalone usage records at their original event position", () => {
    const records = normalizeCopilotTrajectory(
        [
            event("system.message", { role: "system", content: "system" }),
            event("user.message", { content: "query" }),
            event("assistant.message", {
                messageId: "before",
                model,
                content: "before usage",
            }),
            event("assistant.usage", {
                model,
                inputTokens: 10,
                outputTokens: 2,
            }),
            event("assistant.message", {
                messageId: "after",
                model,
                content: "after usage",
            }),
        ],
        model,
        [],
    );

    assert.deepEqual(
        records.slice(2).map((record) => record.sourceEvent),
        ["assistant.message", "assistant.usage", "assistant.message"],
    );
});

test("retains a failed subagent as the terminal task result without duplicating real completions", async (t) => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "explore-trajectory-subagent-failure-"),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    const files = createTrajectoryFiles(
        path.join(directory, "results.jsonl"),
        "failed-subagent",
        model,
        "baseline",
        1,
    );
    const records = normalizeCopilotTrajectory(
        [
            event("system.message", { role: "system", content: "system" }),
            event("user.message", { content: "query" }),
            event("assistant.message", {
                messageId: "delegations",
                model,
                content: "",
                toolRequests: [
                    {
                        toolCallId: "failed-task",
                        name: "task",
                        arguments: { agent_type: "explorer" },
                    },
                    {
                        toolCallId: "completed-task",
                        name: "task",
                        arguments: { agent_type: "explorer" },
                    },
                ],
            }),
            event("subagent.failed", {
                toolCallId: "failed-task",
                agentName: "explorer",
                error: "subagent failed",
            }),
            event("subagent.failed", {
                toolCallId: "completed-task",
                agentName: "explorer",
                error: "transient failure event",
            }),
            event("subagent.failed", {
                toolCallId: "orphan-task",
                agentName: "explorer",
                error: "unrelated failure",
            }),
            event("tool.execution_complete", {
                toolCallId: "completed-task",
                success: true,
                model,
                result: { content: "completed result" },
            }),
        ],
        model,
        [],
    );

    assert.deepEqual(
        records
            .filter((record) => record.role === "tool")
            .map((record) => ({
                toolCallId: record.tool_call_id,
                content: record.content,
                sourceEvent: record.sourceEvent,
                success: record.success,
            })),
        [
            {
                toolCallId: "failed-task",
                content: "subagent failed",
                sourceEvent: "subagent.failed",
                success: false,
            },
            {
                toolCallId: "completed-task",
                content: "completed result",
                sourceEvent: "tool.execution_complete",
                success: true,
            },
        ],
    );
    await writeTrajectoryFile(files.main, records);
    await assert.doesNotReject(
        validateTrajectoryFile(
            files.main,
            expectation("failed-subagent", "baseline", 1, "main"),
        ),
    );
});

test("retains the terminal session error after assistant reasoning", () => {
    const records = normalizeCopilotTrajectory(
        [
            event("system.message", { role: "system", content: "system" }),
            event("user.message", { content: "query" }),
            event("assistant.reasoning", { content: "checking" }),
            event("session.error", {
                errorType: "query",
                message: "provider secret failed",
            }),
        ],
        model,
        ["secret"],
        {
            system: "fallback system",
            user: "fallback query",
            failure: "fallback failure",
        },
    );

    assert.deepEqual(
        records.map(({ role, content, sourceEvent, success, messageKind }) => ({
            role,
            content,
            sourceEvent,
            success,
            messageKind,
        })),
        [
            {
                role: "system",
                content: "system",
                sourceEvent: "system.message",
                success: undefined,
                messageKind: undefined,
            },
            {
                role: "user",
                content: "query",
                sourceEvent: "user.message",
                success: undefined,
                messageKind: undefined,
            },
            {
                role: "assistant",
                content: "checking",
                sourceEvent: "assistant.reasoning",
                success: undefined,
                messageKind: "reasoning",
            },
            {
                role: "assistant",
                content: "provider [REDACTED] failed",
                sourceEvent: "session.error",
                success: false,
                messageKind: "model_error",
            },
        ],
    );
});

test("writes and validates a complete trajectory, rejecting wrong models", async (t) => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "explore-trajectory-"),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    const files = createTrajectoryFiles(
        path.join(directory, "results.jsonl"),
        "row",
        model,
        "baseline",
        1,
    );
    const records = normalizeCopilotTrajectory(
        [
            event("system.message", {
                role: "system",
                content: "system",
            }),
            event("user.message", { content: "query" }),
            event("assistant.message", {
                messageId: "answer",
                model,
                content: "answer",
            }),
        ],
        model,
        [],
    );

    await writeTrajectoryFile(files.main, records);
    await validateTrajectoryFile(
        files.main,
        expectation("row", "baseline", 1, "main"),
    );
    const wrongModelFiles = createTrajectoryFiles(
        path.join(directory, "results.jsonl"),
        "wrong-record-model",
        model,
        "baseline",
        1,
    );
    await writeTrajectoryFile(
        wrongModelFiles.main,
        records.map((record) => ({
            ...record,
            model: "azure/gpt-5.6-sol",
        })),
    );
    await assert.rejects(
        validateTrajectoryFile(
            wrongModelFiles.main,
            expectation("wrong-record-model", "baseline", 1, "main"),
        ),
        /does not match expected model/,
    );
    assert.equal(
        (await readFile(files.main, "utf8")).trim().split("\n").length,
        3,
    );
    assert.equal((await stat(files.main)).mode & 0o777, 0o600);
    await assert.rejects(
        writeTrajectoryFile(files.main, records),
        (error: NodeJS.ErrnoException) => error.code === "EEXIST",
    );
});

test("preserves native MCP response content and recursively redacts distinct secrets", () => {
    const records = normalizeCopilotTrajectory(
        [
            event("system.message", { role: "system", content: "system" }),
            event("user.message", { content: "query outer-secret" }),
            event("assistant.message", {
                messageId: "call",
                model,
                content: "",
                toolRequests: [
                    {
                        toolCallId: "call-1",
                        name: "explore",
                        arguments: {
                            nested: [{ credential: "inner-secret" }],
                        },
                    },
                ],
            }),
            event("tool.execution_complete", {
                toolCallId: "call-1",
                success: true,
                model,
                result: {
                    content: "concise response",
                    contents: [
                        {
                            type: "text",
                            text: "full native response inner-secret",
                        },
                    ],
                },
            }),
        ],
        model,
        ["outer-secret", "inner-secret"],
    );

    const serialized = JSON.stringify(records);
    assert.doesNotMatch(serialized, /outer-secret|inner-secret/);
    assert.equal(records.at(-1)?.content, "full native response [REDACTED]");
    assert.deepEqual(records[2].tool_calls[0].function.arguments, {
        nested: [{ credential: "[REDACTED]" }],
    });
});

test("binds trajectories to row, arm, attempt, system, source, and observed model", async (t) => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "explore-trajectory-identity-"),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    const files = createTrajectoryFiles(
        path.join(directory, "results.jsonl"),
        "row-a",
        model,
        "typeagent",
        2,
    );
    const mainRecords = completeRecords("copilot-sdk");
    const codeModeRecords = completeCodeModeRecords();
    await writeTrajectoryFile(files.main, mainRecords);
    await writeTrajectoryFile(files.codeMode!, codeModeRecords);

    await validateTrajectoryFile(
        files.main,
        expectation("row-a", "typeagent", 2, "main"),
    );
    await validateTrajectoryFile(
        files.codeMode!,
        expectation("row-a", "typeagent", 2, "codemode"),
    );
    await assert.rejects(
        validateTrajectoryFile(
            files.main,
            expectation("row-b", "typeagent", 2, "main"),
        ),
        /path does not match/i,
    );
    await assert.rejects(
        validateTrajectoryFile(
            files.main,
            expectation("row-a", "typeagent", 1, "main"),
        ),
        /path does not match/i,
    );
    await assert.rejects(
        validateTrajectoryFile(
            files.main,
            expectation("row-a", "typeagent", 2, "codemode"),
        ),
        /path does not match|source/i,
    );

    const wrongObserved = createTrajectoryFiles(
        path.join(directory, "results.jsonl"),
        "wrong-model",
        model,
        "baseline",
        1,
    );
    await writeTrajectoryFile(
        wrongObserved.main,
        completeRecords("copilot-sdk", "azure/gpt-5.6-sol"),
    );
    await assert.rejects(
        validateTrajectoryFile(
            wrongObserved.main,
            expectation("wrong-model", "baseline", 1, "main"),
        ),
        /usage model/i,
    );

    const sdkAliasFiles = createTrajectoryFiles(
        path.join(directory, "results.jsonl"),
        "sdk-alias",
        model,
        "baseline",
        1,
    );
    await writeTrajectoryFile(
        sdkAliasFiles.main,
        normalizeCopilotTrajectory(
            [
                event("system.message", {
                    role: "system",
                    content: "system",
                }),
                event("user.message", { content: "query" }),
                event("assistant.message", {
                    apiCallId: "shared-api-call",
                    messageId: "partial",
                    model: "gpt-5",
                    content: "partial",
                }),
                event("assistant.message", {
                    apiCallId: "shared-api-call",
                    messageId: "final",
                    model: "gpt-5",
                    content: "final",
                }),
                event("assistant.usage", {
                    apiCallId: "shared-api-call",
                    model,
                    inputTokens: 10,
                    outputTokens: 2,
                }),
            ],
            model,
            [],
        ),
    );
    await validateTrajectoryFile(
        sdkAliasFiles.main,
        expectation("sdk-alias", "baseline", 1, "main"),
    );
    const sdkAliasRecords = (await readFile(sdkAliasFiles.main, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as NormalizedTrajectoryRecord);
    assert.deepEqual(
        sdkAliasRecords
            .filter((record) => record.role === "assistant")
            .map((record) => ({
                content: record.content,
                observedModel: record.observedModel,
                usageModel: record.usageModel,
                totalTokens: record.usage.totalTokens,
            })),
        [
            {
                content: "partial",
                observedModel: "gpt-5",
                usageModel: undefined,
                totalTokens: undefined,
            },
            {
                content: "final",
                observedModel: "gpt-5",
                usageModel: model,
                totalTokens: 12,
            },
        ],
    );
});

test("cross-validates Code Mode request indices and usage with Explorer telemetry", async (t) => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "explore-trajectory-codemode-usage-"),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    const usage = {
        requestCount: 3,
        usageComplete: true,
        inputTokens: 60,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 9,
        reasoningOutputTokens: 0,
        totalTokens: 69,
    };
    const files = createTrajectoryFiles(
        path.join(directory, "results.jsonl"),
        "row",
        model,
        "typeagent",
        1,
    );
    await writeTrajectoryFile(files.main, completeRecords("copilot-sdk"));
    await writeTrajectoryFile(files.codeMode!, completeCodeModeRecords());
    const row = codeModeRow("row", files, usage);

    await assert.doesNotReject(validateRunTrajectoryFiles([row]));

    const multipleInvocations = structuredClone(row);
    const codeModeFiles = codeModeTrajectoryFiles(files.codeMode!, 2);
    await writeTrajectoryFile(codeModeFiles[1], completeCodeModeRecords());
    multipleInvocations.trajectoryFiles!.codeModeInvocations = codeModeFiles;
    multipleInvocations.exploreTelemetry!.invocations = [
        {
            ...multipleInvocations.exploreTelemetry!.invocations![0],
            index: 0,
            usage,
        },
        {
            ...multipleInvocations.exploreTelemetry!.invocations![0],
            index: 1,
            usage,
        },
    ];
    multipleInvocations.exploreTelemetry!.usage = {
        ...usage,
        requestCount: 6,
        inputTokens: 120,
        outputTokens: 18,
        totalTokens: 138,
    };
    await assert.doesNotReject(
        validateRunTrajectoryFiles([multipleInvocations]),
    );

    const swappedInvocations = structuredClone(multipleInvocations);
    swappedInvocations.exploreTelemetry!.invocations![0].index = 1;
    swappedInvocations.exploreTelemetry!.invocations![1].index = 0;
    await assert.rejects(
        validateRunTrajectoryFiles([swappedInvocations]),
        /invocation index.*position|position.*invocation index/i,
    );

    const duplicateInvocations = structuredClone(multipleInvocations);
    duplicateInvocations.exploreTelemetry!.invocations![1].index = 0;
    await assert.rejects(
        validateRunTrajectoryFiles([duplicateInvocations]),
        /invocation index.*position|position.*invocation index/i,
    );

    const skippedInvocation = structuredClone(multipleInvocations);
    skippedInvocation.exploreTelemetry!.invocations![1].index = 2;
    await assert.rejects(
        validateRunTrajectoryFiles([skippedInvocation]),
        /invocation index.*position|position.*invocation index/i,
    );

    const mismatchedUsage = structuredClone(row);
    mismatchedUsage.ok = false;
    mismatchedUsage.exploreTelemetry!.status = "failed";
    mismatchedUsage.exploreTelemetry!.invocations![0].status = "failed";
    mismatchedUsage.exploreTelemetry!.invocations![0].usage.inputTokens++;
    mismatchedUsage.exploreTelemetry!.invocations![0].usage.totalTokens++;
    await assert.rejects(
        validateRunTrajectoryFiles([mismatchedUsage]),
        /request indices and usage.*Explorer telemetry/i,
    );

    const skippedFiles = createTrajectoryFiles(
        path.join(directory, "results.jsonl"),
        "skipped-index",
        model,
        "typeagent",
        1,
    );
    await writeTrajectoryFile(
        skippedFiles.main,
        completeRecords("copilot-sdk"),
    );
    await writeTrajectoryFile(
        skippedFiles.codeMode!,
        completeCodeModeRecords([1, 2, 4]),
    );
    await assert.rejects(
        validateRunTrajectoryFiles([
            codeModeRow("skipped-index", skippedFiles, usage, false),
        ]),
        /request indices and usage.*Explorer telemetry/i,
    );
});

test("cross-validates main request count and usage with result usage", async (t) => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "explore-trajectory-main-usage-"),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    const files = createTrajectoryFiles(
        path.join(directory, "results.jsonl"),
        "main-usage",
        model,
        "baseline",
        1,
    );
    await writeTrajectoryFile(files.main, completeRecords("copilot-sdk"));
    const row = {
        taskId: "main-usage",
        model,
        variant: "baseline",
        attempt: 1,
        usage: completeMainUsage(),
        trajectoryFiles: files,
    } as RunResult;

    await assert.doesNotReject(validateRunTrajectoryFiles([row]));
    await assert.rejects(
        validateRunTrajectoryFiles([
            {
                ...row,
                usage: {
                    ...row.usage!,
                    outputTokens: row.usage!.outputTokens + 1,
                    totalTokens: row.usage!.totalTokens + 1,
                },
            },
        ]),
        /main trajectory request count and usage.*result usage/i,
    );
    const missingUsage = structuredClone(row);
    delete missingUsage.usage;
    await assert.rejects(
        validateRunTrajectoryFiles([missingUsage]),
        /main trajectory has usage.*missing from the result row/i,
    );
});

test("rejects malformed, dangling, duplicate, and permission-unsafe trajectories", async (t) => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "explore-trajectory-invalid-"),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));

    const cases: Array<{
        name: string;
        records: NormalizedTrajectoryRecord[];
        error: RegExp;
    }> = [
        {
            name: "dangling",
            records: completeRecords("copilot-sdk").slice(0, -1),
            error: /without exactly one tool result/i,
        },
        {
            name: "duplicate-call",
            records: [
                ...completeRecords("copilot-sdk").slice(0, 3),
                { ...completeRecords("copilot-sdk")[2], sequence: 4 },
                { ...completeRecords("copilot-sdk")[3], sequence: 5 },
            ],
            error: /duplicate tool call/i,
        },
        {
            name: "orphan",
            records: [
                ...completeRecords("copilot-sdk").slice(0, 2),
                {
                    ...completeRecords("copilot-sdk")[3],
                    sequence: 3,
                    tool_call_id: "orphan",
                },
                {
                    ...completeRecords("copilot-sdk")[2],
                    sequence: 4,
                },
            ],
            error: /before its assistant call|without assistant call/i,
        },
    ];
    for (const candidate of cases) {
        const files = createTrajectoryFiles(
            path.join(directory, "results.jsonl"),
            candidate.name,
            model,
            "baseline",
            1,
        );
        await writeTrajectoryFile(files.main, candidate.records);
        await assert.rejects(
            validateTrajectoryFile(
                files.main,
                expectation(candidate.name, "baseline", 1, "main"),
            ),
            candidate.error,
        );
    }

    const unsafe = createTrajectoryFiles(
        path.join(directory, "results.jsonl"),
        "unsafe",
        model,
        "baseline",
        1,
    );
    await writeTrajectoryFile(unsafe.main, completeRecords("copilot-sdk"));
    await chmod(unsafe.main, 0o644);
    await assert.rejects(
        validateTrajectoryFile(
            unsafe.main,
            expectation("unsafe", "baseline", 1, "main"),
        ),
        /mode 0600/i,
    );
});

test("writes a complete redacted Code Mode-unavailable trajectory", async (t) => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "explore-trajectory-unavailable-"),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    const files = createTrajectoryFiles(
        path.join(directory, "results.jsonl"),
        "failed-row",
        model,
        "typeagent-lsp",
        1,
    );
    const identity = expectation("failed-row", "typeagent-lsp", 1, "codemode");

    await writeTrajectoryFile(files.main, completeRecords("copilot-sdk"));
    await writeUnavailableTrajectoryFile(
        files.codeMode!,
        identity,
        "query outer-secret",
        "failed before inner-secret Code Mode",
        ["outer-secret", "inner-secret"],
    );
    await validateTrajectoryFile(files.codeMode!, identity);
    const text = await readFile(files.codeMode!, "utf8");
    assert.doesNotMatch(text, /outer-secret|inner-secret/);
    assert.match(text, /Code Mode did not start/);
    assert.equal((await stat(files.codeMode!)).mode & 0o777, 0o600);
    await assert.doesNotReject(
        validateRunTrajectoryFiles([
            {
                taskId: "failed-row",
                model,
                variant: "typeagent-lsp",
                attempt: 1,
                ok: false,
                usage: completeMainUsage(),
                trajectoryFiles: files,
                exploreTelemetry: {
                    schemaVersion: 4,
                    model,
                    status: "failed",
                    usage: {
                        requestCount: 0,
                        usageComplete: false,
                        inputTokens: 0,
                        cachedInputTokens: 0,
                        cacheWriteTokens: 0,
                        outputTokens: 0,
                        reasoningOutputTokens: 0,
                        totalTokens: 0,
                    },
                    toolTrace: {
                        calls: [],
                        totalCalls: 0,
                        totalOutputBytes: 0,
                    },
                    invocations: [
                        {
                            index: 0,
                            status: "failed",
                            usage: {
                                requestCount: 0,
                                usageComplete: false,
                                inputTokens: 0,
                                cachedInputTokens: 0,
                                cacheWriteTokens: 0,
                                outputTokens: 0,
                                reasoningOutputTokens: 0,
                                totalTokens: 0,
                            },
                            toolTrace: {
                                calls: [],
                                totalCalls: 0,
                                totalOutputBytes: 0,
                            },
                        },
                    ],
                },
            } as unknown as RunResult,
        ]),
    );
});

test("rejects unavailable traces outside failed zero-request invocations", async (t) => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "explore-trajectory-unavailable-invalid-"),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    const cases = [
        { row: "completed-zero", status: "completed", requestCount: 0 },
        { row: "failed-charged", status: "failed", requestCount: 1 },
    ] as const;

    for (const candidate of cases) {
        const files = createTrajectoryFiles(
            path.join(directory, "results.jsonl"),
            candidate.row,
            model,
            "typeagent",
            1,
        );
        const identity = expectation(candidate.row, "typeagent", 1, "codemode");
        const usage = {
            requestCount: candidate.requestCount,
            usageComplete: candidate.status === "completed",
            inputTokens: 0,
            cachedInputTokens: 0,
            cacheWriteTokens: 0,
            outputTokens: 0,
            reasoningOutputTokens: 0,
            totalTokens: 0,
        };
        await writeTrajectoryFile(files.main, completeRecords("copilot-sdk"));
        await writeUnavailableTrajectoryFile(
            files.codeMode!,
            identity,
            "query",
            "failed",
            [],
        );
        const row = codeModeRow(
            candidate.row,
            files,
            usage,
            candidate.status === "completed",
        );
        row.exploreTelemetry!.status = candidate.status;
        row.exploreTelemetry!.invocations![0].status = candidate.status;

        await assert.rejects(
            validateRunTrajectoryFiles([row]),
            /request indices and usage.*Explorer telemetry/i,
        );
    }
});

test("rejects a started Code Mode trajectory when telemetry is missing", async (t) => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "explore-trajectory-missing-telemetry-"),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    const files = createTrajectoryFiles(
        path.join(directory, "results.jsonl"),
        "failed-row",
        model,
        "typeagent",
        1,
    );
    await writeTrajectoryFile(files.main, completeRecords("copilot-sdk"));
    await writeTrajectoryFile(files.codeMode!, completeCodeModeRecords());

    await assert.rejects(
        validateRunTrajectoryFiles([
            {
                taskId: "failed-row",
                model,
                variant: "typeagent",
                attempt: 1,
                ok: false,
                usage: completeMainUsage(),
                trajectoryFiles: files,
            } as unknown as RunResult,
        ]),
        /missing Explorer telemetry/i,
    );
});

test("requires one unavailable Code Mode trajectory per attempted execution when telemetry is incomplete", async (t) => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "explore-trajectory-incomplete-telemetry-"),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));

    for (const telemetryCount of [0, 1]) {
        const taskId = `failed-${telemetryCount}`;
        const files = createTrajectoryFiles(
            path.join(directory, "results.jsonl"),
            taskId,
            model,
            "typeagent",
            1,
        );
        const codeModeFiles = codeModeTrajectoryFiles(files.codeMode!, 2);
        files.codeModeInvocations = codeModeFiles;
        await writeTrajectoryFile(files.main, completeRecords("copilot-sdk"));
        await Promise.all(
            codeModeFiles.map((file, invocationIndex) =>
                writeUnavailableTrajectoryFile(
                    file,
                    {
                        ...expectation(taskId, "typeagent", 1, "codemode"),
                        invocationIndex,
                    },
                    "query",
                    "Code Mode did not produce a trajectory",
                    [],
                ),
            ),
        );
        const row = {
            taskId,
            model,
            variant: "typeagent",
            attempt: 1,
            ok: false,
            usage: completeMainUsage(),
            attemptedExploreCalls: 2,
            trajectoryFiles: files,
            ...(telemetryCount === 1
                ? {
                      exploreTelemetry: {
                          schemaVersion: 4,
                          model,
                          status: "failed",
                          usage: emptyIncompleteUsage(),
                          toolTrace: {
                              calls: [],
                              totalCalls: 0,
                              totalOutputBytes: 0,
                          },
                          invocations: [
                              {
                                  index: 0,
                                  status: "failed",
                                  usage: emptyIncompleteUsage(),
                                  toolTrace: {
                                      calls: [],
                                      totalCalls: 0,
                                      totalOutputBytes: 0,
                                  },
                              },
                          ],
                      },
                  }
                : {}),
        } as unknown as RunResult;

        await assert.doesNotReject(validateRunTrajectoryFiles([row]));

        const missing = structuredClone(row);
        missing.trajectoryFiles!.codeModeInvocations = [codeModeFiles[0]];
        await assert.rejects(
            validateRunTrajectoryFiles([missing]),
            /every Code Mode invocation trajectory/i,
        );
    }
});

test("synthesizes the known system and user messages when session creation fails", () => {
    const records = normalizeCopilotTrajectory([], model, [], {
        system: "benchmark system",
        user: "benchmark query",
    });

    assert.deepEqual(
        records.map(({ role, content }) => ({ role, content })),
        [
            { role: "system", content: "benchmark system" },
            { role: "user", content: "benchmark query" },
        ],
    );
});

test("does not mistake child messages for the missing root prompt", () => {
    const records = normalizeCopilotTrajectory(
        [
            event(
                "system.message",
                { role: "system", content: "child system" },
                "explorer-1",
            ),
            event("user.message", { content: "child query" }, "explorer-1"),
        ],
        model,
        [],
        { system: "root system", user: "root query" },
    );

    assert.deepEqual(
        records.slice(0, 2).map(({ role, content, agentId }) => ({
            role,
            content,
            agentId,
        })),
        [
            { role: "system", content: "root system", agentId: undefined },
            { role: "user", content: "root query", agentId: undefined },
        ],
    );
});

function event(
    type: SessionEvent["type"],
    data: Record<string, unknown>,
    agentId?: string,
): SessionEvent {
    return {
        id: `${type}-${Math.random()}`,
        parentId: null,
        timestamp: "2026-07-26T00:00:00.000Z",
        type,
        data,
        ...(agentId ? { agentId } : {}),
    } as SessionEvent;
}

function expectation(
    rowName: string,
    variant: BenchmarkVariant,
    attempt: number,
    system: "main" | "codemode",
) {
    return { rowName, model, variant, attempt, system } as const;
}

function completeRecords(
    source: "copilot-sdk" | "typeagent-codemode",
    observedModel = model,
): NormalizedTrajectoryRecord[] {
    return [
        record(1, "system", source, { content: "system" }),
        record(2, "user", source, { content: "query" }),
        record(3, "assistant", source, {
            content: "",
            observedModel,
            tool_calls: [
                {
                    id: "call-1",
                    type: "function",
                    function: { name: "explore", arguments: {} },
                },
            ],
            usage: {
                inputTokens: 10,
                cachedInputTokens: 0,
                outputTokens: 2,
                reasoningOutputTokens: 0,
                totalTokens: 12,
            },
        }),
        record(4, "tool", source, {
            content: "result",
            tool_call_id: "call-1",
        }),
    ];
}

function completeCodeModeRecords(
    requestIndices: readonly [number, number, number] = [1, 2, 3],
): NormalizedTrajectoryRecord[] {
    return [
        record(1, "system", "typeagent-codemode", { content: "system" }),
        record(2, "user", "typeagent-codemode", { content: "query" }),
        record(3, "assistant", "typeagent-codemode", {
            requestIndex: requestIndices[0],
            tool_calls: [
                {
                    id: "discover-call",
                    type: "function",
                    function: {
                        name: "execute_action",
                        arguments: {
                            action: { actionName: "discoverRepository" },
                        },
                    },
                },
            ],
            usage: {
                inputTokens: 10,
                cachedInputTokens: 0,
                outputTokens: 2,
                reasoningOutputTokens: 0,
                totalTokens: 12,
            },
        }),
        record(4, "tool", "typeagent-codemode", {
            content: "discovery",
            tool_call_id: "discover-call",
        }),
        record(5, "assistant", "typeagent-codemode", {
            requestIndex: requestIndices[1],
            tool_calls: [
                {
                    id: "refine-call",
                    type: "function",
                    function: {
                        name: "execute_action",
                        arguments: {
                            action: {
                                actionName: "refineRepository",
                            },
                        },
                    },
                },
            ],
            usage: {
                inputTokens: 20,
                cachedInputTokens: 0,
                outputTokens: 3,
                reasoningOutputTokens: 0,
                totalTokens: 23,
            },
        }),
        record(6, "tool", "typeagent-codemode", {
            content: "refinement",
            tool_call_id: "refine-call",
        }),
        record(7, "assistant", "typeagent-codemode", {
            requestIndex: requestIndices[2],
            tool_calls: [
                {
                    id: "submit-call",
                    type: "function",
                    function: {
                        name: "execute_action",
                        arguments: {
                            action: { actionName: "submitExploration" },
                        },
                    },
                },
            ],
            usage: {
                inputTokens: 30,
                cachedInputTokens: 0,
                outputTokens: 4,
                reasoningOutputTokens: 0,
                totalTokens: 34,
            },
        }),
        record(8, "tool", "typeagent-codemode", {
            content: "submission",
            tool_call_id: "submit-call",
        }),
    ];
}

function codeModeRow(
    taskId: string,
    trajectoryFiles: NonNullable<RunResult["trajectoryFiles"]>,
    usage: NonNullable<
        NonNullable<RunResult["exploreTelemetry"]>["invocations"]
    >[number]["usage"],
    ok = true,
): RunResult {
    return {
        taskId,
        model,
        variant: "typeagent",
        attempt: 1,
        ok,
        usage: completeMainUsage(),
        trajectoryFiles,
        exploreTelemetry: {
            schemaVersion: 4,
            model,
            status: ok ? "completed" : "failed",
            usage,
            toolTrace: { calls: [], totalCalls: 0, totalOutputBytes: 0 },
            invocations: [
                {
                    index: 0,
                    status: ok ? "completed" : "failed",
                    usage,
                    toolTrace: {
                        calls: [],
                        totalCalls: 0,
                        totalOutputBytes: 0,
                    },
                },
            ],
        },
    } as unknown as RunResult;
}

function completeMainUsage(): NonNullable<RunResult["usage"]> {
    return {
        requestCount: 1,
        usageComplete: true,
        source: "assistant.usage",
        models: [model],
        inputTokens: 10,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 2,
        reasoningOutputTokens: 0,
        totalTokens: 12,
    };
}

function emptyIncompleteUsage() {
    return {
        requestCount: 0,
        usageComplete: false,
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
    };
}

function record(
    sequence: number,
    role: NormalizedTrajectoryRecord["role"],
    source: "copilot-sdk" | "typeagent-codemode",
    overrides: Partial<NormalizedTrajectoryRecord> = {},
): NormalizedTrajectoryRecord {
    return {
        schemaVersion: 1,
        sequence,
        role,
        content: "",
        model,
        tool_call_id: null,
        tool_calls: [],
        usage: {},
        source,
        ...overrides,
    };
}

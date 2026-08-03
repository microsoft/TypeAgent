// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertAcceptanceGate } from "../src/acceptance.js";
import {
    benchmarkPrefixLimits,
    summarizeRows,
    writeReports,
} from "../src/report.js";
import { scoreSwebench } from "../src/score.js";
import type { RunManifest, RunResult } from "../src/types.js";

const patch = `diff --git a/pkg/a.py b/pkg/a.py
--- a/pkg/a.py
+++ b/pkg/a.py
@@ -10,1 +10,1 @@
-old
+new
`;

test("adds report prefixes only when the run contains enough tasks", () => {
    assert.deepEqual(benchmarkPrefixLimits(10), [1, 5, 10]);
    assert.deepEqual(benchmarkPrefixLimits(20), [1, 5, 10, 20]);
    assert.deepEqual(benchmarkPrefixLimits(30), [1, 5, 10, 20, 30]);
    assert.deepEqual(benchmarkPrefixLimits(100), [1, 5, 10, 20, 30, 50, 100]);
    assert.deepEqual(
        benchmarkPrefixLimits(1000),
        [1, 5, 10, 20, 30, 50, 100, 500, 1000],
    );
});

test("writes paired 1/5/10 prefix comparisons", async () => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "explore-bench-report-"),
    );
    try {
        const taskIds = Array.from(
            { length: 10 },
            (_, index) => `repo__repo-${index}`,
        );
        const manifest: RunManifest = {
            schemaVersion: 1,
            runId: "report-test",
            createdAt: new Date(0).toISOString(),
            dataset: "princeton-nlp/SWE-bench_Verified",
            split: "test",
            taskSeed: "report-test-seed",
            taskIds,
            matrix: [
                { name: "model-b", model: "route-b" },
                { name: "model-a", model: "route-a" },
            ],
            variants: ["baseline", "typeagent"],
            output: path.join(directory, "results.jsonl"),
            copilotPath: "/native/copilot",
            runtimeEvidence: path.join(directory, "copilot-runtime.json"),
            provider: {
                type: "openai-compatible",
                baseUrl: "http://localhost:4627/v1",
                apiKeyEnv: "CUSTOM_PROVIDER_API_KEY",
                wireApi: "responses",
            },
            mcp: { command: "/mcp/server", args: [], envVars: [] },
            agent: {
                name: "explorer",
                description: "benchmark explorer",
                tools: ["read", "grep", "glob", "bash"],
                prompt: "explore only",
                file: "/repo/.copilot/agents/explorer.md",
                sha256: "a".repeat(64),
            },
            maxConcurrency: 2,
            maxAttempts: 2,
            timeoutMs: 300_000,
            dockerPlatform: "linux/amd64",
        };
        const rows = taskIds.flatMap((taskId, index) =>
            [
                { matrixName: "model-a", model: "route-a" },
                { matrixName: "model-b", model: "route-b" },
            ].flatMap(({ matrixName, model }) =>
                (["baseline", "typeagent"] as const).map((variant) =>
                    reportResult(
                        manifest,
                        taskId,
                        index,
                        matrixName,
                        model,
                        variant,
                    ),
                ),
            ),
        );
        const incompleteRows = rows.filter(
            (row) =>
                !(
                    row.taskId === taskIds[9] &&
                    row.matrixName === "model-a" &&
                    row.variant === "typeagent"
                ) &&
                !(
                    row.taskId === taskIds[0] &&
                    row.matrixName === "model-b" &&
                    row.variant === "typeagent"
                ),
        );
        incompleteRows[0].attempt = 2;
        const {
            combinedUsage: _missingCombinedUsage,
            ...measuredUsageAttempt
        } = incompleteRows[0];
        const missingUsageAttempt = {
            ...measuredUsageAttempt,
            attempt: 1,
            usage: {
                ...measuredUsageAttempt.usage,
                usageComplete: false,
            },
        };
        const rawRows = [
            {
                ...missingUsageAttempt,
                ok: false,
                durationMs: 999,
                finalAnswer: "malformed",
            },
            ...incompleteRows,
            {
                ...rows.find(
                    (row) =>
                        row.taskId === taskIds[0] &&
                        row.matrixName === "model-b" &&
                        row.variant === "typeagent",
                )!,
                ok: false,
                finalAnswer:
                    "<final_answer>\npkg/a.py:10 reason\n</final_answer>",
                error: "provider failed",
            },
        ];
        await writeFile(
            path.join(directory, "manifest.json"),
            JSON.stringify(manifest),
        );
        await writeFile(
            path.join(directory, "results.jsonl"),
            `${rawRows.map((row) => JSON.stringify(row)).join("\n")}\n`,
        );

        const { report, markdownPath } = await writeReports(
            path.join(directory, "results.jsonl"),
        );
        assert.deepEqual(Object.keys(report.prefixes), ["1", "5", "10"]);
        assert.equal(report.schemaVersion, 3);
        assert.equal(report.rawRows, 40);
        assert.equal(report.dedupedRows, 39);
        assert.deepEqual(
            report.prefixes["10"].leaderboard.map(
                (row) => `${row.matrixName}:${row.variant}`,
            ),
            [
                "model-b:baseline",
                "model-b:typeagent",
                "model-a:baseline",
                "model-a:typeagent",
            ],
        );
        assert.deepEqual(
            report.prefixes["10"].comparisons.map((row) => row.matrixName),
            ["model-b", "model-a"],
        );
        assert.equal(report.prefixes["10"].expectedPairs, 20);
        assert.equal(report.prefixes["10"].pairedPairs, 18);
        assert.equal(report.prefixes["10"].complete, false);
        assert.equal(report.prefixes["10"].comparisons[0].pairedPairs, 9);
        assert.equal(report.prefixes["10"].comparisons[0].complete, false);
        assert.deepEqual(
            report.prefixes["10"].comparisons[0].missingTreatmentTaskIds,
            [taskIds[0]],
        );
        assert.equal(report.prefixes["10"].comparisons[1].pairedPairs, 9);
        assert.equal(report.prefixes["10"].comparisons[1].complete, false);
        assert.deepEqual(
            report.prefixes["10"].comparisons[1].missingTreatmentTaskIds,
            [taskIds[9]],
        );
        assert.equal(
            report.prefixes["10"].comparisons[0].avgDurationMsDelta,
            20,
        );
        assert.equal(
            report.prefixes["10"].comparisons[0].totalTokensDelta,
            -405,
        );
        assert.equal(
            report.prefixes["10"].comparisons[1].totalTokensDelta,
            -405,
        );
        const treatment = report.prefixes["10"].leaderboard.find(
            (row) =>
                row.matrixName === "model-b" && row.variant === "typeagent",
        );
        assert.equal(treatment?.copilotUsage?.totalTokens, 250);
        assert.equal(treatment?.typeAgentUsage?.totalTokens, 400);
        assert.equal(treatment?.combinedUsage?.totalTokens, 650);
        assert.equal(treatment?.overallRecall, 0.9);
        assert.equal(treatment?.file.recall, 0.9);
        assert.equal(treatment?.line.recall, 0.9);
        const baseline = report.prefixes["10"].leaderboard.find(
            (row) => row.matrixName === "model-b" && row.variant === "baseline",
        );
        assert.equal(baseline?.copilotUsage?.totalTokens, 1_100);
        assert.equal(baseline?.typeAgentUsage, undefined);
        assert.equal(baseline?.combinedUsage?.totalTokens, 1_100);
        const retriedBaseline = report.prefixes["10"].leaderboard.find(
            (row) => row.matrixName === "model-a" && row.variant === "baseline",
        );
        assert.equal(retriedBaseline?.copilotUsage?.totalTokens, 1_100);
        assert.equal(retriedBaseline?.combinedUsage?.totalTokens, 1_100);
        assert.equal(retriedBaseline?.finalAttemptUsage?.totalTokens, 1_100);
        assert.equal(
            report.tasks[0].results["model-a:typeagent"].typeAgentToolTrace
                ?.totalCalls,
            1,
        );
        assert.equal(report.prefixes["10"].comparisons[0].mcpAdoptionRate, 1);
        assert.equal(
            report.prefixes["10"].comparisons[0].baseline?.finalAttemptTokens,
            990,
        );
        assert.equal(
            report.prefixes["10"].comparisons[0].treatment?.finalAttemptTokens,
            585,
        );
        assert.deepEqual(
            Object.keys(report.prefixes["10"].comparisons[0]).filter((key) =>
                ["baseline", "treatment"].includes(key),
            ),
            ["baseline", "treatment"],
        );
        assert.doesNotMatch(JSON.stringify(report), /withoutMcp|withMcp/);
        assert.equal(
            report.tasks[0].results["model-a:typeagent"].mcpAdopted,
            true,
        );
        assert.equal(
            report.tasks[0].results["model-a:typeagent"].usage?.totalTokens,
            25,
        );
        assert.equal(path.basename(markdownPath), "report.md");
        const markdown = await readFile(markdownPath, "utf8");
        assert.match(
            markdown,
            /Selected 10-task prefix \(seeded random, seed "report-test-seed"\)/,
        );
        assert.doesNotMatch(markdown, /\| Model \| Variant \|/);
        assert.doesNotMatch(markdown, /### TypeAgent MCP − baseline/);
        assert.match(
            markdown,
            /\| Model \| Treatment arm \| Paired \| Copilot SDK completed \| Treatment completed \| Copilot SDK final tokens \| Treatment final tokens \(outer Copilot \+ inner Explorer\) \| Final tokens saved \| Copilot SDK latency mean\/P50\/P95 \| Treatment latency mean\/P50\/P95 \| Copilot SDK recall \| Treatment recall \| Copilot SDK file P\/R\/F1 \| Treatment file P\/R\/F1 \| Copilot SDK line P\/R\/F1 \| Treatment line P\/R\/F1 \| Explore agent used \| TypeAgent MCP used \|/,
        );
        assert.match(markdown, /Copilot SDK with the Explore subagent/);
        assert.doesNotMatch(markdown, /Without MCP|With MCP/);
        assert.match(markdown, /outer Copilot.*inner Explorer/i);
        assert.match(markdown, /TypeAgent Explorer Code Mode MCP tool/i);
        assert.match(
            markdown,
            /normally contains exactly three dependent inner requests in one Explorer execution: discoverRepository, refineRepository, then submitExploration/i,
        );
        assert.match(
            markdown,
            /bounded repair turns are retained and charged/i,
        );
        assert.match(
            markdown,
            /\| model-b \| TypeAgent \| 9\/10 \| 10\/10 \| 9\/10 \| 990 \| 585 \| 405 \| 0\.1s\/0\.1s\/0\.1s \| 0\.1s\/0\.1s\/0\.1s \| 1\.000 \| 1\.000 \| 1\.000 \/ 1\.000 \/ 1\.000 \| 1\.000 \/ 1\.000 \/ 1\.000 \| 1\.000 \/ 1\.000 \/ 1\.000 \| 1\.000 \/ 1\.000 \/ 1\.000 \| 10\/10 \| 10\/10 \|/,
        );

        const mcpTreatment = incompleteRows.find(
            (row) => row.variant === "typeagent",
        )!;
        const exactRawRequestTreatment = structuredClone(mcpTreatment);
        exactRawRequestTreatment.query = "find\r\nbug";
        exactRawRequestTreatment.mcpToolTrace[0].arguments = {};
        assert.equal(
            summarizeRows([exactRawRequestTreatment])?.mcpAdoptionCount,
            1,
        );
        const legacyTreatment = structuredClone(mcpTreatment);
        legacyTreatment.mcpAdopted = false;
        const legacySummary = summarizeRows([
            {
                ...legacyTreatment,
                usage: {
                    source: "assistant.usage",
                    requestCount: 1,
                    usageComplete: true,
                    models: [legacyTreatment.model],
                    inputTokens: 110,
                    cachedInputTokens: 0,
                    cacheWriteTokens: 0,
                    outputTokens: 10,
                    reasoningOutputTokens: 0,
                    totalTokens: 120,
                },
                combinedUsage: {
                    inputTokens: 140,
                    cachedInputTokens: 0,
                    cacheWriteTokens: 0,
                    outputTokens: 20,
                    reasoningOutputTokens: 0,
                    totalTokens: 160,
                },
            },
        ]);
        assert.equal(legacySummary?.combinedUsage?.totalTokens, 160);
        assert.equal(legacySummary?.mcpAdoptionCount, 0);

        const taskIdsFile = path.join(directory, "exact-task-ids.json");
        await writeFile(
            path.join(directory, "manifest.json"),
            JSON.stringify({
                ...manifest,
                taskSeed: undefined,
                taskIdsFile,
            }),
        );
        const exact = await writeReports(path.join(directory, "results.jsonl"));
        const exactMarkdown = await readFile(exact.markdownPath, "utf8");
        assert.match(
            exactMarkdown,
            /Selected 10-task prefix \(exact task IDs file "exact-task-ids\.json"\)/,
        );
        assert.match(
            exact.report.notes.join("\n"),
            /an exact task-ID cohort from .*exact-task-ids\.json/,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("acceptance gate uses terminal executions and enforces every arm", () => {
    const { manifest, rows } = acceptanceFixture(10);
    for (const row of rows) {
        row.latencyTimeline = {
            schemaVersion: 1,
            runStartedAt: new Date(0).toISOString(),
            primaryTurnCompletedMs: row.variant === "baseline" ? 100 : 80,
            completedMs: row.variant === "baseline" ? 10_000 : 20_000,
        };
        row.durationMs = row.latencyTimeline.completedMs;
    }
    const retried = rows.find(
        (row) =>
            row.taskId === manifest.taskIds[0] && row.variant === "typeagent",
    )!;
    retried.attempt = 2;
    const failedRetry = structuredClone(retried);
    failedRetry.attempt = 1;
    failedRetry.ok = false;
    failedRetry.durationMs = 100_000;
    failedRetry.usage!.inputTokens = 100_000;
    failedRetry.usage!.totalTokens =
        failedRetry.usage!.inputTokens + failedRetry.usage!.outputTokens;

    const comparisons = assertAcceptanceGate([failedRetry, ...rows], manifest);
    assert.deepEqual(
        comparisons.map((comparison) => comparison.treatment.variant),
        ["typeagent", "typeagent-lsp"],
    );
    assert.ok(comparisons.every((comparison) => comparison.tokenSaving >= 0.3));

    const missingFixture = acceptanceFixture(10);
    const missing = missingFixture.rows.filter(
        (row) =>
            !(
                row.taskId === missingFixture.manifest.taskIds[0] &&
                row.variant === "typeagent-lsp"
            ),
    );
    assert.throws(
        () => assertAcceptanceGate(missing, missingFixture.manifest),
        /lacks a successful terminal execution/i,
    );

    const missingCohortFile = structuredClone(manifest);
    delete missingCohortFile.taskIdsFile;
    assert.throws(
        () => assertAcceptanceGate(rows, missingCohortFile),
        /exact task-IDs cohort file/i,
    );
});

test("acceptance gate rejects token, latency, and quality regressions", () => {
    const tokenFixture = acceptanceFixture(10);
    for (const row of tokenFixture.rows.filter(
        (candidate) => candidate.variant === "typeagent",
    )) {
        row.usage!.inputTokens = 33;
        row.usage!.totalTokens = 38;
        row.combinedUsage!.inputTokens = 63;
        row.combinedUsage!.totalTokens = 78;
    }
    assert.throws(
        () => assertAcceptanceGate(tokenFixture.rows, tokenFixture.manifest),
        /token saving .* below 30.0%/i,
    );

    const latencyFixture = acceptanceFixture(10);
    for (const row of latencyFixture.rows.filter(
        (candidate) => candidate.variant === "typeagent",
    )) {
        row.durationMs = 100;
    }
    assert.throws(
        () =>
            assertAcceptanceGate(latencyFixture.rows, latencyFixture.manifest),
        /mean latency.*P50 latency/is,
    );

    const qualityFixture = acceptanceFixture(10);
    for (const row of qualityFixture.rows.filter(
        (candidate) => candidate.variant === "typeagent",
    )) {
        row.finalAnswer = "<final_answer>\npkg/a.py:11\n</final_answer>";
        row.mcpToolTrace[0].result = { content: "pkg/a.py:11" };
    }
    assert.throws(
        () =>
            assertAcceptanceGate(qualityFixture.rows, qualityFixture.manifest),
        /recall is below baseline/i,
    );
});

test("acceptance gate applies the same contract to 100 rows", () => {
    const fixture = acceptanceFixture(100);
    assert.equal(
        assertAcceptanceGate(fixture.rows, fixture.manifest).length,
        2,
    );
});

test("report surfaces both TypeAgent treatment arms", async () => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "explore-bench-three-arm-report-"),
    );
    try {
        const fixture = acceptanceFixture(10);
        fixture.manifest.output = path.join(directory, "results.jsonl");
        fixture.manifest.runtimeEvidence = path.join(directory, "runtime.json");
        await writeFile(
            path.join(directory, "manifest.json"),
            JSON.stringify(fixture.manifest),
        );
        await writeFile(
            fixture.manifest.output,
            `${fixture.rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
        );

        const { report, markdownPath } = await writeReports(
            fixture.manifest.output,
        );
        assert.equal(report.prefixes["10"].expectedPairs, 20);
        assert.equal(report.prefixes["10"].pairedPairs, 20);
        assert.deepEqual(
            report.prefixes["10"].comparisons.map(
                (comparison) => comparison.treatmentVariant,
            ),
            ["typeagent", "typeagent-lsp"],
        );
        assert.match(
            await readFile(markdownPath, "utf8"),
            /\| matrix-a \| TypeAgent with LSP \| 10\/10 \|/,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

function acceptanceFixture(taskCount: 10 | 100): {
    manifest: RunManifest;
    rows: RunResult[];
} {
    const taskIds = Array.from(
        { length: taskCount },
        (_, index) => `repo__acceptance-${index}`,
    );
    const manifest: RunManifest = {
        schemaVersion: 1,
        runId: `acceptance-${taskCount}`,
        createdAt: new Date(0).toISOString(),
        dataset: "princeton-nlp/SWE-bench_Verified",
        split: "test",
        taskIdsFile: `/tmp/acceptance-${taskCount}.json`,
        taskIds,
        matrix: [{ name: "matrix-a", model: "route-a" }],
        variants: ["baseline", "typeagent", "typeagent-lsp"],
        output: "/tmp/results.jsonl",
        copilotPath: "/native/copilot",
        runtimeEvidence: "/tmp/runtime.json",
        provider: {
            type: "openai-compatible",
            baseUrl: "http://localhost:4627/v1",
            apiKeyEnv: "CUSTOM_PROVIDER_API_KEY",
            wireApi: "responses",
        },
        mcp: { command: "/mcp/server", args: [], envVars: [] },
        agent: {
            name: "explorer",
            description: "benchmark explorer",
            tools: ["read", "grep", "glob", "bash"],
            prompt: "explore only",
            file: "/repo/.copilot/agents/explorer.md",
            sha256: "a".repeat(64),
        },
        maxConcurrency: 1,
        maxAttempts: 2,
        timeoutMs: 300_000,
        dockerPlatform: "linux/amd64",
    };
    const rows = taskIds.flatMap((taskId, index) =>
        (["baseline", "typeagent", "typeagent-lsp"] as const).map((variant) => {
            const row = reportResult(
                manifest,
                taskId,
                index,
                "matrix-a",
                "route-a",
                variant,
            );
            if (variant !== "baseline") {
                row.durationMs = 80;
            }
            return row;
        }),
    );
    return { manifest, rows };
}

function reportResult(
    manifest: RunManifest,
    taskId: string,
    rowIndex: number,
    matrixName: string,
    model: string,
    variant: "baseline" | "typeagent" | "typeagent-lsp",
): RunResult {
    const finalAnswer = "<final_answer>\npkg/a.py:10\n</final_answer>";
    const query = "find bug";
    const ripgrepPath = "/copilot/ripgrep/bin/darwin-arm64/rg";
    const ripgrepSha256 = "b".repeat(64);
    const outerUsage = {
        source: "assistant.usage" as const,
        requestCount: 1,
        usageComplete: true,
        models: [model],
        inputTokens: variant === "baseline" ? 100 : 20,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: variant === "baseline" ? 10 : 5,
        reasoningOutputTokens: 0,
        totalTokens: variant === "baseline" ? 110 : 25,
    };
    const innerUsage = {
        requestCount: 3,
        usageComplete: true,
        inputTokens: 30,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 10,
        reasoningOutputTokens: 0,
        totalTokens: 40,
    };
    const grepCall = {
        tool: "grep",
        durationMs: 1,
        input: {
            pattern: "bug",
            engine: "ripgrep",
            ripgrepPath,
            ripgrepSha256,
        },
        resultCount: 1,
        outputBytes: 15,
        truncated: false,
    };
    const lspCall = {
        tool: "lsp" as const,
        durationMs: 1,
        input: {
            operation: "definition",
            path: "pkg/a.py",
            line: 10,
            serverId: "pylsp",
            languageId: "python",
        },
        resultCount: 1,
        outputBytes: 10,
        truncated: false,
    };
    const readCall = {
        tool: "read" as const,
        durationMs: 1,
        input: { path: "pkg/a.py", lineStart: 10, lineEnd: 10 },
        resultCount: 1,
        outputBytes: 10,
        truncated: false,
    };
    const typeAgentCalls =
        variant === "typeagent-lsp"
            ? [grepCall, lspCall, readCall]
            : [grepCall];
    const typeAgentToolTrace = {
        calls: typeAgentCalls,
        totalCalls: typeAgentCalls.length,
        totalOutputBytes: typeAgentCalls.reduce(
            (total, call) => total + call.outputBytes,
            0,
        ),
    };
    const baseline = variant === "baseline";
    return {
        runId: manifest.runId,
        taskId,
        rowIndex,
        matrixName,
        model,
        variant,
        provider: { ...manifest.provider, hasApiKey: true },
        repoPath: "/repo",
        query,
        swebench: {
            dataset: manifest.dataset,
            split: "test",
            rowIndex,
            instanceId: taskId,
            patch,
            dockerImage: "image",
        },
        ok: true,
        durationMs: baseline ? 100 : 120,
        attempt: 1,
        maxAttempts: 2,
        finalAnswer,
        score: scoreSwebench(finalAnswer, patch),
        usage: outerUsage,
        ...(baseline
            ? { combinedUsage: outerUsage }
            : {
                  typeAgentUsage: innerUsage,
                  combinedUsage: {
                      inputTokens: 50,
                      cachedInputTokens: 0,
                      cacheWriteTokens: 0,
                      outputTokens: 15,
                      reasoningOutputTokens: 0,
                      totalTokens: 65,
                  },
                  typeAgentToolTrace,
                  exploreTelemetry: {
                      schemaVersion: 4 as const,
                      model,
                      status: "completed" as const,
                      usage: innerUsage,
                      toolTrace: typeAgentToolTrace,
                      invocations: [
                          {
                              index: 0,
                              status: "completed" as const,
                              querySha256: createHash("sha256")
                                  .update(query, "utf8")
                                  .digest("hex"),
                              usage: innerUsage,
                              actionTranslationAndCodeGenerationUsage:
                                  innerUsage,
                              toolTrace: typeAgentToolTrace,
                              reasoningTrace: [
                                  {
                                      index: 0,
                                      tool: "execute_action",
                                      actionName: "discoverRepository",
                                      status: "completed" as const,
                                  },
                                  {
                                      index: 1,
                                      tool: "execute_action",
                                      actionName: "refineRepository",
                                      status: "completed" as const,
                                  },
                                  {
                                      index: 2,
                                      tool: "execute_action",
                                      actionName: "submitExploration",
                                      status: "completed" as const,
                                  },
                              ],
                              actionAttempts: [
                                  {
                                      index: 0,
                                      actionName: "discoverRepository",
                                      status: "completed" as const,
                                  },
                                  {
                                      index: 1,
                                      actionName: "refineRepository",
                                      status: "completed" as const,
                                  },
                                  {
                                      index: 2,
                                      actionName: "submitExploration",
                                      status: "completed" as const,
                                  },
                              ],
                              result: {
                                  citationCount: 1,
                                  truncated: false,
                              },
                          },
                      ],
                      result: { citationCount: 1, truncated: false },
                  },
              }),
        ripgrepPath,
        ripgrepSha256,
        mcpAdopted: !baseline,
        attemptedExploreCalls: baseline ? 0 : 1,
        completedExploreCalls: baseline ? 0 : 1,
        successfulExploreCalls: baseline ? 0 : 1,
        outerLoopAbortedAfterExplore: !baseline,
        outsideExploreInspection: false,
        firstAssistantActionExclusiveExplore: !baseline,
        exploreCompletedBeforeLaterAssistantAction: !baseline,
        mcpServerReady: !baseline,
        mcpAdvertisedTools: baseline ? [] : ["explore"],
        lspAdopted: variant === "typeagent-lsp",
        lspCallCount: variant === "typeagent-lsp" ? 1 : 0,
        lspResultCount: variant === "typeagent-lsp" ? 1 : 0,
        subagentAdopted: baseline,
        defaultMainAgent: true,
        attemptedExplorerDelegations: baseline ? 1 : 0,
        completedExplorerDelegations: baseline ? 1 : 0,
        successfulExplorerDelegations: baseline ? 1 : 0,
        failedExplorerDelegations: 0,
        explorerRepositoryCalls: baseline ? 2 : 0,
        firstAssistantActionExclusiveExplorer: baseline,
        explorerCompletedBeforeLaterAssistantAction: baseline,
        mainAgentRepositoryInspection: false,
        explorerSubagentTrace: baseline
            ? [
                  {
                      toolCallId: "task-1",
                      agentName: "explorer",
                      arguments: { prompt: query },
                      started: true,
                      completed: true,
                      success: true,
                      resultContent: finalAnswer,
                  },
              ]
            : [],
        mcpToolTrace: baseline
            ? []
            : [
                  {
                      toolCallId: "mcp-1",
                      server: "typeagent",
                      tool: "explore",
                      arguments: {},
                      completed: true,
                      success: true,
                      result: { content: "pkg/a.py:10" },
                  },
              ],
        toolTrace: baseline
            ? [
                  {
                      tool: "grep",
                      args: { pattern: "bug" },
                      ok: true,
                      durationMs: 1,
                      output: "pkg/a.py:10:bug",
                      execution: {
                          engine: "ripgrep",
                          executable: ripgrepPath,
                          ripgrepSha256,
                      },
                  },
                  {
                      tool: "read",
                      args: { path: "pkg/a.py", offset: 10, limit: 1 },
                      ok: true,
                      durationMs: 1,
                      output: "pkg/a.py:10: bug",
                      readRange: {
                          path: "pkg/a.py",
                          startLine: 10,
                          endLine: 10,
                      },
                  },
              ]
            : [],
        events: baseline
            ? []
            : [
                  {
                      type: "tool.execution_complete",
                      data: { toolCallId: "mcp-1", success: true },
                  },
                  { type: "abort", data: { reason: "user" } },
                  { type: "session.idle", data: { aborted: true } },
              ],
    };
}

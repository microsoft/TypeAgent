// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { benchmarkPrefixLimits, writeReports } from "../src/report.js";
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
                (["baseline", "typeagent"] as const).map(
                    (variant): RunResult => {
                        const finalAnswer =
                            "<final_answer>\npkg/a.py:10 reason\n</final_answer>";
                        return {
                            runId: manifest.runId,
                            taskId,
                            rowIndex: index,
                            matrixName,
                            model,
                            variant,
                            provider: { ...manifest.provider, hasApiKey: true },
                            repoPath: "/repo",
                            query: "find bug",
                            swebench: {
                                dataset: manifest.dataset,
                                split: "test",
                                rowIndex: index,
                                instanceId: taskId,
                                patch,
                                dockerImage: "image",
                            },
                            ok: true,
                            durationMs: variant === "baseline" ? 100 : 120,
                            attempt: 1,
                            maxAttempts: 2,
                            finalAnswer,
                            score: scoreSwebench(finalAnswer, patch),
                            usage: {
                                source: "assistant.usage",
                                requestCount: 1,
                                models: [model],
                                inputTokens: variant === "baseline" ? 100 : 110,
                                cachedInputTokens: 0,
                                cacheWriteTokens: 0,
                                outputTokens: 10,
                                reasoningOutputTokens: 0,
                                totalTokens: variant === "baseline" ? 110 : 120,
                            },
                            ...(variant === "typeagent"
                                ? {
                                      attemptedExploreCalls: 1,
                                      completedExploreCalls: 1,
                                      successfulExploreCalls: 1,
                                      outsideExploreInspection: false,
                                      mcpServerReady: true,
                                      mcpAdvertisedTools: ["explore"],
                                      typeAgentUsage: {
                                          requestCount: 2,
                                          inputTokens: 30,
                                          cachedInputTokens: 0,
                                          cacheWriteTokens: 0,
                                          outputTokens: 10,
                                          reasoningOutputTokens: 0,
                                          totalTokens: 40,
                                      },
                                      combinedUsage: {
                                          inputTokens: 140,
                                          cachedInputTokens: 0,
                                          cacheWriteTokens: 0,
                                          outputTokens: 20,
                                          reasoningOutputTokens: 0,
                                          totalTokens: 160,
                                      },
                                      typeAgentToolTrace: {
                                          calls: [],
                                          totalCalls: 0,
                                          totalOutputBytes: 0,
                                      },
                                      exploreTelemetry: {
                                          schemaVersion: 1 as const,
                                          model,
                                          status: "completed" as const,
                                          usage: {
                                              requestCount: 2,
                                              inputTokens: 30,
                                              cachedInputTokens: 0,
                                              cacheWriteTokens: 0,
                                              outputTokens: 10,
                                              reasoningOutputTokens: 0,
                                              totalTokens: 40,
                                          },
                                          toolTrace: {
                                              calls: [],
                                              totalCalls: 0,
                                              totalOutputBytes: 0,
                                          },
                                      },
                                  }
                                : {
                                      combinedUsage: {
                                          inputTokens: 100,
                                          cachedInputTokens: 0,
                                          cacheWriteTokens: 0,
                                          outputTokens: 10,
                                          reasoningOutputTokens: 0,
                                          totalTokens: 110,
                                      },
                                  }),
                            mcpAdopted: variant === "typeagent",
                            subagentAdopted: variant === "baseline",
                            defaultMainAgent: true,
                            attemptedExplorerDelegations:
                                variant === "baseline" ? 1 : 0,
                            completedExplorerDelegations:
                                variant === "baseline" ? 1 : 0,
                            successfulExplorerDelegations:
                                variant === "baseline" ? 1 : 0,
                            failedExplorerDelegations: 0,
                            mainAgentRepositoryInspection: false,
                            explorerSubagentTrace:
                                variant === "baseline"
                                    ? [
                                          {
                                              toolCallId: "task-1",
                                              agentName: "explorer",
                                              started: true,
                                              completed: true,
                                              success: true,
                                          },
                                      ]
                                    : [],
                            mcpToolTrace:
                                variant === "typeagent"
                                    ? [
                                          {
                                              toolCallId: "explore-1",
                                              server: "typeagent",
                                              tool: "explore",
                                              completed: true,
                                              success: true,
                                          },
                                      ]
                                    : [],
                            toolTrace: [],
                            events: [],
                        };
                    },
                ),
            ),
        );
        const incompleteRows = rows.filter(
            (row) =>
                !(
                    row.taskId === taskIds[9] &&
                    row.matrixName === "model-a" &&
                    row.variant === "typeagent"
                ),
        );
        const {
            combinedUsage: _missingCombinedUsage,
            ...measuredUsageAttempt
        } = incompleteRows[0];
        const missingUsageAttempt = {
            ...measuredUsageAttempt,
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
                ...incompleteRows.find(
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
        assert.equal(report.schemaVersion, 2);
        assert.equal(report.rawRows, 41);
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
            450,
        );
        assert.equal(
            report.prefixes["10"].comparisons[1].totalTokensDelta,
            null,
        );
        const treatment = report.prefixes["10"].leaderboard.find(
            (row) =>
                row.matrixName === "model-b" && row.variant === "typeagent",
        );
        assert.equal(treatment?.copilotUsage?.totalTokens, 1_320);
        assert.equal(treatment?.typeAgentUsage?.totalTokens, 440);
        assert.equal(treatment?.combinedUsage?.totalTokens, 1_760);
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
        assert.equal(retriedBaseline?.copilotUsage, undefined);
        assert.equal(retriedBaseline?.combinedUsage, undefined);
        assert.equal(retriedBaseline?.finalAttemptUsage?.totalTokens, 1_100);
        assert.equal(
            report.tasks[0].results["model-a:typeagent"].typeAgentToolTrace
                ?.totalCalls,
            0,
        );
        assert.equal(report.prefixes["10"].comparisons[0].mcpAdoptionRate, 1);
        assert.equal(
            report.prefixes["10"].comparisons[0].baseline?.finalAttemptTokens,
            990,
        );
        assert.equal(
            report.prefixes["10"].comparisons[0].typeagent?.finalAttemptTokens,
            1_440,
        );
        assert.deepEqual(
            Object.keys(report.prefixes["10"].comparisons[0]).filter((key) =>
                ["baseline", "typeagent"].includes(key),
            ),
            ["baseline", "typeagent"],
        );
        assert.doesNotMatch(JSON.stringify(report), /withoutMcp|withMcp/);
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
            /\| Model \| Paired \| Copilot SDK completed \| TypeAgent completed \| Copilot SDK final tokens \| TypeAgent final tokens \(combined\) \| Final tokens saved \| Copilot SDK recall \| TypeAgent recall \| Copilot SDK file P\/R\/F1 \| TypeAgent file P\/R\/F1 \| Copilot SDK line P\/R\/F1 \| TypeAgent line P\/R\/F1 \| Explore agent used \| TypeAgent used \|/,
        );
        assert.match(markdown, /Copilot SDK \(with explore agent\)/);
        assert.doesNotMatch(markdown, /Without MCP|With MCP/);
        assert.match(
            markdown,
            /\| model-b \| 9\/10 \| 10\/10 \| 9\/10 \| 990 \| 1,440 \| -450 \| 1\.000 \| 1\.000 \| 1\.000 \/ 1\.000 \/ 1\.000 \| 1\.000 \/ 1\.000 \/ 1\.000 \| 1\.000 \/ 1\.000 \/ 1\.000 \| 1\.000 \/ 1\.000 \/ 1\.000 \| 10\/10 \| 10\/10 \|/,
        );

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

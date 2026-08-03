// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { scoreSwebench } from "../src/score.js";
import { writeThreeArmReport } from "../src/threeArmReport.js";
import type {
    BenchmarkVariant,
    RunManifest,
    RunResult,
    TypeAgentToolTrace,
} from "../src/types.js";

const patch = `diff --git a/pkg/a.py b/pkg/a.py
--- a/pkg/a.py
+++ b/pkg/a.py
@@ -1,1 +1,1 @@
-old
+new
`;

const ripgrepPath = "/copilot/ripgrep/bin/darwin-arm64/rg";
const ripgrepSha256 = "b".repeat(64);

test("writes a compatible three-arm report with presentation-only labels", async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "three-arm-report-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const pairedDir = path.join(root, "paired");
    const lspDir = path.join(root, "lsp");
    await mkdir(pairedDir);
    await mkdir(lspDir);
    const pairedManifest = manifest("paired-run", pairedDir, [
        "baseline",
        "typeagent",
    ]);
    const lspManifest: RunManifest = {
        ...manifest("lsp-run", lspDir, ["typeagent-lsp"]),
        sourceTaskCount: 1,
        languageFilter: ["python", "typescript"],
    };
    const typeAgent = result(pairedManifest, "typeagent");
    const typeAgentLsp = result(lspManifest, "typeagent-lsp");
    await writeRun(pairedDir, pairedManifest, [
        result(pairedManifest, "baseline"),
        failedAttempt(typeAgent, 400),
        atAttempt(typeAgent, 2),
    ]);
    await writeRun(lspDir, lspManifest, [
        failedAttempt(typeAgentLsp, 500),
        failedAttempt(atAttempt(typeAgentLsp, 2), 700),
        atAttempt(typeAgentLsp, 3),
    ]);

    const { report, markdownPath } = await writeThreeArmReport({
        pairedInput: path.join(pairedDir, "results.jsonl"),
        lspInput: path.join(lspDir, "results.jsonl"),
    });

    assert.deepEqual(
        report.arms.map((arm) => arm.label),
        ["Copilot SDK (with explore agent)", "TypeAgent", "TypeAgent with LSP"],
    );
    assert.deepEqual(
        report.arms.map((arm) => arm.id),
        ["baseline", "typeagent", "typeagent-lsp"],
    );
    assert.deepEqual(Object.keys(report.models[0].arms), [
        "baseline",
        "typeagent",
        "typeagent-lsp",
    ]);
    assert.deepEqual(Object.keys(report.tasks[0].results["model-a"]), [
        "baseline",
        "typeagent",
        "typeagent-lsp",
    ]);
    assert.doesNotMatch(JSON.stringify(report), /"copilot-sdk"/);
    assert.deepEqual(report.languageCoverage, {
        python: 1,
        typescript: 0,
    });
    assert.equal(report.models[0].commonSuccessfulTasks, 1);
    assert.equal(report.models[0].arms["typeagent-lsp"].lspAdoptionCount, 1);
    assert.equal(report.models[0].arms["typeagent-lsp"].lspResultCount, 1);
    assert.equal(report.schemaVersion, 2);
    assert.deepEqual(
        report.models[0].arms.baseline.successfulExecutionLatency,
        {
            executions: 1,
            meanMs: 100,
            p50Ms: 100,
            p95Ms: 100,
        },
    );
    assert.deepEqual(
        report.models[0].arms.typeagent.successfulExecutionLatency,
        {
            executions: 1,
            meanMs: 200,
            p50Ms: 200,
            p95Ms: 200,
        },
    );
    assert.deepEqual(
        report.models[0].arms["typeagent-lsp"].successfulExecutionLatency,
        {
            executions: 1,
            meanMs: 300,
            p50Ms: 300,
            p95Ms: 300,
        },
    );
    const markdown = await readFile(markdownPath, "utf8");
    assert.match(markdown, /Copilot SDK \(with explore agent\)/);
    assert.match(markdown, /TypeAgent with LSP/);
    assert.match(markdown, /LSP attempts/);
    assert.match(markdown, /latency mean\/p50\/p95/);
    assert.match(markdown, /0\.1s\/0\.1s\/0\.1s/);
    assert.match(markdown, /0\.2s\/0\.2s\/0\.2s/);
    assert.match(markdown, /0\.3s\/0\.3s\/0\.3s/);
    assert.doesNotMatch(markdown, /retry-inclusive/);
    assert.match(
        markdown,
        /normally contains exactly three dependent inner requests in one Explorer execution: discoverRepository, refineRepository, then submitExploration/i,
    );
    assert.match(markdown, /bounded repair turns are retained and charged/i);
    assert.match(markdown, /0\.500\/1\.000\/0\.667/);
    assert.doesNotMatch(markdown, /0\.500\/1\.000\/0\.456/);
    assert.doesNotMatch(markdown, /Without MCP|With MCP/);
});

test("reads one combined three-arm run without duplicating arms", async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "three-arm-combined-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const combinedDir = path.join(root, "combined");
    await mkdir(combinedDir);
    const combinedManifest = manifest("combined-run", combinedDir, [
        "baseline",
        "typeagent",
        "typeagent-lsp",
    ]);
    await writeRun(combinedDir, combinedManifest, [
        result(combinedManifest, "baseline"),
        result(combinedManifest, "typeagent"),
        result(combinedManifest, "typeagent-lsp"),
    ]);
    const input = path.join(combinedDir, "results.jsonl");

    const { report } = await writeThreeArmReport({
        pairedInput: input,
        lspInput: input,
    });

    assert.deepEqual(report.runIds, {
        paired: "combined-run",
        lsp: "combined-run",
    });
    assert.equal(report.models[0].commonSuccessfulTasks, 1);
    assert.deepEqual(
        Object.fromEntries(
            Object.entries(report.models[0].arms).map(([id, arm]) => [
                id,
                arm.completed,
            ]),
        ),
        { baseline: 1, typeagent: 1, "typeagent-lsp": 1 },
    );
    assert.deepEqual(Object.keys(report.tasks[0].results["model-a"]), [
        "baseline",
        "typeagent",
        "typeagent-lsp",
    ]);
});

test("rejects split reports from different treatment revisions", async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "three-arm-revision-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const pairedDir = path.join(root, "paired");
    const lspDir = path.join(root, "lsp");
    await mkdir(pairedDir);
    await mkdir(lspDir);
    const pairedManifest = manifest("paired-revision", pairedDir, [
        "baseline",
        "typeagent",
    ]);
    const lspManifest = {
        ...manifest("lsp-revision", lspDir, ["typeagent-lsp"]),
        cacheCompatibilityRevision: 50,
    };
    await writeRun(pairedDir, pairedManifest, []);
    await writeRun(lspDir, lspManifest, []);

    await assert.rejects(
        writeThreeArmReport({
            pairedInput: path.join(pairedDir, "results.jsonl"),
            lspInput: path.join(lspDir, "results.jsonl"),
        }),
        /same explicit treatment revision/i,
    );
});

test("refuses to publish a split ten-task report that fails acceptance", async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "three-arm-gate-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const pairedDir = path.join(root, "paired");
    const lspDir = path.join(root, "lsp");
    await mkdir(pairedDir);
    await mkdir(lspDir);
    const taskIds = Array.from(
        { length: 10 },
        (_, index) => `repo__repo-${index + 1}`,
    );
    const taskIdsFile = path.join(root, "cohort.json");
    const pairedManifest: RunManifest = {
        ...manifest("paired-gate", pairedDir, ["baseline", "typeagent"]),
        taskIds,
        taskIdsFile,
    };
    const lspManifest: RunManifest = {
        ...manifest("lsp-gate", lspDir, ["typeagent-lsp"]),
        taskIds,
        taskIdsFile,
    };
    await writeRun(pairedDir, pairedManifest, [
        ...taskIds.map((taskId) => result(pairedManifest, "baseline", taskId)),
        ...taskIds.map((taskId) => result(pairedManifest, "typeagent", taskId)),
    ]);
    await writeRun(
        lspDir,
        lspManifest,
        taskIds.map((taskId) => result(lspManifest, "typeagent-lsp", taskId)),
    );

    await assert.rejects(
        writeThreeArmReport({
            pairedInput: path.join(pairedDir, "results.jsonl"),
            lspInput: path.join(lspDir, "results.jsonl"),
        }),
        /acceptance gate failed/i,
    );
});

test("reports final successful execution mean, median p50, and nearest-rank p95", async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "three-arm-latency-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const pairedDir = path.join(root, "paired");
    const lspDir = path.join(root, "lsp");
    await mkdir(pairedDir);
    await mkdir(lspDir);
    const taskIds = Array.from(
        { length: 21 },
        (_, index) => `repo__repo-${index + 1}`,
    );
    const commonTaskIds = taskIds.slice(0, 20);
    const pairedManifest: RunManifest = {
        ...manifest("paired-latency", pairedDir, ["baseline", "typeagent"]),
        taskIds,
    };
    const lspManifest: RunManifest = {
        ...manifest("lsp-latency", lspDir, ["typeagent-lsp"]),
        taskIds,
    };
    const baseline = commonTaskIds.map((taskId, index) =>
        result(pairedManifest, "baseline", taskId, (index + 1) * 1_000),
    );
    const typeagent = commonTaskIds.map((taskId, index) =>
        result(pairedManifest, "typeagent", taskId, (index + 1) * 2_000),
    );
    typeagent[0] = atAttempt(typeagent[0], 2);
    typeagent.unshift(failedAttempt(atAttempt(typeagent[0], 1), 1_000));
    const lsp = commonTaskIds.map((taskId, index) =>
        result(lspManifest, "typeagent-lsp", taskId, (index + 1) * 3_000),
    );
    baseline.push(result(pairedManifest, "baseline", taskIds[20], 999_000));
    typeagent.push(result(pairedManifest, "typeagent", taskIds[20], 999_000));
    lsp.push(
        failedAttempt(
            result(lspManifest, "typeagent-lsp", taskIds[20], 999_000),
            999_000,
        ),
    );
    await writeRun(pairedDir, pairedManifest, [...baseline, ...typeagent]);
    await writeRun(lspDir, lspManifest, lsp);

    const { report } = await writeThreeArmReport({
        pairedInput: path.join(pairedDir, "results.jsonl"),
        lspInput: path.join(lspDir, "results.jsonl"),
    });

    assert.equal(report.models[0].commonSuccessfulTasks, 20);
    assert.deepEqual(
        report.models[0].arms.baseline.successfulExecutionLatency,
        {
            executions: 20,
            meanMs: 10_500,
            p50Ms: 10_500,
            p95Ms: 19_000,
        },
    );
    assert.deepEqual(
        report.models[0].arms.typeagent.successfulExecutionLatency,
        {
            executions: 20,
            meanMs: 21_000,
            p50Ms: 21_000,
            p95Ms: 38_000,
        },
    );
    assert.deepEqual(
        report.models[0].arms["typeagent-lsp"].successfulExecutionLatency,
        {
            executions: 20,
            meanMs: 31_500,
            p50Ms: 31_500,
            p95Ms: 57_000,
        },
    );
});

function manifest(
    runId: string,
    directory: string,
    variants: BenchmarkVariant[],
): RunManifest {
    return {
        schemaVersion: 1,
        cacheCompatibilityRevision: 58,
        runId,
        createdAt: new Date(0).toISOString(),
        dataset: "princeton-nlp/SWE-bench_Verified",
        split: "test",
        taskSeed: "same-cohort",
        taskIds: ["repo__repo-1"],
        matrix: [{ name: "model-a", model: "route-a" }],
        variants,
        output: path.join(directory, "results.jsonl"),
        copilotPath: "/native/copilot",
        runtimeEvidence: path.join(directory, "runtime.json"),
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
        maxAttempts: 3,
        timeoutMs: 300_000,
        dockerPlatform: "linux/amd64",
    };
}

function result(
    manifest: RunManifest,
    variant: BenchmarkVariant,
    taskId = "repo__repo-1",
    durationMs = variant === "baseline"
        ? 100
        : variant === "typeagent"
          ? 200
          : 300,
): RunResult {
    const finalAnswer =
        "<final_answer>\npkg/a.py:1\npkg/other.py:2\n</final_answer>";
    const query = `find bug ${taskId}`;
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
    const typeAgentCalls: TypeAgentToolTrace["calls"] = [
        {
            tool: "grep",
            durationMs: 1,
            input: {
                pattern: "bug",
                engine: "ripgrep",
                ripgrepPath,
                ripgrepSha256,
            },
            resultCount: 2,
            outputBytes: 30,
            truncated: false,
        },
        ...(variant === "typeagent-lsp"
            ? [
                  {
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
                  },
                  {
                      tool: "read",
                      durationMs: 1,
                      input: { path: "pkg/a.py", offset: 0, limit: 1 },
                      resultCount: 1,
                      outputBytes: 10,
                      truncated: false,
                  },
              ]
            : []),
    ];
    const typeAgentTrace: TypeAgentToolTrace = {
        calls: typeAgentCalls,
        totalCalls: typeAgentCalls.length,
        totalOutputBytes: typeAgentCalls.reduce(
            (total, call) => total + call.outputBytes,
            0,
        ),
    };
    const typeAgent = variant !== "baseline";
    const outerUsage = {
        source: "assistant.usage" as const,
        requestCount: 1,
        usageComplete: true,
        models: ["route-a"],
        inputTokens: 100,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 10,
        reasoningOutputTokens: 0,
        totalTokens: 110,
    };
    return {
        runId: manifest.runId,
        taskId,
        rowIndex: manifest.taskIds.indexOf(taskId),
        matrixName: "model-a",
        model: "route-a",
        variant,
        provider: { ...manifest.provider, hasApiKey: true },
        repoPath: "/repo",
        query,
        swebench: {
            dataset: manifest.dataset,
            split: "test",
            rowIndex: manifest.taskIds.indexOf(taskId),
            instanceId: taskId,
            patch,
            dockerImage: "image",
        },
        ok: true,
        durationMs,
        latencyTimeline: {
            schemaVersion: 1,
            runStartedAt: new Date(0).toISOString(),
            primaryTurnCompletedMs: durationMs,
            completedMs: durationMs + 10_000,
        },
        attempt: 1,
        maxAttempts: manifest.maxAttempts,
        finalAnswer,
        score: scoreSwebench(finalAnswer, patch),
        usage: outerUsage,
        combinedUsage: typeAgent
            ? {
                  inputTokens: 130,
                  cachedInputTokens: 0,
                  cacheWriteTokens: 0,
                  outputTokens: 20,
                  reasoningOutputTokens: 0,
                  totalTokens: 150,
              }
            : outerUsage,
        ripgrepPath,
        ripgrepSha256,
        ...(typeAgent
            ? {
                  typeAgentUsage: innerUsage,
                  typeAgentToolTrace: typeAgentTrace,
                  exploreTelemetry: {
                      schemaVersion: 4 as const,
                      model: "route-a",
                      status: "completed" as const,
                      usage: innerUsage,
                      toolTrace: typeAgentTrace,
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
                              toolTrace: typeAgentTrace,
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
                                  citationCount: 2,
                                  truncated: false,
                              },
                          },
                      ],
                      result: { citationCount: 2, truncated: false },
                  },
                  attemptedExploreCalls: 1,
                  completedExploreCalls: 1,
                  successfulExploreCalls: 1,
                  outerLoopAbortedAfterExplore: true,
                  outsideExploreInspection: false,
                  firstAssistantActionExclusiveExplore: true,
                  exploreCompletedBeforeLaterAssistantAction: true,
                  mcpServerReady: true,
                  mcpAdvertisedTools: ["explore"],
              }
            : {
                  attemptedExploreCalls: 0,
                  completedExploreCalls: 0,
                  successfulExploreCalls: 0,
                  outerLoopAbortedAfterExplore: false,
                  outsideExploreInspection: false,
                  firstAssistantActionExclusiveExplore: false,
                  exploreCompletedBeforeLaterAssistantAction: false,
                  mcpServerReady: false,
                  mcpAdvertisedTools: [],
              }),
        mcpAdopted: typeAgent,
        lspAdopted: variant === "typeagent-lsp",
        lspCallCount: variant === "typeagent-lsp" ? 1 : 0,
        lspResultCount: variant === "typeagent-lsp" ? 1 : 0,
        subagentAdopted: !typeAgent,
        defaultMainAgent: true,
        attemptedExplorerDelegations: typeAgent ? 0 : 1,
        completedExplorerDelegations: typeAgent ? 0 : 1,
        successfulExplorerDelegations: typeAgent ? 0 : 1,
        failedExplorerDelegations: 0,
        explorerRepositoryCalls: typeAgent ? 0 : 3,
        firstAssistantActionExclusiveExplorer: !typeAgent,
        explorerCompletedBeforeLaterAssistantAction: !typeAgent,
        mainAgentRepositoryInspection: false,
        explorerSubagentTrace: typeAgent
            ? []
            : [
                  {
                      toolCallId: "task-1",
                      agentName: "explorer",
                      arguments: { prompt: query },
                      started: true,
                      completed: true,
                      success: true,
                      resultContent: finalAnswer,
                  },
              ],
        mcpToolTrace: typeAgent
            ? [
                  {
                      toolCallId: "mcp-1",
                      server: "typeagent",
                      tool: "explore",
                      arguments: {},
                      completed: true,
                      success: true,
                      result: { content: "pkg/a.py:1\npkg/other.py:2" },
                  },
              ]
            : [],
        toolTrace: typeAgent
            ? []
            : [
                  {
                      tool: "grep",
                      args: { pattern: "bug" },
                      ok: true,
                      durationMs: 1,
                      output: "pkg/a.py:1:bug\npkg/other.py:2:bug",
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
                      readRange: {
                          path: "pkg/a.py",
                          startLine: 1,
                          endLine: 1,
                      },
                  },
                  {
                      tool: "read",
                      args: { path: "pkg/other.py", offset: 2, limit: 1 },
                      ok: true,
                      durationMs: 1,
                      output: "pkg/other.py:2: bug",
                      readRange: {
                          path: "pkg/other.py",
                          startLine: 2,
                          endLine: 2,
                      },
                  },
              ],
        events: typeAgent
            ? [
                  {
                      type: "tool.execution_complete",
                      data: { toolCallId: "mcp-1", success: true },
                  },
                  { type: "abort", data: { reason: "user" } },
                  { type: "session.idle", data: { aborted: true } },
              ]
            : [],
    };
}

function failedAttempt(row: RunResult, durationMs: number): RunResult {
    return {
        ...row,
        ok: false,
        durationMs,
        finalAnswer: "",
        score: scoreSwebench("", patch),
    };
}

function atAttempt(row: RunResult, attempt: number): RunResult {
    return { ...row, attempt };
}

async function writeRun(
    directory: string,
    manifest: RunManifest,
    rows: RunResult[],
): Promise<void> {
    await writeFile(
        path.join(directory, "manifest.json"),
        JSON.stringify(manifest),
    );
    await writeFile(
        path.join(directory, "results.jsonl"),
        `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
    );
}

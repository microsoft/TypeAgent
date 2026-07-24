// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
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
    await writeRun(pairedDir, pairedManifest, [
        result(pairedManifest, "baseline"),
        failedAttempt(result(pairedManifest, "typeagent"), 400),
        result(pairedManifest, "typeagent"),
    ]);
    await writeRun(lspDir, lspManifest, [
        failedAttempt(result(lspManifest, "typeagent-lsp"), 500),
        failedAttempt(result(lspManifest, "typeagent-lsp"), 700),
        result(lspManifest, "typeagent-lsp"),
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
    assert.match(markdown, /Successful LSP calls/);
    assert.match(
        markdown,
        /error-free language-server call and repository-grounded reads/,
    );
    assert.doesNotMatch(markdown, /call followed by repository-grounded reads/);
    assert.match(markdown, /latency mean\/p50\/p95/);
    assert.match(markdown, /0\.1s\/0\.1s\/0\.1s/);
    assert.match(markdown, /0\.2s\/0\.2s\/0\.2s/);
    assert.match(markdown, /0\.3s\/0\.3s\/0\.3s/);
    assert.doesNotMatch(markdown, /retry-inclusive/);
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
    typeagent.unshift(failedAttempt(typeagent[0], 1_000));
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
        maxAttempts: 1,
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
        "<final_answer>\npkg/a.py:1 reason\npkg/other.py:2 extra\n</final_answer>";
    const grepCall: TypeAgentToolTrace["calls"][number] = {
        tool: "grep",
        durationMs: 1,
        input: {
            pattern: "needle",
            engine: "ripgrep",
            ripgrepPath: "rg",
        },
        resultCount: 1,
        outputBytes: 1,
        truncated: false,
    };
    const lspCall: TypeAgentToolTrace["calls"][number] = {
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
    const typeAgentTrace: TypeAgentToolTrace = {
        calls: [grepCall, ...(variant === "typeagent-lsp" ? [lspCall] : [])],
        totalCalls: variant === "typeagent-lsp" ? 2 : 1,
        totalOutputBytes: variant === "typeagent-lsp" ? 21 : 1,
    };
    const typeAgent = variant !== "baseline";
    return {
        runId: manifest.runId,
        taskId,
        rowIndex: manifest.taskIds.indexOf(taskId),
        matrixName: "model-a",
        model: "route-a",
        variant,
        provider: { ...manifest.provider, hasApiKey: true },
        repoPath: "/repo",
        query: `find bug ${taskId}`,
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
        attempt: 1,
        maxAttempts: 1,
        finalAnswer,
        score: scoreSwebench(finalAnswer, patch),
        usage: {
            source: "assistant.usage",
            requestCount: 1,
            models: ["route-a"],
            inputTokens: 100,
            cachedInputTokens: 0,
            cacheWriteTokens: 0,
            outputTokens: 10,
            reasoningOutputTokens: 0,
            totalTokens: 110,
        },
        combinedUsage: {
            inputTokens: typeAgent ? 130 : 100,
            cachedInputTokens: 0,
            cacheWriteTokens: 0,
            outputTokens: typeAgent ? 20 : 10,
            reasoningOutputTokens: 0,
            totalTokens: typeAgent ? 150 : 110,
        },
        ...(typeAgent
            ? {
                  dispatcherUsage: {
                      requestCount: 1,
                      usageComplete: true,
                      inputTokens: 100,
                      cachedInputTokens: 0,
                      cacheWriteTokens: 0,
                      outputTokens: 10,
                      reasoningOutputTokens: 0,
                      totalTokens: 110,
                  },
                  typeAgentUsage: {
                      requestCount: 1,
                      inputTokens: 30,
                      cachedInputTokens: 0,
                      cacheWriteTokens: 0,
                      outputTokens: 10,
                      reasoningOutputTokens: 0,
                      totalTokens: 40,
                  },
                  typeAgentToolTrace: typeAgentTrace,
                  typeAgentDispatch: {
                      ingress: "natural-language" as const,
                      submittedRequest: `find bug ${taskId}`,
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
                      schemaVersion: 4 as const,
                      model: "route-a",
                      status: "completed" as const,
                      usage: {
                          requestCount: 1,
                          inputTokens: 30,
                          cachedInputTokens: 0,
                          cacheWriteTokens: 0,
                          outputTokens: 10,
                          reasoningOutputTokens: 0,
                          totalTokens: 40,
                      },
                      toolTrace: typeAgentTrace,
                      invocations: [
                          {
                              index: 0,
                              status: "completed" as const,
                              usage: {
                                  requestCount: 1,
                                  inputTokens: 30,
                                  cachedInputTokens: 0,
                                  cacheWriteTokens: 0,
                                  outputTokens: 10,
                                  reasoningOutputTokens: 0,
                                  totalTokens: 40,
                              },
                              actionTranslationAndCodeGenerationUsage: {
                                  requestCount: 1,
                                  inputTokens: 30,
                                  cachedInputTokens: 0,
                                  cacheWriteTokens: 0,
                                  outputTokens: 10,
                                  reasoningOutputTokens: 0,
                                  totalTokens: 40,
                              },
                              toolTrace: typeAgentTrace,
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
                              submissionAction: "submitExploration",
                              result: {
                                  citationCount: 2,
                                  truncated: false,
                              },
                          },
                      ],
                      result: { citationCount: 2, truncated: false },
                  },
                  attemptedExploreCalls: 0,
                  completedExploreCalls: 0,
                  successfulExploreCalls: 0,
                  outsideExploreInspection: false,
                  mcpServerReady: false,
                  mcpAdvertisedTools: [],
              }
            : {}),
        mcpAdopted: false,
        lspAdopted: variant === "typeagent-lsp",
        lspCallCount: variant === "typeagent-lsp" ? 1 : 0,
        lspResultCount: variant === "typeagent-lsp" ? 1 : 0,
        subagentAdopted: !typeAgent,
        defaultMainAgent: !typeAgent,
        attemptedExplorerDelegations: typeAgent ? 0 : 1,
        completedExplorerDelegations: typeAgent ? 0 : 1,
        successfulExplorerDelegations: typeAgent ? 0 : 1,
        failedExplorerDelegations: 0,
        explorerRepositoryCalls: typeAgent ? 0 : 1,
        firstAssistantActionExclusiveExplorer: !typeAgent,
        explorerCompletedBeforeLaterAssistantAction: !typeAgent,
        mainAgentRepositoryInspection: false,
        explorerSubagentTrace: typeAgent
            ? []
            : [
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

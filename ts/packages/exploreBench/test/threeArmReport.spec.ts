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
        result(pairedManifest, "typeagent"),
    ]);
    await writeRun(lspDir, lspManifest, [result(lspManifest, "typeagent-lsp")]);

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
    const markdown = await readFile(markdownPath, "utf8");
    assert.match(markdown, /Copilot SDK \(with explore agent\)/);
    assert.match(markdown, /TypeAgent with LSP/);
    assert.match(markdown, /Successful LSP calls/);
    assert.match(markdown, /0\.500\/1\.000\/0\.667/);
    assert.doesNotMatch(markdown, /0\.500\/1\.000\/0\.456/);
    assert.doesNotMatch(markdown, /Without MCP|With MCP/);
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

function result(manifest: RunManifest, variant: BenchmarkVariant): RunResult {
    const finalAnswer =
        "<final_answer>\npkg/a.py:1 reason\npkg/other.py:2 extra\n</final_answer>";
    const lspTrace: TypeAgentToolTrace = {
        calls: [
            {
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
            },
        ],
        totalCalls: 1,
        totalOutputBytes: 20,
    };
    const typeAgentTrace: TypeAgentToolTrace =
        variant === "typeagent-lsp"
            ? lspTrace
            : { calls: [], totalCalls: 0, totalOutputBytes: 0 };
    const typeAgent = variant !== "baseline";
    return {
        runId: manifest.runId,
        taskId: "repo__repo-1",
        rowIndex: 0,
        matrixName: "model-a",
        model: "route-a",
        variant,
        provider: { ...manifest.provider, hasApiKey: true },
        repoPath: "/repo",
        query: "find bug",
        swebench: {
            dataset: manifest.dataset,
            split: "test",
            rowIndex: 0,
            instanceId: "repo__repo-1",
            patch,
            dockerImage: "image",
        },
        ok: true,
        durationMs: 100,
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
                  exploreTelemetry: {
                      schemaVersion: 1 as const,
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
                  },
                  attemptedExploreCalls: 1,
                  completedExploreCalls: 1,
                  successfulExploreCalls: 1,
                  outsideExploreInspection: false,
                  mcpServerReady: true,
                  mcpAdvertisedTools: ["explore"],
              }
            : {}),
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
        mcpToolTrace: typeAgent
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

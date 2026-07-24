// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
    archiveResultArtifacts,
    CACHE_COMPATIBILITY_REVISION,
    cacheManifestsCompatible,
    seedResultsFromPriorRuns,
    selectReusableAttempts,
} from "../src/resultCache.js";
import { scoreSwebench } from "../src/score.js";
import type { BenchTask, RunManifest, RunResult } from "../src/types.js";

const agent = {
    name: "explorer",
    description: "benchmark explorer",
    tools: ["read", "grep", "glob", "ls"],
    prompt: "explore only",
    file: "/repo/.copilot/agents/explorer.md",
    sha256: "a".repeat(64),
};

const task: BenchTask = {
    id: "repo__repo-1",
    repoPath: "/target/repo",
    query: "find bug",
    swebench: {
        dataset: "princeton-nlp/SWE-bench_Verified",
        split: "test",
        rowIndex: 0,
        instanceId: "repo__repo-1",
        patch: "patch",
        dockerImage: "image",
    },
};

function manifest(
    runId: string,
    overrides: Partial<RunManifest> = {},
): RunManifest {
    return {
        schemaVersion: 1,
        cacheCompatibilityRevision: CACHE_COMPATIBILITY_REVISION,
        runId,
        createdAt: "2026-07-17T00:00:00.000Z",
        dataset: "princeton-nlp/SWE-bench_Verified",
        split: "test",
        taskIds: [task.id],
        matrix: [{ name: "matrix-a", model: "route-a" }],
        variants: ["baseline", "typeagent"],
        output: `/runs/${runId}/results.jsonl`,
        copilotPath: "/copilot",
        runtimeEvidence: `/runs/${runId}/copilot-runtime.json`,
        provider: {
            type: "openai-compatible",
            baseUrl: "http://127.0.0.1:4627/v1",
            apiKeyEnv: "LITELLM_MASTER_KEY",
            wireApi: "responses",
        },
        mcp: {
            command: "/runtime/a/node",
            args: ["/repo/dist/server.js"],
            cwd: "/repo",
            envVars: [],
        },
        agent,
        maxConcurrency: 2,
        maxAttempts: 2,
        timeoutMs: 300_000,
        dockerPlatform: "linux/amd64",
        ...overrides,
    };
}

function result(runId: string, overrides: Partial<RunResult> = {}): RunResult {
    return {
        runId,
        taskId: task.id,
        rowIndex: 0,
        matrixName: "matrix-a",
        model: "route-a",
        variant: "baseline",
        provider: {
            type: "openai-compatible",
            baseUrl: "http://127.0.0.1:4627/v1",
            apiKeyEnv: "LITELLM_MASTER_KEY",
            hasApiKey: true,
            wireApi: "responses",
        },
        repoPath: "/source/repo",
        query: task.query,
        swebench: task.swebench,
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
        ...overrides,
    };
}

test("cache compatibility ignores run paths and Node interpreter location", () => {
    const source = manifest("run-30");
    const target = manifest("run-100", {
        taskIds: [task.id, "repo__repo-2"],
        maxConcurrency: 3,
        output: "/other/results.jsonl",
        runtimeEvidence: "/other/copilot-runtime.json",
        mcp: {
            ...manifest("unused").mcp,
            command: "/runtime/b/node",
        },
        agent: { ...agent, file: "/other/.copilot/agents/explorer.md" },
    });

    assert.equal(cacheManifestsCompatible(source, target), true);
    assert.equal(
        cacheManifestsCompatible(
            source,
            manifest("run-100", {
                provider: {
                    ...source.provider,
                    baseUrl: "http://other-gateway/v1",
                },
            }),
        ),
        false,
    );
    assert.equal(
        cacheManifestsCompatible(
            manifest("old-accounting", { cacheCompatibilityRevision: 1 }),
            target,
        ),
        false,
    );
});

test("rejects revisionless caches instead of assuming current compatibility", () => {
    const {
        cacheCompatibilityRevision: _cacheCompatibilityRevision,
        ...revisionless
    } = manifest("revisionless");

    assert.equal(
        cacheManifestsCompatible(revisionless, manifest("current")),
        false,
    );
});

test("rejects the immediate prior cache compatibility revision", () => {
    assert.equal(CACHE_COMPATIBILITY_REVISION, 18);
    assert.equal(
        cacheManifestsCompatible(
            manifest("pre-shared-ripgrep-timeout", {
                cacheCompatibilityRevision: 17,
            }),
            manifest("direct-typeagent"),
        ),
        false,
    );
});

test("reuses the complete fail-to-success history with explicit provenance", () => {
    const sourceManifest = manifest("run-30");
    const targetManifest = manifest("run-100");
    const failed = result("run-30", {
        ok: false,
        attempt: 1,
        finalAnswer: "",
        subagentAdopted: false,
        attemptedExplorerDelegations: 0,
        completedExplorerDelegations: 0,
        successfulExplorerDelegations: 0,
        explorerSubagentTrace: [],
    });
    const succeeded = result("run-30", { attempt: 2 });

    const reused = selectReusableAttempts({
        targetManifest,
        tasks: [task],
        targetRows: [],
        sources: [
            {
                manifest: sourceManifest,
                resultsPath: sourceManifest.output,
                rows: [failed, succeeded],
            },
        ],
        importedAt: "2026-07-17T01:00:00.000Z",
    });

    assert.equal(reused.length, 2);
    assert.deepEqual(
        reused.map((row) => row.attempt),
        [1, 2],
    );
    assert.ok(reused.every((row) => row.runId === "run-100"));
    assert.ok(reused.every((row) => row.repoPath === task.repoPath));
    assert.deepEqual(reused[0].reusedFrom, {
        originalRunId: "run-30",
        sourceRunId: "run-30",
        resultsPath: sourceManifest.output,
        manifestPath: "/runs/run-30/manifest.json",
        runtimeEvidence: sourceManifest.runtimeEvidence,
        importedAt: "2026-07-17T01:00:00.000Z",
    });
});

test("does not replace target attempts or reuse failed and mismatched rows", () => {
    const sourceManifest = manifest("run-30");
    const targetManifest = manifest("run-100");
    const sourceSuccess = result("run-30");

    assert.deepEqual(
        selectReusableAttempts({
            targetManifest,
            tasks: [task],
            targetRows: [result("run-100", { ok: false })],
            sources: [
                {
                    manifest: sourceManifest,
                    resultsPath: sourceManifest.output,
                    rows: [sourceSuccess],
                },
            ],
            importedAt: "now",
        }),
        [],
    );

    for (const rows of [
        [result("run-30", { ok: false })],
        [
            result("run-30", {
                swebench: { ...task.swebench, patch: "different patch" },
            }),
        ],
        [
            result("run-30", {
                reusedFrom: {
                    originalRunId: "original-run",
                    sourceRunId: "original-run",
                    resultsPath: "/runs/original-run/results.jsonl",
                    manifestPath: "/runs/original-run/manifest.json",
                    runtimeEvidence: "/runs/original-run/copilot-runtime.json",
                    importedAt: "now",
                },
            }),
        ],
    ]) {
        assert.deepEqual(
            selectReusableAttempts({
                targetManifest,
                tasks: [task],
                targetRows: [],
                sources: [
                    {
                        manifest: sourceManifest,
                        resultsPath: sourceManifest.output,
                        rows,
                    },
                ],
                importedAt: "now",
            }),
            [],
        );
    }
});

test("imports the legacy TypeAgent variant alias without rewriting its source", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "result-cache-"));
    const runsDir = path.join(directory, "runs");
    const sourceOutput = path.join(runsDir, "legacy", "results.jsonl");
    const targetOutput = path.join(runsDir, "canonical", "results.jsonl");
    const sourceManifest = manifest("legacy", {
        output: sourceOutput,
        variants: ["typeagent"],
    });
    const targetManifest = manifest("canonical", {
        output: targetOutput,
        variants: ["typeagent"],
    });
    const usage = {
        requestCount: 1,
        inputTokens: 1,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 1,
        reasoningOutputTokens: 0,
        totalTokens: 2,
    };
    const toolTrace = {
        calls: [
            {
                tool: "grep" as const,
                startedAt: "2026-07-17T00:00:00.000Z",
                durationMs: 1,
                input: { pattern: "needle" },
                execution: {
                    engine: "ripgrep",
                    executable: "rg",
                },
                resultCount: 1,
                outputBytes: 1,
                truncated: false,
            },
        ],
        totalCalls: 1,
        totalOutputBytes: 1,
    };
    const treatment = result("legacy", {
        variant: "typeagent",
        mcpAdopted: false,
        lspAdopted: false,
        lspCallCount: 0,
        lspResultCount: 0,
        subagentAdopted: false,
        defaultMainAgent: false,
        attemptedExplorerDelegations: 0,
        completedExplorerDelegations: 0,
        successfulExplorerDelegations: 0,
        failedExplorerDelegations: 0,
        mainAgentRepositoryInspection: false,
        explorerSubagentTrace: [],
        attemptedExploreCalls: 0,
        completedExploreCalls: 0,
        successfulExploreCalls: 0,
        outsideExploreInspection: false,
        mcpServerReady: false,
        mcpAdvertisedTools: [],
        mcpToolTrace: [],
        typeAgentToolTrace: toolTrace,
        dispatcherUsage: {
            requestCount: 0,
            inputTokens: 0,
            cachedInputTokens: 0,
            cacheWriteTokens: 0,
            outputTokens: 0,
            reasoningOutputTokens: 0,
            totalTokens: 0,
        },
        typeAgentUsage: usage,
        combinedUsage: {
            inputTokens: 1,
            cachedInputTokens: 0,
            cacheWriteTokens: 0,
            outputTokens: 1,
            reasoningOutputTokens: 0,
            totalTokens: 2,
        },
        typeAgentDispatch: {
            ingress: "natural-language",
            submittedRequest: task.query,
            dispatchMethod: "grammar",
            translationInvoked: false,
            translationRequestCount: 0,
            activeAgentNames: ["explorer"],
            activeSchemaNames: ["explorer"],
            translatedActions: [
                {
                    schemaName: "explorer",
                    actionName: "exploreRepository",
                    parameters: { request: task.query },
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
            model: "route-a",
            status: "completed",
            usage,
            toolTrace,
            invocations: [
                {
                    index: 0,
                    status: "completed",
                    usage,
                    actionTranslationAndCodeGenerationUsage: usage,
                    toolTrace,
                    actionAttempts: [
                        {
                            index: 0,
                            actionName: "discoverRepository",
                            status: "completed",
                        },
                        {
                            index: 1,
                            actionName: "refineRepository",
                            status: "completed",
                        },
                        {
                            index: 2,
                            actionName: "submitExploration",
                            status: "completed",
                        },
                    ],
                    submissionAction: "submitExploration",
                    result: { citationCount: 1, truncated: false },
                },
            ],
            result: { citationCount: 1, truncated: false },
        },
    });
    const legacyManifestText = JSON.stringify({
        ...sourceManifest,
        variants: ["typeagent-mcp"],
    });
    const legacyResultsText = `${JSON.stringify({
        ...treatment,
        variant: "typeagent-mcp",
    })}\n`;
    try {
        await mkdir(path.dirname(sourceOutput), { recursive: true });
        await writeFile(
            path.join(path.dirname(sourceOutput), "manifest.json"),
            legacyManifestText,
        );
        await writeFile(sourceOutput, legacyResultsText);

        const summary = await seedResultsFromPriorRuns({
            runsDir,
            targetManifest,
            tasks: [task],
            output: targetOutput,
        });

        assert.equal(summary.importedKeys, 1);
        assert.equal(
            await readFile(
                path.join(path.dirname(sourceOutput), "manifest.json"),
                "utf8",
            ),
            legacyManifestText,
        );
        assert.equal(await readFile(sourceOutput, "utf8"), legacyResultsText);
        const imported = JSON.parse(
            (await readFile(targetOutput, "utf8")).trim(),
        ) as RunResult;
        assert.equal(imported.variant, "typeagent");
        assert.equal(imported.reusedFrom?.sourceRunId, "legacy");
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("force rerun archives prior results and reports without deleting them", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "result-cache-"));
    const output = path.join(directory, "results.jsonl");
    const files = [
        output,
        path.join(directory, "report.json"),
        path.join(directory, "report.md"),
        path.join(directory, "cache-provenance.json"),
    ];
    try {
        await Promise.all(files.map((file) => writeFile(file, "original\n")));
        const archived = await archiveResultArtifacts(
            output,
            new Date("2026-07-17T02:03:04.005Z"),
        );

        assert.equal(archived.length, 4);
        assert.ok(
            archived.every((file) =>
                file.endsWith(".before-force-2026-07-17T02-03-04-005Z"),
            ),
        );
        for (const file of archived) {
            assert.equal(await readFile(file, "utf8"), "original\n");
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("resume preserves provenance when it imports no additional rows", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "result-cache-"));
    const runsDir = path.join(directory, "runs");
    const sourceManifest = manifest("run-30", {
        output: path.join(runsDir, "run-30", "results.jsonl"),
    });
    const targetOutput = path.join(runsDir, "run-100", "results.jsonl");
    const targetManifest = manifest("run-100", { output: targetOutput });
    try {
        await mkdir(path.dirname(sourceManifest.output), { recursive: true });
        await writeFile(
            path.join(path.dirname(sourceManifest.output), "manifest.json"),
            JSON.stringify(sourceManifest),
        );
        await writeFile(
            sourceManifest.output,
            `${JSON.stringify(result(sourceManifest.runId))}\n`,
        );

        const first = await seedResultsFromPriorRuns({
            runsDir,
            targetManifest,
            tasks: [task],
            output: targetOutput,
        });
        const firstProvenance = await readFile(first.provenancePath, "utf8");
        const second = await seedResultsFromPriorRuns({
            runsDir,
            targetManifest,
            tasks: [task],
            output: targetOutput,
        });

        assert.equal(first.importedKeys, 1);
        assert.equal(second.importedKeys, 0);
        assert.equal(
            await readFile(second.provenancePath, "utf8"),
            firstProvenance,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

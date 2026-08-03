// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
    archiveResultArtifacts,
    BASELINE_CACHE_MIN_REVISION,
    CACHE_COMPATIBILITY_REVISION,
    cacheManifestsCompatible,
    seedResultsFromPriorRuns,
    selectReusableAttempts,
} from "../src/resultCache.js";
import { scoreSwebench } from "../src/score.js";
import {
    createTrajectoryFiles,
    validateRunTrajectoryFiles,
    writeTrajectoryFile,
} from "../src/trajectory.js";
import type {
    BenchTask,
    NormalizedTrajectoryRecord,
    RunManifest,
    RunResult,
} from "../src/types.js";

const agent = {
    name: "explorer",
    description: "benchmark explorer",
    tools: ["read", "grep", "glob", "bash"],
    prompt: "explore only",
    file: "/repo/.copilot/agents/explorer.md",
    sha256: "a".repeat(64),
};

const ripgrepPath = "/copilot/ripgrep/bin/darwin-arm64/rg";
const ripgrepSha256 = "b".repeat(64);

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
        runtimeFingerprint: {
            copilot: { path: "/copilot", sha256: "c".repeat(64) },
            ripgrep: { path: ripgrepPath, sha256: ripgrepSha256 },
            mcpCommand: {
                path: "/runtime/a/node",
                sha256: "d".repeat(64),
            },
            mcpEntrypoint: {
                path: "/repo/dist/server.js",
                sha256: "e".repeat(64),
            },
        },
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
    const finalAnswer = "<final_answer>\npkg/a.py:1\n</final_answer>";
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
        finalAnswer,
        score: scoreSwebench("", ""),
        usage: outerUsage,
        combinedUsage: outerUsage,
        trajectoryFiles: { main: "/runs/source/baseline.jsonl" },
        ripgrepPath,
        ripgrepSha256,
        mcpAdopted: false,
        mcpServerReady: false,
        mcpAdvertisedTools: [],
        attemptedExploreCalls: 0,
        completedExploreCalls: 0,
        successfulExploreCalls: 0,
        outsideExploreInspection: false,
        firstAssistantActionExclusiveExplore: false,
        exploreCompletedBeforeLaterAssistantAction: false,
        subagentAdopted: true,
        defaultMainAgent: true,
        attemptedExplorerDelegations: 1,
        completedExplorerDelegations: 1,
        successfulExplorerDelegations: 1,
        failedExplorerDelegations: 0,
        explorerRepositoryCalls: 2,
        firstAssistantActionExclusiveExplorer: true,
        explorerCompletedBeforeLaterAssistantAction: true,
        mainAgentRepositoryInspection: false,
        explorerSubagentTrace: [
            {
                toolCallId: "task-1",
                agentName: "explorer",
                arguments: { prompt: task.query },
                started: true,
                completed: true,
                success: true,
                resultContent: finalAnswer,
            },
        ],
        mcpToolTrace: [],
        toolTrace: [
            {
                tool: "grep",
                args: { pattern: "bug" },
                ok: true,
                durationMs: 1,
                output: "pkg/a.py:1:bug",
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
                readRange: { path: "pkg/a.py", startLine: 1, endLine: 1 },
            },
        ],
        events: [],
        ...overrides,
    };
}

async function materializeBaselineTrajectory(
    output: string,
    row: RunResult,
): Promise<void> {
    assert.equal(row.variant, "baseline");
    const files = createTrajectoryFiles(
        output,
        row.taskId,
        row.model,
        row.variant,
        row.attempt,
    );
    row.trajectoryFiles = files;
    const record = (
        sequence: number,
        role: NormalizedTrajectoryRecord["role"],
        content: string,
    ): NormalizedTrajectoryRecord => ({
        schemaVersion: 1,
        sequence,
        role,
        content,
        model: row.model,
        tool_call_id: null,
        tool_calls: [],
        usage: {},
        source: "copilot-sdk",
    });
    await writeTrajectoryFile(files.main, [
        record(1, "system", "system"),
        record(2, "user", row.query),
        {
            ...record(3, "assistant", row.ok ? row.finalAnswer : "failed"),
            observedModel: row.model,
            usageModel: row.model,
            usage: {
                inputTokens: row.usage?.inputTokens ?? 0,
                cachedInputTokens: row.usage?.cachedInputTokens ?? 0,
                cacheWriteTokens: row.usage?.cacheWriteTokens ?? 0,
                outputTokens: row.usage?.outputTokens ?? 0,
                reasoningOutputTokens: row.usage?.reasoningOutputTokens ?? 0,
                totalTokens: row.usage?.totalTokens ?? 0,
            },
            success: row.ok,
        },
    ]);
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

test("reuses only baseline-safe restored harness revisions", () => {
    assert.equal(CACHE_COMPATIBILITY_REVISION, 71);
    assert.equal(BASELINE_CACHE_MIN_REVISION, 50);
    assert.equal(
        cacheManifestsCompatible(
            manifest("restored-baseline", {
                cacheCompatibilityRevision: 50,
            }),
            manifest("current"),
        ),
        true,
    );
    assert.equal(
        cacheManifestsCompatible(
            manifest("previous-current-baseline", {
                cacheCompatibilityRevision: 52,
            }),
            manifest("current"),
        ),
        true,
    );
    assert.equal(
        cacheManifestsCompatible(
            manifest("current-baseline", {
                cacheCompatibilityRevision: 53,
            }),
            manifest("current"),
        ),
        true,
    );
    assert.equal(
        cacheManifestsCompatible(
            manifest("previous-treatment-revision-baseline", {
                cacheCompatibilityRevision: 56,
            }),
            manifest("current"),
        ),
        true,
    );
    assert.equal(
        cacheManifestsCompatible(
            manifest("previous-revision-baseline", {
                cacheCompatibilityRevision: 57,
            }),
            manifest("current"),
        ),
        true,
    );
    assert.equal(
        cacheManifestsCompatible(
            manifest("current-revision-baseline", {
                cacheCompatibilityRevision: 58,
            }),
            manifest("current"),
        ),
        true,
    );
    assert.equal(
        cacheManifestsCompatible(
            manifest("changed-search-policy", {
                cacheCompatibilityRevision: 49,
            }),
            manifest("current"),
        ),
        false,
    );
    assert.equal(
        cacheManifestsCompatible(
            manifest("future-revision", {
                cacheCompatibilityRevision: CACHE_COMPATIBILITY_REVISION + 1,
            }),
            manifest("current"),
        ),
        false,
    );
});

test("requires identical baseline runtime fingerprints for cache reuse", () => {
    const source = manifest("source");
    const target = manifest("target");
    for (const field of ["copilot", "ripgrep"] as const) {
        const changed = manifest("changed");
        changed.runtimeFingerprint![field].sha256 = "f".repeat(64);
        assert.equal(cacheManifestsCompatible(source, changed), false, field);
    }

    const missing = manifest("missing");
    delete missing.runtimeFingerprint;
    assert.equal(cacheManifestsCompatible(missing, target), false);

    const malformed = manifest("malformed");
    malformed.runtimeFingerprint!.copilot.sha256 = "not-a-digest";
    assert.equal(cacheManifestsCompatible(malformed, target), false);
});

test("validates the pinned Python LSP command and fingerprint for LSP runs", () => {
    const source = manifest("lsp-source");
    source.variants = ["baseline", "typeagent", "typeagent-lsp"];
    source.mcp.pythonLspCommand = "/runtime/python/bin/pylsp";
    source.mcp.typescriptLspCommand = "/runtime/node";
    source.mcp.typescriptLspArgs = ["/runtime/typescript/cli.mjs", "--stdio"];
    source.runtimeFingerprint!.pythonLsp = {
        path: "/runtime/python/bin/pylsp",
        sha256: "f".repeat(64),
    };
    source.runtimeFingerprint!.pythonLspInterpreter = {
        path: "/runtime/python/bin/python",
        sha256: "1".repeat(64),
    };
    source.runtimeFingerprint!.pythonLspLock = {
        path: "/runtime/python/uv.lock",
        sha256: "2".repeat(64),
    };
    source.runtimeFingerprint!.typescriptLspCommand = {
        path: "/runtime/node",
        sha256: "3".repeat(64),
    };
    source.runtimeFingerprint!.typescriptLspEntrypoint = {
        path: "/runtime/typescript/cli.mjs",
        sha256: "4".repeat(64),
    };
    const target = structuredClone(source);
    target.runId = "lsp-target";
    target.output = "/runs/lsp-target/results.jsonl";
    assert.equal(cacheManifestsCompatible(source, target), true);

    const changed = structuredClone(target);
    changed.runtimeFingerprint!.pythonLsp!.sha256 = "0".repeat(64);
    assert.equal(cacheManifestsCompatible(source, changed), true);

    const mismatchedPath = structuredClone(target);
    mismatchedPath.runtimeFingerprint!.pythonLsp!.path =
        "/other/python/bin/pylsp";
    assert.equal(cacheManifestsCompatible(source, mismatchedPath), false);

    const missingCommand = structuredClone(target);
    delete missingCommand.mcp.pythonLspCommand;
    assert.equal(cacheManifestsCompatible(source, missingCommand), false);

    const missingFingerprint = structuredClone(target);
    delete missingFingerprint.runtimeFingerprint!.pythonLsp;
    assert.equal(cacheManifestsCompatible(source, missingFingerprint), false);
});

test("reuses baseline across treatment-only MCP and LSP runtime changes", () => {
    const source = manifest("baseline-source", {
        cacheCompatibilityRevision: 50,
        variants: ["baseline"],
    });
    const target = manifest("three-arm-target", {
        variants: ["baseline", "typeagent", "typeagent-lsp"],
    });
    target.mcp.command = "/different/node";
    target.mcp.args = ["/different/server.js"];
    target.mcp.pythonLspCommand = "/runtime/python/bin/pylsp";
    target.mcp.typescriptLspCommand = "/different/node";
    target.mcp.typescriptLspArgs = ["/different/typescript/cli.mjs", "--stdio"];
    target.runtimeFingerprint!.mcpCommand = {
        path: "/different/node",
        sha256: "1".repeat(64),
    };
    target.runtimeFingerprint!.mcpEntrypoint = {
        path: "/different/server.js",
        sha256: "2".repeat(64),
    };
    target.runtimeFingerprint!.pythonLsp = {
        path: "/runtime/python/bin/pylsp",
        sha256: "3".repeat(64),
    };
    target.runtimeFingerprint!.pythonLspInterpreter = {
        path: "/runtime/python/bin/python",
        sha256: "4".repeat(64),
    };
    target.runtimeFingerprint!.pythonLspLock = {
        path: "/runtime/python/uv.lock",
        sha256: "5".repeat(64),
    };
    target.runtimeFingerprint!.typescriptLspCommand = {
        path: "/different/node",
        sha256: "6".repeat(64),
    };
    target.runtimeFingerprint!.typescriptLspEntrypoint = {
        path: "/different/typescript/cli.mjs",
        sha256: "7".repeat(64),
    };

    assert.equal(cacheManifestsCompatible(source, target), true);
});

test("treats a manifest without an explicit revision as incompatible", () => {
    const source = manifest("legacy");
    delete source.cacheCompatibilityRevision;
    assert.equal(cacheManifestsCompatible(source, manifest("current")), false);
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
        importedAt: "2026-07-17T01:00:00.000Z",
    });
});

test("reuses baseline rows only", () => {
    const sourceManifest = manifest("run-30");
    const targetManifest = manifest("run-100");
    const treatment = result("run-30", {
        variant: "typeagent",
        subagentAdopted: false,
    });

    assert.deepEqual(
        selectReusableAttempts({
            targetManifest,
            tasks: [task],
            targetRows: [],
            sources: [
                {
                    manifest: sourceManifest,
                    resultsPath: sourceManifest.output,
                    rows: [treatment],
                },
            ],
            importedAt: "now",
        }),
        [],
    );
});

test("does not reuse a successful baseline without a trajectory", () => {
    const sourceManifest = manifest("run-30");
    const targetManifest = manifest("run-100");
    const baseline = result("run-30");
    delete baseline.trajectoryFiles;

    assert.deepEqual(
        selectReusableAttempts({
            targetManifest,
            tasks: [task],
            targetRows: [],
            sources: [
                {
                    manifest: sourceManifest,
                    resultsPath: sourceManifest.output,
                    rows: [baseline],
                },
            ],
            importedAt: "now",
        }),
        [],
    );
});

test("imports a revision-50 baseline without validating obsolete treatment rows", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "result-cache-"));
    const runsDir = path.join(directory, "runs");
    const sourceOutput = path.join(runsDir, "source", "results.jsonl");
    const targetOutput = path.join(runsDir, "target", "results.jsonl");
    const sourceManifest = manifest("source", {
        cacheCompatibilityRevision: 50,
        output: sourceOutput,
    });
    const targetManifest = manifest("target", { output: targetOutput });
    const failedBaseline = result("source", {
        ok: false,
        attempt: 1,
        finalAnswer: "",
    });
    const successfulBaseline = result("source", { attempt: 2 });
    const obsoleteTreatment = result("source", {
        variant: "typeagent",
        subagentAdopted: false,
    });

    try {
        await materializeBaselineTrajectory(sourceOutput, failedBaseline);
        await materializeBaselineTrajectory(sourceOutput, successfulBaseline);
        await mkdir(path.dirname(sourceOutput), { recursive: true });
        await writeFile(
            path.join(path.dirname(sourceOutput), "manifest.json"),
            JSON.stringify(sourceManifest),
        );
        await writeFile(
            sourceOutput,
            `${[failedBaseline, successfulBaseline, obsoleteTreatment]
                .map((row) => JSON.stringify(row))
                .join("\n")}\n`,
        );

        const summary = await seedResultsFromPriorRuns({
            runsDir,
            targetManifest,
            tasks: [task],
            output: targetOutput,
        });
        const imported = (await readFile(targetOutput, "utf8"))
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line) as RunResult);

        assert.deepEqual(summary.warnings, []);
        assert.equal(summary.importedKeys, 1);
        assert.equal(summary.importedRows, 2);
        assert.deepEqual(
            imported.map((row) => [row.variant, row.attempt]),
            [
                ["baseline", 1],
                ["baseline", 2],
            ],
        );
        assert.ok(
            imported.every(
                (row) =>
                    row.trajectoryFiles?.main.startsWith(
                        path.join(path.dirname(targetOutput), "trajectories"),
                    ) &&
                    !row.trajectoryFiles.main.startsWith(
                        path.dirname(sourceOutput),
                    ),
            ),
        );
        await rm(path.dirname(sourceOutput), {
            recursive: true,
            force: true,
        });
        await assert.doesNotReject(validateRunTrajectoryFiles(imported));
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("rejects missing, malformed, or shared retry trajectories before cache append", async (t) => {
    for (const fault of ["missing", "malformed", "shared"] as const) {
        await t.test(fault, async () => {
            const directory = await mkdtemp(
                path.join(os.tmpdir(), "result-cache-trajectory-"),
            );
            const runsDir = path.join(directory, "runs");
            const sourceOutput = path.join(runsDir, "source", "results.jsonl");
            const targetOutput = path.join(runsDir, "target", "results.jsonl");
            const sourceManifest = manifest("source", {
                output: sourceOutput,
            });
            const targetManifest = manifest("target", {
                output: targetOutput,
            });
            const failed = result("source", {
                ok: false,
                attempt: 1,
                finalAnswer: "",
            });
            const succeeded = result("source", { attempt: 2 });

            try {
                await materializeBaselineTrajectory(sourceOutput, failed);
                await materializeBaselineTrajectory(sourceOutput, succeeded);
                if (fault === "missing") {
                    delete failed.trajectoryFiles;
                } else if (fault === "malformed") {
                    await writeFile(failed.trajectoryFiles!.main, "not-json\n");
                } else {
                    assert.ok(failed.trajectoryFiles);
                    succeeded.trajectoryFiles = failed.trajectoryFiles;
                }
                await writeFile(
                    path.join(path.dirname(sourceOutput), "manifest.json"),
                    JSON.stringify(sourceManifest),
                );
                await writeFile(
                    sourceOutput,
                    `${JSON.stringify(failed)}\n${JSON.stringify(succeeded)}\n`,
                );

                await assert.rejects(
                    seedResultsFromPriorRuns({
                        runsDir,
                        targetManifest,
                        tasks: [task],
                        output: targetOutput,
                    }),
                    /trajectory|jsonl|path/i,
                );
                await assert.rejects(readFile(targetOutput, "utf8"), {
                    code: "ENOENT",
                });
            } finally {
                await rm(directory, { recursive: true, force: true });
            }
        });
    }
});

test("rejects a revision-50 source with malformed baseline history", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "result-cache-"));
    const runsDir = path.join(directory, "runs");
    const sourceOutput = path.join(runsDir, "source", "results.jsonl");
    const targetOutput = path.join(runsDir, "target", "results.jsonl");
    const sourceManifest = manifest("source", {
        cacheCompatibilityRevision: 50,
        output: sourceOutput,
    });
    const targetManifest = manifest("target", { output: targetOutput });

    try {
        await mkdir(path.dirname(sourceOutput), { recursive: true });
        await writeFile(
            path.join(path.dirname(sourceOutput), "manifest.json"),
            JSON.stringify(sourceManifest),
        );
        await writeFile(
            sourceOutput,
            `${JSON.stringify(result("source"))}\n${JSON.stringify(
                result("source", { ok: false, attempt: 2 }),
            )}\n`,
        );

        const summary = await seedResultsFromPriorRuns({
            runsDir,
            targetManifest,
            tasks: [task],
            output: targetOutput,
        });

        assert.equal(summary.importedKeys, 0);
        assert.equal(summary.importedRows, 0);
        assert.equal(summary.warnings.length, 1);
        assert.match(
            summary.warnings[0],
            /successful attempt 1 is not terminal/,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
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
        [result("run-30", { attempt: 2 })],
        [result("run-30"), result("run-30", { ok: false, attempt: 2 })],
        [result("run-30", { ok: false }), result("run-30", { attempt: 1 })],
        [
            result("run-30", {
                swebench: { ...task.swebench, patch: "different patch" },
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

test("does not reuse a legacy TypeAgent treatment row", async () => {
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
        requestCount: 2,
        inputTokens: 1,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 1,
        reasoningOutputTokens: 0,
        totalTokens: 2,
    };
    const treatment = result("legacy", {
        variant: "typeagent",
        mcpAdopted: true,
        lspAdopted: false,
        lspCallCount: 0,
        lspResultCount: 0,
        subagentAdopted: false,
        defaultMainAgent: true,
        attemptedExplorerDelegations: 0,
        completedExplorerDelegations: 0,
        successfulExplorerDelegations: 0,
        failedExplorerDelegations: 0,
        explorerRepositoryCalls: 0,
        firstAssistantActionExclusiveExplorer: false,
        explorerCompletedBeforeLaterAssistantAction: false,
        mainAgentRepositoryInspection: false,
        explorerSubagentTrace: [],
        attemptedExploreCalls: 1,
        completedExploreCalls: 1,
        successfulExploreCalls: 1,
        outsideExploreInspection: false,
        firstAssistantActionExclusiveExplore: true,
        exploreCompletedBeforeLaterAssistantAction: true,
        mcpServerReady: true,
        mcpAdvertisedTools: ["explore"],
        mcpToolTrace: [
            {
                toolCallId: "mcp-1",
                server: "typeagent",
                tool: "explore",
                arguments: {},
                completed: true,
                success: true,
                result: { content: "pkg/a.py:1" },
            },
        ],
        toolTrace: [],
        typeAgentToolTrace: {
            calls: [
                {
                    tool: "grep",
                    durationMs: 1,
                    input: {
                        pattern: "bug",
                        engine: "ripgrep",
                        ripgrepPath,
                        ripgrepSha256,
                    },
                    resultCount: 1,
                    outputBytes: 12,
                    truncated: false,
                },
            ],
            totalCalls: 1,
            totalOutputBytes: 12,
        },
        typeAgentUsage: usage,
        combinedUsage: {
            inputTokens: 101,
            cachedInputTokens: 0,
            cacheWriteTokens: 0,
            outputTokens: 11,
            reasoningOutputTokens: 0,
            totalTokens: 112,
        },
        exploreTelemetry: {
            schemaVersion: 4,
            model: "route-a",
            status: "completed",
            usage,
            toolTrace: {
                calls: [
                    {
                        tool: "grep",
                        durationMs: 1,
                        input: {
                            pattern: "bug",
                            engine: "ripgrep",
                            ripgrepPath,
                            ripgrepSha256,
                        },
                        resultCount: 1,
                        outputBytes: 12,
                        truncated: false,
                    },
                ],
                totalCalls: 1,
                totalOutputBytes: 12,
            },
            invocations: [
                {
                    index: 0,
                    status: "completed",
                    querySha256: createHash("sha256")
                        .update(task.query, "utf8")
                        .digest("hex"),
                    usage,
                    actionTranslationAndCodeGenerationUsage: usage,
                    toolTrace: {
                        calls: [
                            {
                                tool: "grep",
                                durationMs: 1,
                                input: {
                                    pattern: "bug",
                                    engine: "ripgrep",
                                    ripgrepPath,
                                    ripgrepSha256,
                                },
                                resultCount: 1,
                                outputBytes: 12,
                                truncated: false,
                            },
                        ],
                        totalCalls: 1,
                        totalOutputBytes: 12,
                    },
                    actionAttempts: [
                        {
                            index: 0,
                            actionName: "discoverRepository",
                            status: "completed",
                        },
                        {
                            index: 1,
                            actionName: "refineAndSubmitExploration",
                            status: "completed",
                        },
                    ],
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

        assert.equal(summary.importedKeys, 0);
        assert.equal(
            await readFile(
                path.join(path.dirname(sourceOutput), "manifest.json"),
                "utf8",
            ),
            legacyManifestText,
        );
        assert.equal(await readFile(sourceOutput, "utf8"), legacyResultsText);
        await assert.rejects(readFile(targetOutput, "utf8"), {
            code: "ENOENT",
        });
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
        const baseline = result(sourceManifest.runId);
        await materializeBaselineTrajectory(sourceManifest.output, baseline);
        await mkdir(path.dirname(sourceManifest.output), { recursive: true });
        await writeFile(
            path.join(path.dirname(sourceManifest.output), "manifest.json"),
            JSON.stringify(sourceManifest),
        );
        await writeFile(sourceManifest.output, `${JSON.stringify(baseline)}\n`);

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

        assert.deepEqual(first.warnings, []);
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

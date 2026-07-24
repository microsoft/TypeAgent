// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
    createTelemetryFilePath,
    failClosedResultIntegrity,
    mapWithConcurrencyPerModel,
    mergeHarnessEvidence,
    runBenchmark,
    selectPendingWork,
    type BenchmarkOptions,
    validateResumeTaskRows,
    validateRuntimeEvidence,
} from "../src/runner.js";
import { resolvePackagedRipgrepPath } from "../src/ripgrep.js";
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
    repoPath: "/repo",
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

function baselineResult(
    runId: string,
    overrides: Partial<RunResult> = {},
): RunResult {
    return {
        runId,
        taskId: task.id,
        rowIndex: task.swebench.rowIndex,
        matrixName: "model-a",
        model: "route-a",
        variant: "baseline",
        provider: {
            type: "openai-compatible",
            baseUrl: "http://127.0.0.1:1/v1",
            apiKeyEnv: "UNUSED_TEST_API_KEY",
            hasApiKey: true,
            wireApi: "responses",
        },
        repoPath: task.repoPath,
        query: task.query,
        swebench: task.swebench,
        ok: true,
        durationMs: 1,
        attempt: 1,
        maxAttempts: 1,
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

function benchmarkOptions(directory: string, runId: string): BenchmarkOptions {
    return {
        runId,
        output: path.join(directory, "results.jsonl"),
        copilotPath: "/copilot",
        runtimeEvidence: path.join(directory, "copilot-runtime.json"),
        providerBaseUrl: "http://127.0.0.1:1/v1",
        apiKeyEnv: "UNUSED_TEST_API_KEY",
        agent,
        mcp: { command: "", args: [], envVars: [] },
        timeoutMs: 1_000,
        maxConcurrency: 1,
        maxAttempts: 1,
        dockerPlatform: "linux/amd64",
        variants: ["baseline"],
    };
}

async function createCurrentRuntimeEvidence(
    copilotPath = "/copilot",
): Promise<Record<string, unknown>> {
    const ripgrepPath = await resolvePackagedRipgrepPath();
    const sha256 = createHash("sha256")
        .update(await readFile(ripgrepPath))
        .digest("hex");
    return {
        schemaVersion: 1,
        capturedAt: "2026-07-24T00:00:00.000Z",
        repositorySearch: {
            engine: "ripgrep",
            source: "copilot-packaged",
            executable: path.basename(ripgrepPath),
            sha256,
            sharedAcrossArms: true,
            snapshot: "filtered-immutable-directory",
        },
        harnesses: [
            {
                name: "copilot-sdk",
                sdkVersion: "1.0.4",
                copilotPath,
                version: "1.0.67",
                protocolVersion: 3,
            },
        ],
    };
}

test("resume skips an ok key and retries a failed variant", () => {
    const pending = selectPendingWork(
        [task],
        [{ name: "model-a", model: "route-a" }],
        [
            {
                taskId: task.id,
                matrixName: "model-a",
                variant: "baseline",
                ok: true,
            },
            {
                taskId: task.id,
                matrixName: "model-a",
                variant: "typeagent",
                ok: false,
            },
        ],
    );
    assert.deepEqual(
        pending.map((work) => work.variant),
        ["typeagent"],
    );
});

test("selects exactly one direct TypeAgent work item for a one-row smoke", () => {
    const pending = selectPendingWork(
        [task],
        [{ name: "azure/gpt-5.6-sol", model: "azure/gpt-5.6-sol" }],
        [],
        ["typeagent"],
    );

    assert.deepEqual(
        pending.map((work) => ({
            taskId: work.task.id,
            matrixName: work.entry.name,
            variant: work.variant,
        })),
        [
            {
                taskId: "repo__repo-1",
                matrixName: "azure/gpt-5.6-sol",
                variant: "typeagent",
            },
        ],
    );
});

test("resume uses the latest row for a task/model/variant key", () => {
    const pending = selectPendingWork(
        [task],
        [{ name: "model-a", model: "route-a" }],
        [
            {
                taskId: task.id,
                matrixName: "model-a",
                variant: "baseline",
                ok: true,
            },
            {
                taskId: task.id,
                matrixName: "model-a",
                variant: "baseline",
                ok: false,
            },
        ],
    );
    assert.deepEqual(
        pending.map((work) => work.variant),
        ["baseline", "typeagent"],
    );
});

test("force rerun selects every key despite successful prior rows", () => {
    const pending = selectPendingWork(
        [task],
        [{ name: "model-a", model: "route-a" }],
        [
            {
                taskId: task.id,
                matrixName: "model-a",
                variant: "baseline",
                ok: true,
            },
        ],
        ["baseline"],
        true,
    );

    assert.equal(pending.length, 1);
});

test("same-run resume rejects every stale task payload field", () => {
    const exact = baselineResult("run-a");
    assert.doesNotThrow(() => validateResumeTaskRows([task], [exact]));

    for (const stale of [
        { ...exact, query: "changed query" },
        { ...exact, repoPath: "/changed/repo" },
        { ...exact, rowIndex: 1 },
        {
            ...exact,
            swebench: { ...exact.swebench, rowIndex: 1 },
        },
        {
            ...exact,
            swebench: { ...exact.swebench, dataset: "changed/dataset" },
        },
        {
            ...exact,
            swebench: { ...exact.swebench, instanceId: "changed-instance" },
        },
        {
            ...exact,
            swebench: { ...exact.swebench, repo: "changed/repo" },
        },
        {
            ...exact,
            swebench: { ...exact.swebench, baseCommit: "changed-commit" },
        },
        {
            ...exact,
            swebench: { ...exact.swebench, patch: "changed patch" },
        },
        {
            ...exact,
            swebench: { ...exact.swebench, dockerImage: "changed-image" },
        },
    ]) {
        assert.throws(
            () => validateResumeTaskRows([task], [stale]),
            /task payload/i,
        );
    }
});

test("runtime evidence requires exact ripgrep and variant harness identity", async () => {
    const ripgrepPath = await resolvePackagedRipgrepPath();
    const ripgrepSha256 = createHash("sha256")
        .update(await readFile(ripgrepPath))
        .digest("hex");
    const valid = await createCurrentRuntimeEvidence();
    const expected = {
        ripgrepPath,
        ripgrepSha256,
        variants: ["baseline" as const],
        copilotPath: "/copilot",
    };
    assert.doesNotThrow(() => validateRuntimeEvidence(valid, expected));

    const repositorySearch = valid.repositorySearch as Record<string, unknown>;
    const harnesses = valid.harnesses as Array<Record<string, unknown>>;
    for (const invalid of [
        { ...valid, schemaVersion: 0 },
        {
            ...valid,
            repositorySearch: { ...repositorySearch, executable: "other-rg" },
        },
        {
            ...valid,
            repositorySearch: {
                ...repositorySearch,
                sharedAcrossArms: false,
            },
        },
        { ...valid, harnesses: [] },
        { ...valid, harnesses: [...harnesses, ...harnesses] },
    ]) {
        assert.throws(
            () => validateRuntimeEvidence(invalid, expected),
            /runtime evidence/i,
        );
    }
});

test("rejects conflicting harness identity while merging resume evidence", () => {
    const prior = {
        name: "copilot-sdk",
        sdkVersion: "1.0.4",
        copilotPath: "/copilot",
        version: "1.0.67",
        protocolVersion: 3,
    };
    assert.deepEqual(
        mergeHarnessEvidence({ harnesses: [prior] }, [structuredClone(prior)]),
        [prior],
    );
    assert.throws(
        () =>
            mergeHarnessEvidence({ harnesses: [prior] }, [
                { ...prior, version: "changed" },
            ]),
        /harness identity/i,
    );
});

test("preserves valid runtime evidence on a fully cached resume", async () => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "typeagent-preserved-runtime-evidence-"),
    );
    const output = path.join(directory, "results.jsonl");
    const runtimeEvidence = path.join(directory, "copilot-runtime.json");
    try {
        const initial = `${JSON.stringify(
            await createCurrentRuntimeEvidence(),
            undefined,
            2,
        )}\n`;
        await writeFile(runtimeEvidence, initial, "utf8");
        await writeFile(
            output,
            `${JSON.stringify(baselineResult("cached-resume"))}\n`,
            "utf8",
        );

        await runBenchmark(
            [task],
            [{ name: "model-a", model: "route-a" }],
            benchmarkOptions(directory, "cached-resume"),
        );

        assert.equal(await readFile(runtimeEvidence, "utf8"), initial);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("fully cached imported rows require a verified direct source runtime artifact", async () => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "typeagent-imported-runtime-evidence-"),
    );
    const sourceDirectory = path.join(directory, "source");
    const targetDirectory = path.join(directory, "target");
    const sourceOutput = path.join(sourceDirectory, "results.jsonl");
    const sourceManifestPath = path.join(sourceDirectory, "manifest.json");
    const sourceRuntimeEvidence = path.join(
        sourceDirectory,
        "copilot-runtime.json",
    );
    const options = benchmarkOptions(targetDirectory, "target-run");
    const sourceManifest: RunManifest = {
        schemaVersion: 1,
        cacheCompatibilityRevision: 18,
        runId: "source-run",
        createdAt: "2026-07-24T00:00:00.000Z",
        dataset: task.swebench.dataset,
        split: "test",
        taskIds: [task.id],
        matrix: [{ name: "model-a", model: "route-a" }],
        variants: ["baseline"],
        output: sourceOutput,
        copilotPath: options.copilotPath,
        runtimeEvidence: sourceRuntimeEvidence,
        provider: {
            type: "openai-compatible",
            baseUrl: options.providerBaseUrl,
            apiKeyEnv: options.apiKeyEnv,
            wireApi: "responses",
        },
        mcp: options.mcp,
        agent,
        maxConcurrency: 1,
        maxAttempts: 1,
        timeoutMs: options.timeoutMs,
        dockerPlatform: options.dockerPlatform,
    };
    const imported = baselineResult("target-run", {
        reusedFrom: {
            originalRunId: "source-run",
            sourceRunId: "source-run",
            resultsPath: sourceOutput,
            manifestPath: sourceManifestPath,
            runtimeEvidence: sourceRuntimeEvidence,
            importedAt: "2026-07-24T01:00:00.000Z",
        },
    });
    try {
        await mkdir(sourceDirectory, { recursive: true });
        await mkdir(targetDirectory, { recursive: true });
        await writeFile(sourceManifestPath, JSON.stringify(sourceManifest));
        await writeFile(
            sourceRuntimeEvidence,
            JSON.stringify(await createCurrentRuntimeEvidence()),
        );
        await writeFile(options.output, `${JSON.stringify(imported)}\n`);

        await runBenchmark(
            [task],
            [{ name: "model-a", model: "route-a" }],
            options,
        );

        const evidence = JSON.parse(
            await readFile(options.runtimeEvidence, "utf8"),
        );
        assert.equal(evidence.cachedOnly, true);
        assert.deepEqual(
            evidence.harnesses.map((value: { name: string }) => value.name),
            ["copilot-sdk"],
        );
        assert.equal(evidence.cachedSources.length, 1);
        assert.match(
            evidence.cachedSources[0].manifestSha256,
            /^[a-f0-9]{64}$/,
        );
        assert.match(
            evidence.cachedSources[0].evidenceSha256,
            /^[a-f0-9]{64}$/,
        );

        await rm(sourceRuntimeEvidence);
        await rm(options.runtimeEvidence);
        await assert.rejects(
            runBenchmark(
                [task],
                [{ name: "model-a", model: "route-a" }],
                options,
            ),
            /runtime evidence/i,
        );

        await writeFile(
            sourceRuntimeEvidence,
            JSON.stringify({
                ...(await createCurrentRuntimeEvidence()),
                cachedOnly: true,
            }),
        );
        await assert.rejects(
            runBenchmark(
                [task],
                [{ name: "model-a", model: "route-a" }],
                options,
            ),
            /cannot itself be cached-only/i,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("turns a provisionally successful integrity violation into a retryable failure", () => {
    const result = {
        runId: "run-a",
        taskId: task.id,
        matrixName: "model-a",
        model: "route-a",
        variant: "baseline",
        swebench: task.swebench,
        ok: true,
    } as RunResult;

    failClosedResultIntegrity(result, {
        runId: "run-a",
        taskIds: [task.id],
        matrix: [{ name: "model-a", model: "route-a" }],
        variants: ["baseline"],
        agent: {
            name: "explorer",
            description: "benchmark explorer",
            tools: [],
            prompt: "explore only",
            file: "/repo/.copilot/agents/explorer.md",
            sha256: "a".repeat(64),
        },
    });

    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /integrity validation failed/i);
});

test("allocates a unique telemetry file for every attempt", () => {
    const first = createTelemetryFilePath(
        "/runs/example/results.jsonl",
        task.id,
        "azure/gpt-5.6-luna",
        "typeagent",
        1,
    );
    const second = createTelemetryFilePath(
        "/runs/example/results.jsonl",
        task.id,
        "azure/gpt-5.6-luna",
        "typeagent",
        1,
    );
    assert.notEqual(first, second);
    assert.equal(path.dirname(first), "/runs/example/telemetry");
    assert.match(path.basename(first), /repo__repo-1.*typeagent.*\.json$/);
});

test("limits concurrency independently for each model", async () => {
    const active = new Map<string, number>();
    const maximum = new Map<string, number>();
    let totalActive = 0;
    let maximumTotal = 0;
    const items = ["model-a", "model-b"].flatMap((model) =>
        Array.from({ length: 4 }, (_, index) => ({
            task: { ...task, id: `${model}-${index}` },
            entry: { name: model, model },
            variant: "baseline" as const,
        })),
    );

    await mapWithConcurrencyPerModel(items, 2, async (item) => {
        const model = item.entry.name!;
        const modelActive = (active.get(model) ?? 0) + 1;
        active.set(model, modelActive);
        maximum.set(model, Math.max(maximum.get(model) ?? 0, modelActive));
        totalActive += 1;
        maximumTotal = Math.max(maximumTotal, totalActive);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active.set(model, active.get(model)! - 1);
        totalActive -= 1;
    });

    assert.deepEqual(Object.fromEntries(maximum), {
        "model-a": 2,
        "model-b": 2,
    });
    assert.equal(maximumTotal, 4);
});

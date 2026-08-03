// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
    assertCompleteRun,
    createProgressRowLabels,
    executionHarnessForVariant,
    createTelemetryFilePath,
    failClosedResultIntegrity,
    mapWithConcurrencyPerModel,
    selectPendingWork,
    validateAttemptTrajectories,
    validateRetainedTrajectories,
} from "../src/runner.js";
import type { BenchTask, RunResult } from "../src/types.js";

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

test("keeps held-out task identifiers out of progress labels", () => {
    const labels = createProgressRowLabels([
        task,
        { ...task, id: "private__row-2" },
    ]);
    assert.deepEqual([...labels.values()], ["row-1", "row-2"]);
    assert.doesNotMatch(
        [...labels.values()].join("\n"),
        /repo__repo|private__/u,
    );
});

test("refuses to resume successful or failed rows created without trajectories", async () => {
    for (const ok of [true, false]) {
        await assert.rejects(
            validateRetainedTrajectories([
                {
                    taskId: task.id,
                    ok,
                    model: "azure/gpt-5.6-luna",
                    variant: "baseline",
                    attempt: 1,
                } as RunResult,
            ]),
            /requires a main trajectory/i,
        );
    }
});

test("refuses to append a fresh result without its trajectory", async () => {
    await assert.rejects(
        validateAttemptTrajectories({
            taskId: task.id,
            ok: false,
            model: "azure/gpt-5.6-luna",
            variant: "baseline",
            attempt: 1,
        } as RunResult),
        /requires a main trajectory/i,
    );
});

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
                attempt: 1,
                maxAttempts: 2,
            },
            {
                taskId: task.id,
                matrixName: "model-a",
                variant: "typeagent",
                ok: false,
                attempt: 1,
                maxAttempts: 2,
            },
        ],
        ["baseline", "typeagent"],
        false,
        2,
    );
    assert.deepEqual(
        pending.map((work) => ({
            variant: work.variant,
            startAttempt: work.startAttempt,
        })),
        [{ variant: "typeagent", startAttempt: 2 }],
    );
});

test("selects exactly one TypeAgent MCP work item for a one-row smoke", () => {
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

test("routes every benchmark arm through the Copilot harness", () => {
    assert.equal(executionHarnessForVariant("baseline"), "copilot-subagent");
    assert.equal(executionHarnessForVariant("typeagent"), "copilot-mcp");
    assert.equal(executionHarnessForVariant("typeagent-lsp"), "copilot-mcp");
});

test("resume does not retry a failed key that exhausted its attempts", () => {
    const pending = selectPendingWork(
        [task],
        [{ name: "model-a", model: "route-a" }],
        [
            {
                taskId: task.id,
                matrixName: "model-a",
                variant: "baseline",
                ok: true,
                attempt: 1,
                maxAttempts: 2,
            },
            {
                taskId: task.id,
                matrixName: "model-a",
                variant: "baseline",
                ok: false,
                attempt: 2,
                maxAttempts: 2,
            },
        ],
        ["baseline", "typeagent"],
        false,
        2,
    );
    assert.deepEqual(
        pending.map((work) => work.variant),
        ["typeagent"],
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
                attempt: 1,
                maxAttempts: 2,
            },
        ],
        ["baseline"],
        true,
    );

    assert.equal(pending.length, 1);
});

test("counterbalances variant order across consecutive tasks", () => {
    const tasks = Array.from({ length: 3 }, (_, index) => ({
        ...task,
        id: `repo__repo-${index + 1}`,
    }));
    const pending = selectPendingWork(
        tasks,
        [{ name: "model-a", model: "route-a" }],
        [],
        ["baseline", "typeagent", "typeagent-lsp"],
    );

    assert.deepEqual(
        pending.map((work) => [work.task.id, work.variant]),
        [
            ["repo__repo-1", "baseline"],
            ["repo__repo-1", "typeagent"],
            ["repo__repo-1", "typeagent-lsp"],
            ["repo__repo-2", "typeagent"],
            ["repo__repo-2", "typeagent-lsp"],
            ["repo__repo-2", "baseline"],
            ["repo__repo-3", "typeagent-lsp"],
            ["repo__repo-3", "baseline"],
            ["repo__repo-3", "typeagent"],
        ],
    );
});

test("fails closed unless every requested execution succeeds", () => {
    const matrix = [{ name: "model-a", model: "route-a" }];
    const variants = ["baseline", "typeagent"] as const;
    const complete = variants.map((variant) => ({
        taskId: task.id,
        matrixName: "model-a",
        variant,
        ok: true,
        attempt: 1,
        maxAttempts: 2,
    }));

    assert.doesNotThrow(() =>
        assertCompleteRun([task], matrix, [...variants], complete),
    );
    assert.throws(
        () =>
            assertCompleteRun(
                [task],
                matrix,
                [...variants],
                [{ ...complete[0], ok: false }],
            ),
        /incomplete.*expected=2.*successful=0.*failed=1.*missing=1/i,
    );
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
        attempt: 1,
        maxAttempts: 2,
    } as RunResult;

    failClosedResultIntegrity(result, {
        runId: "run-a",
        maxAttempts: 2,
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
            startAttempt: 1,
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

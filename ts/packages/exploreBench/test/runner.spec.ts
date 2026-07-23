// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
    createTelemetryFilePath,
    mapWithConcurrencyPerModel,
    selectPendingWork,
} from "../src/runner.js";
import type { BenchTask } from "../src/types.js";

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

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { swebenchDockerImage } from "../src/dataset.js";
import {
    cleanupProcessedImages,
    collectProcessedTaskImages,
    readCleanupResultSnapshot,
    type CleanupResultRow,
    type ProcessedImageCandidate,
} from "../src/imageCleanup.js";

const manifest = {
    runId: "run-500",
    taskIds: ["repo__repo-1", "repo__repo-2"],
    matrix: [
        { name: "model-a", model: "route-a" },
        { name: "model-b", model: "route-b" },
    ],
    variants: ["baseline", "typeagent"] as const,
    maxAttempts: 2,
};

function rowsForTask(
    taskId: string,
    override: Partial<CleanupResultRow> = {},
): CleanupResultRow[] {
    return manifest.matrix.flatMap((entry) =>
        manifest.variants.map((variant) => ({
            runId: manifest.runId,
            taskId,
            matrixName: entry.name,
            variant,
            ok: true,
            attempt: 1,
            maxAttempts: 2,
            repoPath: `/repos/${taskId}`,
            swebench: { dockerImage: swebenchDockerImage(taskId) },
            ...override,
        })),
    );
}

test("selects only tasks whose model and variant keys are terminal", () => {
    const completed = rowsForTask("repo__repo-1");
    const incomplete = rowsForTask("repo__repo-2");
    incomplete[incomplete.length - 1] = {
        ...incomplete[incomplete.length - 1],
        ok: false,
        attempt: 1,
    };

    assert.deepEqual(
        collectProcessedTaskImages(manifest, [...completed, ...incomplete]),
        [
            {
                taskId: "repo__repo-1",
                image: swebenchDockerImage("repo__repo-1"),
                repoPath: "/repos/repo__repo-1",
            },
        ],
    );

    incomplete.push({
        ...incomplete[incomplete.length - 1],
        attempt: 2,
    });
    assert.equal(
        collectProcessedTaskImages(manifest, [...completed, ...incomplete])
            .length,
        2,
    );
});

test("fails closed when result image identity does not match the task", () => {
    const rows = rowsForTask("repo__repo-1");
    rows[0] = {
        ...rows[0],
        swebench: { dockerImage: "docker.io/swebench/unexpected:latest" },
    };
    assert.throws(
        () => collectProcessedTaskImages(manifest, rows),
        /image mismatch/,
    );
});

test("removes exact unused images without force and skips missing or used images", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "image-cleanup-"));
    const candidates: ProcessedImageCandidate[] = [
        "repo__repo-1",
        "repo__repo-2",
        "repo__repo-3",
    ].map((taskId) => ({
        taskId,
        image: swebenchDockerImage(taskId),
        repoPath: path.join(directory, taskId),
    }));
    for (const candidate of candidates) {
        await writeFile(
            `${candidate.repoPath}.provenance.json`,
            JSON.stringify({ dockerImage: candidate.image }),
        );
    }
    const calls: string[][] = [];
    try {
        const result = await cleanupProcessedImages(candidates, {
            runDocker: async (args) => {
                calls.push(args);
                const image = args[args.length - 1];
                if (args[0] === "image" && args[1] === "inspect") {
                    if (image === candidates[1].image) {
                        throw new Error("No such image");
                    }
                    return "present";
                }
                if (args[0] === "container") {
                    return image === `ancestor=${candidates[2].image}`
                        ? "container-id\n"
                        : "";
                }
                return "removed";
            },
        });

        assert.deepEqual(result, {
            removed: [candidates[0]],
            missing: [candidates[1]],
            inUse: [candidates[2]],
            wouldRemove: [],
            skippedProvenance: [],
            errors: [],
        });
        assert.deepEqual(
            calls.find((args) => args[0] === "image" && args[1] === "rm"),
            ["image", "rm", candidates[0].image],
        );
        assert.equal(
            calls.some((args) => args.includes("-f") || args.includes("prune")),
            false,
        );
        assert.equal(
            calls.some(
                (args) =>
                    args[0] === "system" ||
                    args[0] === "volume" ||
                    (args[0] === "container" && args[1] !== "ls"),
            ),
            false,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("rejects out-of-scope image values before calling Docker", async () => {
    let called = false;
    const candidate: ProcessedImageCandidate = {
        taskId: "repo__repo-1",
        image: "docker.io/unrelated/image:latest",
        repoPath: "/repos/repo__repo-1",
    };
    await assert.rejects(
        cleanupProcessedImages([candidate], {
            runDocker: async () => {
                called = true;
                return "";
            },
        }),
        /unsafe cleanup image/,
    );
    assert.equal(called, false);
});

test("dry run reports removable images without deleting them", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "image-cleanup-"));
    const candidate: ProcessedImageCandidate = {
        taskId: "repo__repo-1",
        image: swebenchDockerImage("repo__repo-1"),
        repoPath: path.join(directory, "repo__repo-1"),
    };
    await writeFile(
        `${candidate.repoPath}.provenance.json`,
        JSON.stringify({ dockerImage: candidate.image }),
    );
    const calls: string[][] = [];
    try {
        const result = await cleanupProcessedImages([candidate], {
            dryRun: true,
            runDocker: async (args) => {
                calls.push(args);
                return "";
            },
        });
        assert.deepEqual(result.wouldRemove, [candidate]);
        assert.equal(
            calls.some((args) => args[1] === "rm"),
            false,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("snapshot reader ignores only a partial trailing JSONL row", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "image-cleanup-"));
    const input = path.join(directory, "results.jsonl");
    const row = rowsForTask("repo__repo-1")[0];
    try {
        await writeFile(input, `${JSON.stringify(row)}\n{\"partial\":`, "utf8");
        assert.deepEqual(await readCleanupResultSnapshot(input), [row]);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

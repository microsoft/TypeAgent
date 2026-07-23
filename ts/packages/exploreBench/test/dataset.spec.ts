// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
    loadVerifiedTasks,
    patchLanguages,
    selectByRepo,
    selectRandomBySeed,
    swebenchDockerImage,
    verifiedDataset,
} from "../src/dataset.js";

function row(instanceId: string, repo: string, rowIndex: number) {
    return {
        row_idx: rowIndex,
        row: {
            instance_id: instanceId,
            repo,
            problem_statement: "problem",
            patch: "patch",
        },
        truncated_cells: [],
    };
}

test("selects distinct repositories before repeating in source order", () => {
    const rows = [
        row("astropy__astropy-1", "astropy/astropy", 0),
        row("astropy__astropy-2", "astropy/astropy", 1),
        row("django__django-1", "django/django", 2),
        row("sympy__sympy-1", "sympy/sympy", 3),
        row("django__django-2", "django/django", 4),
    ];
    assert.deepEqual(
        selectByRepo(rows, 5).map((entry) => entry.row.instance_id),
        [
            "astropy__astropy-1",
            "django__django-1",
            "sympy__sympy-1",
            "astropy__astropy-2",
            "django__django-2",
        ],
    );
});

test("selects a held-out window from the same deterministic order", () => {
    const rows = [
        row("astropy__astropy-1", "astropy/astropy", 0),
        row("astropy__astropy-2", "astropy/astropy", 1),
        row("django__django-1", "django/django", 2),
        row("sympy__sympy-1", "sympy/sympy", 3),
        row("django__django-2", "django/django", 4),
    ];

    assert.deepEqual(
        selectByRepo(rows, 2, 2).map((entry) => entry.row.instance_id),
        ["sympy__sympy-1", "astropy__astropy-2"],
    );
});

test("selects a stable seeded sample without replacement", () => {
    const rows = Array.from({ length: 8 }, (_, index) =>
        row(`repo__repo-${index}`, "repo/repo", index),
    );

    const first = selectRandomBySeed(rows, 5, 12_345);
    const repeated = selectRandomBySeed(rows, 5, 12_345);
    const different = selectRandomBySeed(rows, 5, 54_321);

    assert.deepEqual(repeated, first);
    assert.notDeepEqual(different, first);
    assert.equal(new Set(first).size, first.length);
    assert.deepEqual(
        rows.map((entry) => entry.row_idx),
        [0, 1, 2, 3, 4, 5, 6, 7],
    );
});

test("loads the seeded random sample instead of the deterministic window", async (t) => {
    const dataDir = await mkdtemp(
        path.join(os.tmpdir(), "explore-bench-seed-"),
    );
    t.after(() => rm(dataDir, { recursive: true, force: true }));
    const cacheDir = path.join(dataDir, "swebench", "datasets");
    const rows = Array.from({ length: 12 }, (_, index) =>
        row(`repo__repo-${index}`, `repo-${index}/repo`, index),
    );
    await mkdir(cacheDir, { recursive: true });
    await writeFile(
        path.join(cacheDir, "verified-test.rows.json"),
        JSON.stringify({
            dataset: verifiedDataset,
            config: "default",
            split: "test",
            downloadedAt: "2026-07-21T00:00:00.000Z",
            rows,
        }),
    );

    const tasks = await loadVerifiedTasks({
        dataDir,
        limit: 5,
        offset: 0,
        seed: "generalization-2026-07-21",
        dockerPlatform: "linux/amd64",
    });

    assert.deepEqual(
        tasks.map((task) => task.id),
        selectRandomBySeed(rows, 5, "generalization-2026-07-21").map(
            (entry) => entry.row.instance_id,
        ),
    );
    assert.notDeepEqual(
        tasks.map((task) => task.id),
        selectByRepo(rows, 5).map((entry) => entry.row.instance_id),
    );
});

test("rejects seeded samples outside the available row bounds", () => {
    const rows = [row("repo__repo-1", "repo/repo", 1)];

    assert.throws(() => selectRandomBySeed(rows, 0, 1), /positive integer/);
    assert.throws(() => selectRandomBySeed(rows, 2, 1), /no greater than 1/);
    assert.throws(
        () => selectRandomBySeed(rows, 1, -1),
        /non-negative integer/,
    );
    assert.throws(() => selectRandomBySeed(rows, 1, ""), /must not be empty/);
});

test("derives the standard SWE-bench image name", () => {
    assert.equal(
        swebenchDockerImage("astropy__astropy-12907"),
        "docker.io/swebench/sweb.eval.x86_64.astropy_1776_astropy-12907:latest",
    );
});

test("classifies and filters patch languages after task selection", async (t) => {
    const dataDir = await mkdtemp(
        path.join(os.tmpdir(), "explore-bench-languages-"),
    );
    t.after(() => rm(dataDir, { recursive: true, force: true }));
    const cacheDir = path.join(dataDir, "swebench", "datasets");
    await mkdir(cacheDir, { recursive: true });
    const languageRows = [
        row("repo__python-1", "repo/python", 0),
        row("repo__typescript-1", "repo/typescript", 1),
        row("repo__other-1", "repo/other", 2),
    ];
    languageRows[0].row.patch =
        "diff --git a/a.py b/a.py\n--- a/a.py\n+++ b/a.py\n";
    languageRows[1].row.patch =
        "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n";
    languageRows[2].row.patch =
        "diff --git a/a.rs b/a.rs\n--- a/a.rs\n+++ b/a.rs\n";
    await writeFile(
        path.join(cacheDir, "verified-test.rows.json"),
        JSON.stringify({
            dataset: verifiedDataset,
            config: "default",
            split: "test",
            downloadedAt: "2026-07-23T00:00:00.000Z",
            rows: languageRows,
        }),
    );

    const tasks = await loadVerifiedTasks({
        dataDir,
        limit: 3,
        offset: 0,
        languages: ["python", "typescript"],
        dockerPlatform: "linux/amd64",
    });

    assert.deepEqual(
        tasks.map((task) => task.id),
        ["repo__python-1", "repo__typescript-1"],
    );
    assert.deepEqual(patchLanguages(languageRows[0].row.patch), ["python"]);
    assert.deepEqual(patchLanguages(languageRows[1].row.patch), ["typescript"]);
    assert.deepEqual(patchLanguages(languageRows[2].row.patch), []);
});

test("keeps the gold patch out of the model query", async (t) => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "explore-bench-"));
    t.after(() => rm(dataDir, { recursive: true, force: true }));
    const cacheDir = path.join(dataDir, "swebench", "datasets");
    await mkdir(cacheDir, { recursive: true });
    await writeFile(
        path.join(cacheDir, "verified-test.rows.json"),
        JSON.stringify({
            dataset: verifiedDataset,
            config: "default",
            split: "test",
            downloadedAt: "2026-07-21T00:00:00.000Z",
            rows: [
                {
                    row_idx: 7,
                    row: {
                        instance_id: "repo__repo-7",
                        repo: "repo/repo",
                        problem_statement: "VISIBLE_PROBLEM_STATEMENT",
                        patch: "SECRET_GOLD_PATCH_SENTINEL",
                    },
                    truncated_cells: [],
                },
            ],
        }),
    );

    const [task] = await loadVerifiedTasks({
        dataDir,
        limit: 1,
        offset: 0,
        dockerPlatform: "linux/amd64",
    });

    assert.match(task.query, /VISIBLE_PROBLEM_STATEMENT/);
    assert.doesNotMatch(task.query, /SECRET_GOLD_PATCH_SENTINEL/);
    assert.equal(task.swebench.patch, "SECRET_GOLD_PATCH_SENTINEL");
});

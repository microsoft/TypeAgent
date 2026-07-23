// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
    ensureDockerRepo,
    getDockerRepoProvenancePath,
    type DockerRepoCommands,
} from "../src/docker.js";
import type { BenchTask } from "../src/types.js";

const dockerImage = "docker.io/swebench/example:latest";
const baseCommit = "0123456789abcdef0123456789abcdef01234567";

function createTask(repoPath: string): BenchTask {
    return {
        id: "example__example-1",
        repoPath,
        query: "find bug",
        swebench: {
            dataset: "princeton-nlp/SWE-bench_Verified",
            split: "test",
            rowIndex: 0,
            instanceId: "example__example-1",
            baseCommit,
            patch: "patch",
            dockerImage,
        },
    };
}

function provenance(overrides: Record<string, unknown> = {}): string {
    return `${JSON.stringify(
        {
            schemaVersion: 1,
            dockerImage,
            baseCommit,
            gitHead: baseCommit,
            gitStatus: "",
            ...overrides,
        },
        undefined,
        2,
    )}\n`;
}

async function seedRepo(repoPath: string): Promise<void> {
    await mkdir(repoPath, { recursive: true });
    await writeFile(path.join(repoPath, "README.md"), "cached\n", "utf8");
}

function fakeCommands(options: {
    cachedHead?: string | undefined;
    cachedStatus?: string | undefined;
    baseIsAncestor?: boolean | undefined;
    extractedStatus?: string | undefined;
}) {
    const dockerCalls: string[][] = [];
    let extracted = false;
    const commands: DockerRepoCommands = {
        runDocker: async (args) => {
            dockerCalls.push([...args]);
            if (args[0] === "create") {
                return "temporary-container\n";
            }
            if (args[0] === "cp") {
                extracted = true;
                const destination = args[2];
                assert.ok(destination);
                await mkdir(destination, { recursive: true });
                await writeFile(
                    path.join(destination, "README.md"),
                    "extracted\n",
                    "utf8",
                );
            }
            return "";
        },
        runGit: async (_repoPath, args) => {
            if (args[0] === "rev-parse") {
                return `${extracted ? baseCommit : (options.cachedHead ?? baseCommit)}\n`;
            }
            if (args[0] === "status") {
                return extracted
                    ? (options.extractedStatus ?? "")
                    : (options.cachedStatus ?? "");
            }
            if (args[0] === "merge-base") {
                if (!extracted && options.baseIsAncestor === false) {
                    throw new Error("not an ancestor");
                }
                return "";
            }
            throw new Error(`unexpected git command: ${args.join(" ")}`);
        },
    };
    return { commands, dockerCalls };
}

test("reuses only a matching clean cache at the expected Git HEAD", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "explore-bench-docker-"));
    try {
        const task = createTask(path.join(root, "repo"));
        await seedRepo(task.repoPath);
        await writeFile(
            getDockerRepoProvenancePath(task.repoPath),
            provenance(),
            "utf8",
        );
        const { commands, dockerCalls } = fakeCommands({});

        await ensureDockerRepo(task, "linux/amd64", commands);

        assert.deepEqual(dockerCalls, []);
        assert.equal(
            await readFile(path.join(task.repoPath, "README.md"), "utf8"),
            "cached\n",
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("reuses a clean standard image setup commit descended from the base commit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "explore-bench-docker-"));
    try {
        const task = createTask(path.join(root, "repo"));
        const setupHead = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        await seedRepo(task.repoPath);
        await writeFile(
            getDockerRepoProvenancePath(task.repoPath),
            provenance({ gitHead: setupHead }),
            "utf8",
        );
        const { commands, dockerCalls } = fakeCommands({
            cachedHead: setupHead,
        });

        await ensureDockerRepo(task, "linux/amd64", commands);

        assert.deepEqual(dockerCalls, []);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("reuses a cache with the same image-provided untracked paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "explore-bench-docker-"));
    try {
        const task = createTask(path.join(root, "repo"));
        const gitStatus = "?? build/generated.py\n";
        await seedRepo(task.repoPath);
        await writeFile(
            getDockerRepoProvenancePath(task.repoPath),
            provenance({ gitStatus }),
            "utf8",
        );
        const { commands, dockerCalls } = fakeCommands({
            cachedStatus: gitStatus,
        });

        await ensureDockerRepo(task, "linux/amd64", commands);

        assert.deepEqual(dockerCalls, []);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

for (const invalidCache of [
    {
        name: "missing repository",
        seed: false,
    },
    {
        name: "missing provenance",
        seed: true,
    },
    {
        name: "mismatched image provenance",
        seed: true,
        metadata: provenance({
            dockerImage: "docker.io/swebench/other:latest",
        }),
    },
    {
        name: "mismatched base commit provenance",
        seed: true,
        metadata: provenance({
            baseCommit: "1111111111111111111111111111111111111111",
        }),
    },
    {
        name: "mismatched recorded Git HEAD",
        seed: true,
        metadata: provenance({
            gitHead: "2222222222222222222222222222222222222222",
        }),
    },
    {
        name: "wrong cached Git HEAD",
        seed: true,
        metadata: provenance(),
        cachedHead: "3333333333333333333333333333333333333333",
    },
    {
        name: "dirty cached worktree",
        seed: true,
        metadata: provenance(),
        cachedStatus: " M README.md\n",
    },
    {
        name: "changed untracked paths",
        seed: true,
        metadata: provenance({ gitStatus: "?? build/original.py\n" }),
        cachedStatus: "?? build/changed.py\n",
    },
    {
        name: "base commit outside the cached HEAD ancestry",
        seed: true,
        metadata: provenance({
            gitHead: "4444444444444444444444444444444444444444",
        }),
        cachedHead: "4444444444444444444444444444444444444444",
        baseIsAncestor: false,
    },
]) {
    test(`re-extracts a cache with ${invalidCache.name}`, async () => {
        const root = await mkdtemp(
            path.join(os.tmpdir(), "explore-bench-docker-"),
        );
        try {
            const task = createTask(path.join(root, "repo"));
            if (invalidCache.seed) {
                await seedRepo(task.repoPath);
            }
            if (invalidCache.metadata !== undefined) {
                await writeFile(
                    getDockerRepoProvenancePath(task.repoPath),
                    invalidCache.metadata,
                    "utf8",
                );
            }
            const { commands, dockerCalls } = fakeCommands({
                cachedHead: invalidCache.cachedHead,
                cachedStatus: invalidCache.cachedStatus,
                baseIsAncestor: invalidCache.baseIsAncestor,
            });

            await ensureDockerRepo(task, "linux/amd64", commands);

            assert.equal(
                dockerCalls.filter((args) => args[0] === "create").length,
                1,
            );
            assert.equal(
                await readFile(path.join(task.repoPath, "README.md"), "utf8"),
                "extracted\n",
            );
            assert.deepEqual(
                JSON.parse(
                    await readFile(
                        getDockerRepoProvenancePath(task.repoPath),
                        "utf8",
                    ),
                ),
                {
                    schemaVersion: 1,
                    dockerImage,
                    baseCommit,
                    gitHead: baseCommit,
                    gitStatus: "",
                },
            );
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
}

test("records image-provided untracked paths after extraction", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "explore-bench-docker-"));
    try {
        const task = createTask(path.join(root, "repo"));
        const gitStatus = "?? build/generated.py\n";
        const { commands } = fakeCommands({ extractedStatus: gitStatus });

        await ensureDockerRepo(task, "linux/amd64", commands);

        const stored = JSON.parse(
            await readFile(getDockerRepoProvenancePath(task.repoPath), "utf8"),
        );
        assert.equal(stored.gitStatus, gitStatus);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("stores provenance beside the repository, not inside it", () => {
    const repoPath = path.join("cache", "instance");
    assert.equal(
        getDockerRepoProvenancePath(repoPath),
        path.join("cache", "instance.provenance.json"),
    );
});

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawn } from "node:child_process";
import {
    mkdir,
    readFile,
    readdir,
    rename,
    rm,
    stat,
    writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { BenchTask } from "./types.js";

interface DockerRepoProvenance {
    schemaVersion: 1;
    dockerImage: string;
    baseCommit: string | null;
    gitHead: string;
    gitStatus: string;
}

interface DockerRepoState {
    gitHead: string;
    gitStatus: string;
}

export interface DockerRepoCommands {
    runDocker(args: string[], timeoutMs?: number): Promise<string>;
    runGit(
        repoPath: string,
        args: string[],
        timeoutMs?: number,
    ): Promise<string>;
}

const defaultCommands: DockerRepoCommands = {
    runDocker,
    runGit,
};

export async function ensureDockerRepo(
    task: BenchTask,
    platform: string,
    commands: DockerRepoCommands = defaultCommands,
): Promise<void> {
    if (await isReusableCache(task, commands)) {
        return;
    }

    await mkdir(path.dirname(task.repoPath), { recursive: true });
    const present = await commands
        .runDocker(["image", "inspect", task.swebench.dockerImage])
        .then(() => true)
        .catch(() => false);
    if (!present) {
        await commands.runDocker(
            ["pull", "--platform", platform, task.swebench.dockerImage],
            30 * 60_000,
        );
    }

    const temporary = `${task.repoPath}.tmp-${process.pid}-${Date.now()}`;
    await rm(temporary, { recursive: true, force: true });
    await mkdir(temporary, { recursive: true });
    let containerId = "";
    try {
        containerId = (
            await commands.runDocker([
                "create",
                "--platform",
                platform,
                task.swebench.dockerImage,
            ])
        ).trim();
        await commands.runDocker(
            ["cp", `${containerId}:/testbed/.`, temporary],
            20 * 60_000,
        );
        const repoState = await inspectRepoState(
            temporary,
            task.swebench.baseCommit,
            commands,
        );
        await rm(task.repoPath, { recursive: true, force: true });
        await rename(temporary, task.repoPath);
        await writeProvenance(task, repoState);
    } finally {
        if (containerId) {
            await commands
                .runDocker(["rm", "-f", containerId])
                .catch(() => undefined);
        }
        await rm(temporary, { recursive: true, force: true });
    }
}

export function getDockerRepoProvenancePath(repoPath: string): string {
    return `${repoPath}.provenance.json`;
}

async function isReusableCache(
    task: BenchTask,
    commands: DockerRepoCommands,
): Promise<boolean> {
    if (!(await hasFiles(task.repoPath))) {
        return false;
    }

    const provenance = await readProvenance(task.repoPath);
    if (
        provenance === undefined ||
        provenance.dockerImage !== task.swebench.dockerImage ||
        provenance.baseCommit !== (task.swebench.baseCommit ?? null)
    ) {
        return false;
    }

    try {
        const repoState = await inspectRepoState(
            task.repoPath,
            task.swebench.baseCommit,
            commands,
        );
        return (
            repoState.gitHead === provenance.gitHead &&
            repoState.gitStatus === provenance.gitStatus
        );
    } catch {
        return false;
    }
}

async function readProvenance(
    repoPath: string,
): Promise<DockerRepoProvenance | undefined> {
    try {
        const value: unknown = JSON.parse(
            await readFile(getDockerRepoProvenancePath(repoPath), "utf8"),
        );
        if (!isDockerRepoProvenance(value)) {
            return undefined;
        }
        return value;
    } catch {
        return undefined;
    }
}

function isDockerRepoProvenance(value: unknown): value is DockerRepoProvenance {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return (
        candidate.schemaVersion === 1 &&
        typeof candidate.dockerImage === "string" &&
        (typeof candidate.baseCommit === "string" ||
            candidate.baseCommit === null) &&
        typeof candidate.gitHead === "string" &&
        typeof candidate.gitStatus === "string"
    );
}

async function inspectRepoState(
    repoPath: string,
    expectedHead: string | undefined,
    commands: DockerRepoCommands,
): Promise<DockerRepoState> {
    const gitHead = (
        await commands.runGit(repoPath, ["rev-parse", "--verify", "HEAD"])
    ).trim();
    if (!gitHead) {
        throw new Error(`repository has no Git HEAD: ${repoPath}`);
    }
    if (expectedHead !== undefined && expectedHead.trim().length > 0) {
        try {
            await commands.runGit(repoPath, [
                "merge-base",
                "--is-ancestor",
                expectedHead,
                gitHead,
            ]);
        } catch {
            throw new Error(
                `repository Git HEAD ${gitHead} does not descend from ${expectedHead}`,
            );
        }
    }

    const gitStatus = await commands.runGit(repoPath, [
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
    ]);
    const trackedChanges = gitStatus
        .split(/\r?\n/)
        .filter(Boolean)
        .filter((line) => !line.startsWith("?? "));
    if (trackedChanges.length > 0) {
        throw new Error(`repository tracked worktree is dirty: ${repoPath}`);
    }
    return { gitHead, gitStatus };
}

async function writeProvenance(
    task: BenchTask,
    repoState: DockerRepoState,
): Promise<void> {
    const provenancePath = getDockerRepoProvenancePath(task.repoPath);
    const temporary = `${provenancePath}.tmp-${process.pid}-${Date.now()}`;
    const provenance: DockerRepoProvenance = {
        schemaVersion: 1,
        dockerImage: task.swebench.dockerImage,
        baseCommit: task.swebench.baseCommit ?? null,
        gitHead: repoState.gitHead,
        gitStatus: repoState.gitStatus,
    };
    try {
        await writeFile(
            temporary,
            `${JSON.stringify(provenance, undefined, 2)}\n`,
            "utf8",
        );
        await rename(temporary, provenancePath);
    } finally {
        await rm(temporary, { force: true });
    }
}

async function hasFiles(directory: string): Promise<boolean> {
    try {
        return (
            (await stat(directory)).isDirectory() &&
            (await readdir(directory)).length > 0
        );
    } catch {
        return false;
    }
}

function runDocker(args: string[], timeoutMs = 5 * 60_000): Promise<string> {
    return runCommand("docker", args, timeoutMs);
}

function runGit(
    repoPath: string,
    args: string[],
    timeoutMs = 5 * 60_000,
): Promise<string> {
    return runCommand("git", ["-C", repoPath, ...args], timeoutMs);
}

function runCommand(
    command: string,
    args: string[],
    timeoutMs: number,
): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
        child.stdout.on("data", (chunk: Buffer) => {
            stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString();
        });
        child.on("error", (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            if (code === 0) {
                resolve(stdout);
            } else {
                reject(
                    new Error(
                        `${command} ${args.join(" ")} failed (${code})\n${stdout}${stderr}`,
                    ),
                );
            }
        });
    });
}

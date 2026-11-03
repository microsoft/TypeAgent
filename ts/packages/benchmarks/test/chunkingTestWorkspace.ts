// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";

export async function chunkingTestWorkspace(prefix: string) {
    const directory = path.join(
        process.cwd(),
        "local",
        "benchmark-test-workspaces",
    );
    await mkdir(directory, { recursive: true });
    const root = await mkdtemp(path.join(directory, prefix));
    const repo = path.join(root, "checkout");
    const bridge = path.join(
        repo,
        "ts",
        "packages",
        "memory",
        "service",
        "src",
        "benchmarkBridge.ts",
    );
    await mkdir(path.dirname(bridge), { recursive: true });
    await writeFile(bridge, "synthetic source identity");
    return { root, repo };
}

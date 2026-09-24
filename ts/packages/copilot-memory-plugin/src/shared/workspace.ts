// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

export const MEMORY_FILE_NAME = "conversationMemory";

export type MemoryPaths = {
    workspaceRoot: string;
    dirPath: string;
    baseFileName: string;
};

export function resolveWorkspaceRoot(cwd: string): string {
    const resolved = path.resolve(cwd);
    try {
        const root = execFileSync(
            "git",
            ["-C", resolved, "rev-parse", "--show-toplevel"],
            { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
        ).trim();
        if (root) {
            return root;
        }
    } catch {
        // Not a git checkout. The working directory is the workspace.
    }
    return resolved;
}

export function resolveMemoryPaths(
    cwd: string,
    env: NodeJS.ProcessEnv = process.env,
): MemoryPaths {
    const workspaceRoot = resolveWorkspaceRoot(cwd);
    const override = env.TYPEAGENT_MEMORY_DIR;
    if (override && override.trim().length > 0) {
        return {
            workspaceRoot,
            dirPath: path.resolve(override),
            baseFileName: MEMORY_FILE_NAME,
        };
    }
    const id = createHash("sha256")
        .update(workspaceRoot)
        .digest("hex")
        .slice(0, 16);
    return {
        workspaceRoot,
        dirPath: path.join(os.homedir(), ".typeagent", "copilot-memory", id),
        baseFileName: MEMORY_FILE_NAME,
    };
}

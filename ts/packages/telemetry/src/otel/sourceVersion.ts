// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MODULE_DIRECTORY = fileURLToPath(new URL(".", import.meta.url));
const OFFICIAL_REF = "origin/main";

export interface TypeAgentSourceVersion {
    readonly headRevision?: string;
    readonly baseRevision?: string;
}

export type GitVersionReader = (
    args: readonly string[],
) => Promise<string | undefined>;

let cachedSourceVersion: Promise<TypeAgentSourceVersion> | undefined;

/**
 * Resolve source versions once per process. Git failures are expected for
 * packaged deployments, so unavailable values are omitted without affecting
 * telemetry initialization.
 */
export function getTypeAgentSourceVersion(): Promise<TypeAgentSourceVersion> {
    cachedSourceVersion ??= resolveTypeAgentSourceVersion(readGit);
    return cachedSourceVersion;
}

export async function resolveTypeAgentSourceVersion(
    readVersion: GitVersionReader,
): Promise<TypeAgentSourceVersion> {
    const [headRevision, baseRevision] = await Promise.all([
        readVersion(["rev-parse", "HEAD"]),
        readVersion(["merge-base", "HEAD", OFFICIAL_REF]),
    ]);

    return {
        ...(headRevision === undefined ? {} : { headRevision }),
        ...(baseRevision === undefined ? {} : { baseRevision }),
    };
}

async function readGit(args: readonly string[]): Promise<string | undefined> {
    try {
        const { stdout } = await execFileAsync("git", [...args], {
            cwd: MODULE_DIRECTORY,
            windowsHide: true,
            encoding: "utf8",
        });
        const value = stdout.trim();
        return value.length === 0 ? undefined : value;
    } catch {
        return undefined;
    }
}

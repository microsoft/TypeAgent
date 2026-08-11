// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { detectResources, envDetector } from "@opentelemetry/resources";
import {
    ATTR_VCS_REF_BASE_REVISION,
    ATTR_VCS_REF_HEAD_REVISION,
} from "@opentelemetry/semantic-conventions/incubating";

const execFileAsync = promisify(execFile);
const MODULE_DIRECTORY = fileURLToPath(new URL(".", import.meta.url));
const OFFICIAL_REF = "origin/main";
const GIT_TIMEOUT_MS = 5_000;

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
    cachedSourceVersion ??= resolveTypeAgentSourceVersion(
        readGit,
        readTypeAgentSourceVersionFromEnvironment(),
    );
    return cachedSourceVersion;
}

export async function resolveTypeAgentSourceVersion(
    readVersion: GitVersionReader,
    configuredVersion: TypeAgentSourceVersion = {},
): Promise<TypeAgentSourceVersion> {
    const [headRevision, baseRevision] = await Promise.all([
        configuredVersion.headRevision ?? readVersion(["rev-parse", "HEAD"]),
        configuredVersion.baseRevision ??
            readVersion(["merge-base", "HEAD", OFFICIAL_REF]),
    ]);

    return {
        ...(headRevision === undefined ? {} : { headRevision }),
        ...(baseRevision === undefined ? {} : { baseRevision }),
    };
}

export function readTypeAgentSourceVersionFromEnvironment(): TypeAgentSourceVersion {
    const attributes = detectResources({
        detectors: [envDetector],
    }).attributes;
    const headRevision = attributes[ATTR_VCS_REF_HEAD_REVISION];
    const baseRevision = attributes[ATTR_VCS_REF_BASE_REVISION];

    return {
        ...(typeof headRevision === "string" ? { headRevision } : {}),
        ...(typeof baseRevision === "string" ? { baseRevision } : {}),
    };
}

async function readGit(args: readonly string[]): Promise<string | undefined> {
    try {
        const { stdout } = await execFileAsync("git", [...args], {
            cwd: MODULE_DIRECTORY,
            windowsHide: true,
            encoding: "utf8",
            timeout: GIT_TIMEOUT_MS,
        });
        const value = stdout.trim();
        return value.length === 0 ? undefined : value;
    } catch {
        return undefined;
    }
}

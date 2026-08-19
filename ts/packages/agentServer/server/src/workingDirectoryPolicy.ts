// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";

export type WorkingDirectoryPolicy = {
    allowedRoots: string[];
    defaultRoot?: string;
};

export type WorkingDirectoryResolution = {
    workingDirectory?: string;
    source?: "requested" | "default";
    rejectedRequested?: boolean;
};

function canonicalDirectory(value: string): string | undefined {
    try {
        const canonical = fs.realpathSync(path.resolve(value));
        return fs.statSync(canonical).isDirectory() ? canonical : undefined;
    } catch {
        return undefined;
    }
}

function isWithinRoot(candidate: string, root: string): boolean {
    const relative = path.relative(root, candidate);
    return (
        relative === "" ||
        (!relative.startsWith("..") && !path.isAbsolute(relative))
    );
}

export function loadWorkingDirectoryPolicy(
    env: NodeJS.ProcessEnv = process.env,
): WorkingDirectoryPolicy {
    const allowedRoots = (env.TYPEAGENT_CODE_ALLOWED_ROOTS ?? "")
        .split(path.delimiter)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map(canonicalDirectory)
        .filter((entry): entry is string => entry !== undefined);
    const defaultRoot = env.TYPEAGENT_CODE_DEFAULT_WORKING_DIRECTORY
        ? canonicalDirectory(env.TYPEAGENT_CODE_DEFAULT_WORKING_DIRECTORY)
        : undefined;
    return {
        allowedRoots,
        ...(defaultRoot !== undefined ? { defaultRoot } : {}),
    };
}

export function resolveWorkingDirectory(
    requested: string | undefined,
    policy: WorkingDirectoryPolicy,
): WorkingDirectoryResolution {
    const allowed = (candidate: string): boolean =>
        policy.allowedRoots.length === 0 ||
        policy.allowedRoots.some((root) => isWithinRoot(candidate, root));

    const requestedDirectory = requested
        ? canonicalDirectory(requested)
        : undefined;
    if (requestedDirectory !== undefined && allowed(requestedDirectory)) {
        return {
            workingDirectory: requestedDirectory,
            source: "requested",
        };
    }

    const defaultDirectory = policy.defaultRoot
        ? canonicalDirectory(policy.defaultRoot)
        : undefined;
    if (defaultDirectory !== undefined && allowed(defaultDirectory)) {
        return {
            workingDirectory: defaultDirectory,
            source: "default",
            ...(requested !== undefined ? { rejectedRequested: true } : {}),
        };
    }

    return requested !== undefined ? { rejectedRequested: true } : {};
}

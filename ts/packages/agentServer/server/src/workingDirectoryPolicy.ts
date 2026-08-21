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

function canonicalWorkingDirectory(value: string): string | undefined {
    try {
        const canonical = fs.realpathSync(path.resolve(value));
        const stats = fs.statSync(canonical);
        return stats.isDirectory()
            ? canonical
            : stats.isFile()
              ? path.dirname(canonical)
              : undefined;
    } catch {
        return undefined;
    }
}

export function inferWorkingDirectoryFromRequest(
    request: string,
): string | undefined {
    const quoted = request.matchAll(/["']([^"']+)["']/g);
    for (const match of quoted) {
        const candidate = canonicalWorkingDirectory(match[1]);
        if (candidate !== undefined) {
            return candidate;
        }
    }

    for (const token of request.split(/\s+/)) {
        const candidate = canonicalWorkingDirectory(
            token.replace(/^[,;()\[\]]+|[,;()\[\].]+$/g, ""),
        );
        if (candidate !== undefined) {
            return candidate;
        }
    }
    return undefined;
}

export function selectWorkingDirectoryProposal(
    requested: string | undefined,
    request: string,
    selected: string | undefined,
): string | undefined {
    return requested ?? inferWorkingDirectoryFromRequest(request) ?? selected;
}

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
    const defaultRoot = canonicalDirectory(
        env.TYPEAGENT_CODE_DEFAULT_WORKING_DIRECTORY ?? process.cwd(),
    );
    return {
        allowedRoots,
        ...(defaultRoot !== undefined ? { defaultRoot } : {}),
    };
}

export function resolveWorkingDirectory(
    requested: string | undefined,
    policy: WorkingDirectoryPolicy,
): WorkingDirectoryResolution {
    const allowedRoots = policy.allowedRoots
        .map(canonicalDirectory)
        .filter((root): root is string => root !== undefined);
    const allowed = (candidate: string): boolean =>
        policy.allowedRoots.length === 0 ||
        allowedRoots.some((root) => isWithinRoot(candidate, root));

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

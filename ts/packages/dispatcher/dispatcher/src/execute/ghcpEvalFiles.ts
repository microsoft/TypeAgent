// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import type { PermissionRequest } from "@github/copilot-sdk";

export type GhcpEvalFilePolicy = {
    version: 1;
    readFiles: string[];
    writeFiles: string[];
    readsEnabled: boolean;
    writesEnabled: boolean;
    allowInventory: boolean;
    allowListInventory?: boolean;
    allowCopy?: { source: string; destination: string };
    prerequisites: Record<string, Record<string, string>>;
};

export function readGhcpEvalFilePolicy(
    file = process.env.TYPEAGENT_GHCP_EVAL_FILE_POLICY,
): GhcpEvalFilePolicy | undefined {
    if (!file) return undefined;
    const policy = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
        policy.version !== 1 ||
        !Array.isArray(policy.readFiles) ||
        !Array.isArray(policy.writeFiles) ||
        ![...policy.readFiles, ...policy.writeFiles].every(
            (name: unknown) =>
                typeof name === "string" && /^[\w-]+\.txt$/.test(name),
        ) ||
        typeof policy.readsEnabled !== "boolean" ||
        typeof policy.writesEnabled !== "boolean" ||
        typeof policy.allowInventory !== "boolean" ||
        !policy.prerequisites ||
        typeof policy.prerequisites !== "object"
    )
        throw new Error("Invalid GHCP eval file policy");
    return policy;
}

/** Only direct, single-link fixture files; parent aliases do not widen scope. */
export function isGhcpEvalFixtureFile(
    file: string,
    root: string,
    names: readonly string[],
    allowMissing = false,
): boolean {
    const resolved = path.resolve(root, file);
    const canonicalRoot = fs.realpathSync(root);
    if (
        !names.includes(path.basename(resolved)) ||
        (path.relative(root, path.dirname(resolved)) !== "" &&
            path.relative(canonicalRoot, path.dirname(resolved)) !== "")
    )
        return false;
    if (!fs.existsSync(resolved)) {
        // A dangling symlink is not a new output file.
        return (
            allowMissing && !fs.lstatSync(resolved, { throwIfNoEntry: false })
        );
    }
    const stat = fs.lstatSync(resolved);
    return (
        stat.isFile() &&
        !stat.isSymbolicLink() &&
        stat.nlink === 1 &&
        path.relative(
            canonicalRoot,
            path.dirname(fs.realpathSync(resolved)),
        ) === ""
    );
}

export function ghcpEvalFileWriteAllowed(
    file: string,
    root: string,
    policy: GhcpEvalFilePolicy,
): boolean {
    if (
        !policy.writesEnabled ||
        !isGhcpEvalFixtureFile(file, root, policy.writeFiles, true)
    )
        return false;
    const required = policy.prerequisites[path.basename(file)] ?? {};
    return Object.entries(required).every(
        ([name, expected]) =>
            isGhcpEvalFixtureFile(path.join(root, name), root, [name]) &&
            fs.readFileSync(path.join(root, name), "utf8") === expected,
    );
}

export function ghcpEvalFileActionAllowed(
    actionName: string,
    parameters: Record<string, unknown>,
    root: string,
    policy: GhcpEvalFilePolicy,
): boolean {
    if (actionName === "copyFile") {
        const copy = policy.allowCopy;
        return Boolean(
            copy &&
                parameters.recurse !== true &&
                typeof parameters.source === "string" &&
                typeof parameters.destination === "string" &&
                path.isAbsolute(parameters.source) &&
                path.isAbsolute(parameters.destination) &&
                isGhcpEvalFixtureFile(parameters.source, root, [copy.source]) &&
                path.basename(parameters.destination) === copy.destination &&
                ghcpEvalFileWriteAllowed(parameters.destination, root, policy),
        );
    }

    if (
        typeof parameters.path !== "string" ||
        !path.isAbsolute(parameters.path)
    )
        return false;
    if (actionName === "listFiles")
        return (
            policy.allowInventory &&
            parameters.recurse !== true &&
            path.relative(
                fs.realpathSync(root),
                fs.realpathSync(parameters.path),
            ) === ""
        );
    if (actionName === "readFile")
        return (
            policy.readsEnabled &&
            isGhcpEvalFixtureFile(parameters.path, root, policy.readFiles)
        );
    return (
        actionName === "writeFile" &&
        typeof parameters.content === "string" &&
        ghcpEvalFileWriteAllowed(parameters.path, root, policy)
    );
}

export function ghcpEvalNativeFilePermission(
    request: PermissionRequest,
    root: string,
    policy: GhcpEvalFilePolicy,
): boolean | undefined {
    if (request.kind === "write")
        return (
            request.managedApprovalRequired !== true &&
            request.requestSandboxBypass !== true &&
            ghcpEvalFileWriteAllowed(request.fileName, root, policy)
        );
    if (
        !policy.readsEnabled &&
        (request.kind === "shell" || request.kind === "read")
    )
        return false;
    return undefined;
}

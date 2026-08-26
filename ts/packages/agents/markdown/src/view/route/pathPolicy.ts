// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";

interface RootPaths {
    resolvedRoot: string;
    canonicalRoot: string;
}

function isFileNotFoundError(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
    );
}

function resolveRootPaths(root: string): RootPaths {
    const resolvedRoot = path.resolve(root);
    return {
        resolvedRoot,
        canonicalRoot: fs.realpathSync(resolvedRoot),
    };
}

function resolveCandidateWithinRoot(
    root: RootPaths,
    requestedPath: string,
): string | undefined {
    const candidate = path.resolve(root.resolvedRoot, requestedPath);
    if (isPathWithinRoot(root.resolvedRoot, candidate)) {
        return path.resolve(
            root.canonicalRoot,
            path.relative(root.resolvedRoot, candidate),
        );
    }
    return isPathWithinRoot(root.canonicalRoot, candidate)
        ? candidate
        : undefined;
}

function resolveExistingFile(
    root: RootPaths,
    candidate: string,
): string | undefined {
    let canonicalCandidate: string;
    try {
        canonicalCandidate = fs.realpathSync(candidate);
    } catch (error) {
        if (isFileNotFoundError(error)) {
            return undefined;
        }
        throw error;
    }

    return isPathWithinRoot(root.canonicalRoot, canonicalCandidate) &&
        fs.statSync(canonicalCandidate).isFile()
        ? canonicalCandidate
        : undefined;
}

export function isPathWithinRoot(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return (
        relative !== ".." &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative)
    );
}

export function resolvePathWithinRoot(
    root: string,
    requestedPath: string,
): string | undefined {
    return resolveCandidateWithinRoot(resolveRootPaths(root), requestedPath);
}

export function resolveExistingFileWithinRoot(
    root: string,
    requestedPath: string,
): string | undefined {
    const rootPaths = resolveRootPaths(root);
    const candidate = resolveCandidateWithinRoot(rootPaths, requestedPath);
    if (candidate === undefined) {
        return undefined;
    }
    return resolveExistingFile(rootPaths, candidate);
}

export function resolveWritableFileWithinRoot(
    root: string,
    requestedPath: string,
): string | undefined {
    const rootPaths = resolveRootPaths(root);
    const candidate = resolveCandidateWithinRoot(rootPaths, requestedPath);
    if (candidate === undefined) {
        return undefined;
    }

    const canonicalParent = fs.realpathSync(path.dirname(candidate));
    if (!isPathWithinRoot(rootPaths.canonicalRoot, canonicalParent)) {
        return undefined;
    }

    const writablePath = path.join(canonicalParent, path.basename(candidate));
    try {
        fs.lstatSync(writablePath);
    } catch (error) {
        if (isFileNotFoundError(error)) {
            return writablePath;
        }
        throw error;
    }
    return resolveExistingFile(rootPaths, writablePath);
}

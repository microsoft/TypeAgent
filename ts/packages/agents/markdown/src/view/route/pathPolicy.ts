// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";

function isFileNotFoundError(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
    );
}

function pathEntryExists(candidate: string): boolean {
    try {
        fs.lstatSync(candidate);
        return true;
    } catch (error) {
        if (isFileNotFoundError(error)) {
            return false;
        }
        throw error;
    }
}

export function isPathWithinRoot(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return (
        relative === "" ||
        (relative !== ".." &&
            !relative.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(relative))
    );
}

export function resolvePathWithinRoot(
    root: string,
    requestedPath: string,
): string | undefined {
    const resolvedRoot = path.resolve(root);
    const canonicalRoot = fs.realpathSync(resolvedRoot);
    const resolvedPath = path.resolve(resolvedRoot, requestedPath);
    if (isPathWithinRoot(resolvedRoot, resolvedPath)) {
        return path.resolve(
            canonicalRoot,
            path.relative(resolvedRoot, resolvedPath),
        );
    }
    return isPathWithinRoot(canonicalRoot, resolvedPath)
        ? resolvedPath
        : undefined;
}

export function resolveExistingFileWithinRoot(
    root: string,
    requestedPath: string,
): string | undefined {
    const resolvedPath = resolvePathWithinRoot(root, requestedPath);
    if (resolvedPath === undefined || !pathEntryExists(resolvedPath)) {
        return undefined;
    }

    const canonicalRoot = fs.realpathSync(root);
    let canonicalPath: string;
    try {
        canonicalPath = fs.realpathSync(resolvedPath);
    } catch (error) {
        if (isFileNotFoundError(error)) {
            return undefined;
        }
        throw error;
    }
    return isPathWithinRoot(canonicalRoot, canonicalPath) &&
        fs.statSync(canonicalPath).isFile()
        ? canonicalPath
        : undefined;
}

export function resolveWritableFileWithinRoot(
    root: string,
    requestedPath: string,
): string | undefined {
    const resolvedPath = resolvePathWithinRoot(root, requestedPath);
    if (resolvedPath === undefined) {
        return undefined;
    }

    if (pathEntryExists(resolvedPath)) {
        return resolveExistingFileWithinRoot(root, resolvedPath);
    }

    const canonicalRoot = fs.realpathSync(root);
    const canonicalParent = fs.realpathSync(path.dirname(resolvedPath));
    return isPathWithinRoot(canonicalRoot, canonicalParent)
        ? path.join(canonicalParent, path.basename(resolvedPath))
        : undefined;
}

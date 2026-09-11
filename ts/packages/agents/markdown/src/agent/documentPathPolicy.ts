// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";

// Filesystem policy for durable documents, including nested document creation.
type RootPaths = {
    resolvedRoot: string;
    canonicalRoot: string;
};

function isFileNotFoundError(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "ENOENT"
    );
}

function resolveRootPaths(root: string): RootPaths {
    const resolvedRoot = path.resolve(root);
    return {
        resolvedRoot,
        canonicalRoot: fs.realpathSync(resolvedRoot),
    };
}

export function isPathWithinRoot(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return (
        relative !== ".." &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative)
    );
}

export function normalizeRelativeDocumentPath(
    name: unknown,
): string | undefined {
    if (typeof name !== "string") {
        return undefined;
    }
    const trimmed = name.trim();
    if (
        trimmed.length === 0 ||
        path.isAbsolute(trimmed) ||
        /^[a-zA-Z]:/.test(trimmed)
    ) {
        return undefined;
    }

    const normalized = trimmed.replace(/\\/g, "/");
    const segments = normalized.split("/");
    if (
        segments.some(
            (segment) => segment === "" || segment === "." || segment === "..",
        )
    ) {
        return undefined;
    }
    return segments.join("/");
}

export function resolveRealDirectory(absolutePath: string): string | undefined {
    if (!path.isAbsolute(absolutePath)) {
        return undefined;
    }
    try {
        const canonicalPath = fs.realpathSync(absolutePath);
        return fs.statSync(canonicalPath).isDirectory()
            ? canonicalPath
            : undefined;
    } catch (error) {
        if (isFileNotFoundError(error)) {
            return undefined;
        }
        throw error;
    }
}

export function resolveExistingFileWithinRoot(
    root: string,
    requestedPath: string,
): string | undefined {
    const relativePath = normalizeRelativeDocumentPath(requestedPath);
    if (relativePath === undefined) {
        return undefined;
    }
    const rootPaths = resolveRootPaths(root);
    const candidate = path.resolve(rootPaths.resolvedRoot, relativePath);
    if (!isPathWithinRoot(rootPaths.resolvedRoot, candidate)) {
        return undefined;
    }
    try {
        const canonicalFile = fs.realpathSync(candidate);
        if (
            canonicalFile !== rootPaths.canonicalRoot &&
            !canonicalFile.startsWith(rootPaths.canonicalRoot + path.sep)
        ) {
            return undefined;
        }
        return fs.statSync(canonicalFile).isFile() ? canonicalFile : undefined;
    } catch (error) {
        if (isFileNotFoundError(error)) {
            return undefined;
        }
        throw error;
    }
}

function ensureDirectoryWithinRoot(
    root: RootPaths,
    relativeDirectory: string,
): string | undefined {
    const candidate = path.resolve(root.resolvedRoot, relativeDirectory);
    if (!isPathWithinRoot(root.resolvedRoot, candidate)) {
        return undefined;
    }

    const segments = path
        .relative(root.resolvedRoot, candidate)
        .split(path.sep)
        .filter((segment) => segment.length > 0);
    let currentDirectory = root.canonicalRoot;
    for (const segment of segments) {
        const nextDirectory = path.join(currentDirectory, segment);
        let stats: fs.Stats | undefined;
        try {
            stats = fs.lstatSync(nextDirectory);
        } catch (error) {
            if (!isFileNotFoundError(error)) {
                throw error;
            }
        }

        if (stats === undefined) {
            fs.mkdirSync(nextDirectory);
        } else if (stats.isSymbolicLink() || !stats.isDirectory()) {
            return undefined;
        }

        const canonicalDirectory = fs.realpathSync(nextDirectory);
        if (
            canonicalDirectory !== root.canonicalRoot &&
            !canonicalDirectory.startsWith(root.canonicalRoot + path.sep)
        ) {
            return undefined;
        }
        currentDirectory = canonicalDirectory;
    }
    return currentDirectory;
}

export function resolveWritableFileWithinRoot(
    root: string,
    requestedPath: string,
): string | undefined {
    const relativePath = normalizeRelativeDocumentPath(requestedPath);
    if (relativePath === undefined) {
        return undefined;
    }
    const rootPaths = resolveRootPaths(root);
    const candidate = path.resolve(rootPaths.resolvedRoot, relativePath);
    if (!isPathWithinRoot(rootPaths.resolvedRoot, candidate)) {
        return undefined;
    }

    const relativeParent = path.relative(
        rootPaths.resolvedRoot,
        path.dirname(candidate),
    );
    const canonicalParent = ensureDirectoryWithinRoot(
        rootPaths,
        relativeParent,
    );
    if (canonicalParent === undefined) {
        return undefined;
    }

    const writablePath = path.join(canonicalParent, path.basename(candidate));
    try {
        const stats = fs.lstatSync(writablePath);
        if (stats.isSymbolicLink() || !stats.isFile()) {
            return undefined;
        }
        const canonicalFile = fs.realpathSync(writablePath);
        return canonicalFile === rootPaths.canonicalRoot ||
            canonicalFile.startsWith(rootPaths.canonicalRoot + path.sep)
            ? canonicalFile
            : undefined;
    } catch (error) {
        if (isFileNotFoundError(error)) {
            return writablePath;
        }
        throw error;
    }
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Path safety helpers for the markdown agent and view service. Both callers
// need the same canonical + symlink-aware rules, so they live under
// `src/agent/` and are imported directly from the view route via the
// composite project reference. Keep this module free of runtime state so it
// can be reused from either process.

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

// Ensure every directory segment between the canonical root and the requested
// relative directory exists and stays inside the canonical root. Missing
// segments are created one at a time; each existing segment is re-checked via
// realpath so a symlink that resolves outside the root aborts the walk. Returns
// the canonical absolute path of the deepest directory when the walk succeeds,
// or undefined when any segment escapes the root (or the path is otherwise
// invalid).
export function ensureDirectoryWithinRoot(
    root: string,
    relativeDir: string,
): string | undefined {
    const rootPaths = resolveRootPaths(root);
    const candidate = resolveCandidateWithinRoot(rootPaths, relativeDir);
    if (candidate === undefined) {
        return undefined;
    }
    const relative = path.relative(rootPaths.canonicalRoot, candidate);
    if (relative === "") {
        return rootPaths.canonicalRoot;
    }
    const segments = relative.split(path.sep).filter((s) => s.length > 0);
    let currentReal = rootPaths.canonicalRoot;
    for (const segment of segments) {
        if (segment === "." || segment === "..") {
            return undefined;
        }
        const next = path.join(currentReal, segment);
        let stats: fs.Stats | undefined;
        try {
            stats = fs.lstatSync(next);
        } catch (error) {
            if (!isFileNotFoundError(error)) {
                throw error;
            }
        }
        if (stats === undefined) {
            fs.mkdirSync(next);
        } else if (stats.isSymbolicLink()) {
            // Never follow a symlink when descending into the workspace tree.
            return undefined;
        } else if (!stats.isDirectory()) {
            return undefined;
        }
        const canonicalNext = fs.realpathSync(next);
        if (!isPathWithinRoot(rootPaths.canonicalRoot, canonicalNext)) {
            return undefined;
        }
        currentReal = canonicalNext;
    }
    return currentReal;
}

export function resolveWritableFileWithinRoot(
    root: string,
    requestedPath: string,
    options?: { createSubdirs?: boolean },
): string | undefined {
    const rootPaths = resolveRootPaths(root);
    const candidate = resolveCandidateWithinRoot(rootPaths, requestedPath);
    if (candidate === undefined) {
        return undefined;
    }

    let canonicalParent: string;
    if (options?.createSubdirs) {
        const parentRel = path.relative(
            rootPaths.canonicalRoot,
            path.dirname(candidate),
        );
        const parentReal = ensureDirectoryWithinRoot(
            rootPaths.canonicalRoot,
            parentRel === "" ? "." : parentRel,
        );
        if (parentReal === undefined) {
            return undefined;
        }
        canonicalParent = parentReal;
    } else {
        try {
            canonicalParent = fs.realpathSync(path.dirname(candidate));
        } catch (error) {
            if (isFileNotFoundError(error)) {
                return undefined;
            }
            throw error;
        }
        if (!isPathWithinRoot(rootPaths.canonicalRoot, canonicalParent)) {
            return undefined;
        }
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

// Resolve an absolute directory path supplied through the trusted parent IPC
// channel. Returns the canonical (realpath) of the directory when it exists
// and refers to a real directory (not a file, not a broken symlink). Callers
// still validate at their own trust boundary; this helper enforces "must be
// absolute, must be a directory".
export function resolveRealDirectory(absolutePath: string): string | undefined {
    if (typeof absolutePath !== "string" || absolutePath.length === 0) {
        return undefined;
    }
    if (!path.isAbsolute(absolutePath)) {
        return undefined;
    }
    let canonical: string;
    try {
        canonical = fs.realpathSync(absolutePath);
    } catch (error) {
        if (isFileNotFoundError(error)) {
            return undefined;
        }
        throw error;
    }
    let stats: fs.Stats;
    try {
        stats = fs.statSync(canonical);
    } catch (error) {
        if (isFileNotFoundError(error)) {
            return undefined;
        }
        throw error;
    }
    return stats.isDirectory() ? canonical : undefined;
}

export function isCanonicalDirectory(absolutePath: string): boolean {
    const canonical = resolveRealDirectory(absolutePath);
    return (
        canonical !== undefined &&
        path.relative(path.resolve(absolutePath), canonical) === ""
    );
}

// Validate a document name supplied by an action parameter or the trusted
// parent IPC channel. Rejects absolute paths, traversal segments, empty
// strings, and non-string inputs. Returns the normalized POSIX-style relative
// path on success, or undefined when the input is invalid. Callers then feed
// this string into resolveWritableFileWithinRoot so the on-disk resolution
// still enforces symlink safety.
export function normalizeRelativeDocumentPath(
    name: unknown,
): string | undefined {
    if (typeof name !== "string") {
        return undefined;
    }
    const trimmed = name.trim();
    if (trimmed.length === 0) {
        return undefined;
    }
    if (path.isAbsolute(trimmed)) {
        return undefined;
    }
    // Reject Windows drive-qualified segments like "C:foo" that
    // path.isAbsolute misses on POSIX but which point to a drive on Windows.
    if (/^[a-zA-Z]:/.test(trimmed)) {
        return undefined;
    }
    const normalized = trimmed.replace(/\\/g, "/");
    const segments = normalized.split("/");
    for (const segment of segments) {
        if (segment === "" || segment === "." || segment === "..") {
            return undefined;
        }
    }
    return segments.join("/");
}

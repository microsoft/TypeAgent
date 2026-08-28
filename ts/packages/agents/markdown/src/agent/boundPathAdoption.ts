// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Pure decision helper for adoptBoundPathFromView. Given a view-reported
// binding (boundFilePath / boundRoot / boundRelativePath), decide whether
// the agent can adopt it as its current document without widening trust.
//
// The gating rule is deliberately conservative: the reported root must
// either already be authorized in this process (via a prior create/open
// under a trusted ActionContext.workingDirectory) OR canonicalize to the
// same directory as the currently-supplied ActionContext.workingDirectory.
// A UI-synthesized ActionContext with no workingDirectory can never widen
// the trust boundary on its own, and no session/conversation storage is
// consulted.
//
// Kept as a pure function (I/O comes in via deps) so it can be unit
// tested without mocking child processes or leaning on process-global
// state.

import path from "node:path";

export type ViewBoundPathReport = {
    boundFilePath: string | null | undefined;
    boundRoot: string | null | undefined;
    boundRelativePath?: string | null | undefined;
};

export type BoundPathAdoptionDeps = {
    resolveRealDirectory(absolutePath: string): string | undefined;
    resolveExistingFileWithinRoot(
        root: string,
        requestedPath: string,
    ): string | undefined;
    isAuthorizedRoot(canonicalRoot: string): boolean;
    authorizeRoot(canonicalRoot: string): void;
};

export type BoundPathAdoption = {
    canonicalRoot: string;
    // POSIX-style relative path; nested directory segments preserved so
    // the caller can reconstruct the same user-relative name the view
    // was already using.
    relativePath: string;
    resolvedAbsolute: string;
};

export function evaluateBoundPathAdoption(
    report: ViewBoundPathReport,
    actionContextWorkingDirectory: string | undefined,
    deps: BoundPathAdoptionDeps,
): BoundPathAdoption | undefined {
    const boundFilePath = report.boundFilePath ?? undefined;
    const boundRoot = report.boundRoot ?? undefined;
    const boundRelativePath = report.boundRelativePath ?? undefined;
    if (
        !boundFilePath ||
        !boundRoot ||
        !path.isAbsolute(boundFilePath) ||
        !path.isAbsolute(boundRoot)
    ) {
        return undefined;
    }
    const canonicalRoot = deps.resolveRealDirectory(boundRoot);
    if (canonicalRoot === undefined) {
        return undefined;
    }
    // Authorize the currently-supplied ActionContext.workingDirectory when
    // it canonicalizes to the same root the view reports. Only fires when
    // the caller actually supplied a workingDirectory, so a
    // UI-synthesized ActionContext cannot promote an unapproved root.
    if (typeof actionContextWorkingDirectory === "string") {
        const acCanonical = deps.resolveRealDirectory(
            actionContextWorkingDirectory,
        );
        if (acCanonical === canonicalRoot) {
            deps.authorizeRoot(canonicalRoot);
        }
    }
    if (!deps.isAuthorizedRoot(canonicalRoot)) {
        return undefined;
    }
    // Prefer the full user-relative path the view sent (which preserves
    // nested directories). Fall back to computing it from the absolute
    // bound path only if the view did not supply one.
    const relativeCandidate =
        boundRelativePath ?? path.relative(canonicalRoot, boundFilePath);
    const relativePath = relativeCandidate.split(path.sep).join("/");
    if (
        relativePath === "" ||
        relativePath.startsWith("..") ||
        path.isAbsolute(relativePath)
    ) {
        return undefined;
    }
    const resolvedAbsolute = deps.resolveExistingFileWithinRoot(
        canonicalRoot,
        relativePath,
    );
    if (resolvedAbsolute === undefined) {
        return undefined;
    }
    return { canonicalRoot, relativePath, resolvedAbsolute };
}

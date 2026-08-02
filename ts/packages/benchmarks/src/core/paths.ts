// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import { fileURLToPath } from "node:url";

// Same pattern as cache/defaultAgentProvider: this file emits to dist/core/,
// so ../.. is the package root.
const packageRoot = path.join("..", "..");

/** Resolve a path relative to the package root (works from compiled dist/). */
export function getPackageFilePath(packageRootRelativePath: string): string {
    if (path.isAbsolute(packageRootRelativePath)) {
        return packageRootRelativePath;
    }
    return fileURLToPath(
        new URL(
            path.join(packageRoot, packageRootRelativePath),
            import.meta.url,
        ),
    );
}

export const packageRootAbs = getPackageFilePath(".");

/** datasets: <package>/data/translationBench/ */
export function dataDir(): string {
    return getPackageFilePath(path.join("data", "translationBench"));
}

/** run output: <package>/results/translationBench/ */
export function resultsDir(): string {
    return getPackageFilePath(path.join("results", "translationBench"));
}

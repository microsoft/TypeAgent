// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * This module lives at src/core/ or dist/src/core/.
 * Package root is two or three levels up; pick the one that owns our package.json.
 */
function resolvePackageRoot(): string {
    for (const rel of ["../../..", "../.."] as const) {
        const dir = path.resolve(here, rel);
        try {
            const pkg = require(path.join(dir, "package.json")) as {
                name?: string;
            };
            if (pkg.name === "@typeagent/benchmarks") {
                return dir;
            }
        } catch {
            // candidate missing or unreadable
        }
    }
    throw new Error(
        `Cannot resolve @typeagent/benchmarks package root from ${here}`,
    );
}

export const packageRoot = resolvePackageRoot();

/** datasets: <package>/data/translationBench/ */
export function dataDir(): string {
    return path.join(packageRoot, "data", "translationBench");
}

/** run output: <package>/results/translationBench/ */
export function resultsDir(): string {
    return path.join(packageRoot, "results", "translationBench");
}

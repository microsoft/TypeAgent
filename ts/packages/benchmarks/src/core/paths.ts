// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Absolute path to this package root (directory that owns package.json).
 * Resolved by walking up from this module so it works from both src/ and dist/.
 */
export const packageRoot: string = (() => {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (;;) {
        if (existsSync(path.join(dir, "package.json"))) {
            return dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            throw new Error(
                `Cannot locate package root (no package.json above ${fileURLToPath(import.meta.url)})`,
            );
        }
        dir = parent;
    }
})();

/** Join segments under the benchmarks package root. */
export function fromPackageRoot(...segments: string[]): string {
    return path.join(packageRoot, ...segments);
}

export type BenchName = "translationBench";

export function dataDir(bench: BenchName = "translationBench"): string {
    return fromPackageRoot("data", bench);
}

export function resultsDir(bench: BenchName = "translationBench"): string {
    const override = process.env.BENCH_RESULTS_DIR;
    if (override !== undefined && override !== "") {
        return override;
    }
    return fromPackageRoot("results", bench);
}

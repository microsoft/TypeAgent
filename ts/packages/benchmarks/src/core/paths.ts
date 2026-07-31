// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_NAME = "@typeagent/benchmarks";

/**
 * Package root = directory whose package.json name is @typeagent/benchmarks.
 * Walk up from this file so the same code works from src/ and dist/.
 * No env overrides — data and results always live under this package.
 */
export const packageRoot: string = (() => {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (;;) {
        const pkgPath = path.join(dir, "package.json");
        if (existsSync(pkgPath)) {
            let name: string | undefined;
            try {
                name = (JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string })
                    .name;
            } catch {
                name = undefined;
            }
            if (name === PACKAGE_NAME) {
                return dir;
            }
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            throw new Error(
                `Cannot find ${PACKAGE_NAME} package root above ${fileURLToPath(import.meta.url)}`,
            );
        }
        dir = parent;
    }
})();

/** datasets: <package>/data/translationBench/ */
export function dataDir(): string {
    return path.join(packageRoot, "data", "translationBench");
}

/** run output: <package>/results/translationBench/ */
export function resultsDir(): string {
    return path.join(packageRoot, "results", "translationBench");
}

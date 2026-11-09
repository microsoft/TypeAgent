// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function findBrowserPackageRoot(): string {
    let current = path.dirname(fileURLToPath(import.meta.url));
    while (true) {
        const packageJson = path.join(current, "package.json");
        if (fs.existsSync(packageJson)) {
            const pkg = JSON.parse(fs.readFileSync(packageJson, "utf8"));
            if (pkg.name === "@typeagent/browser") {
                return current;
            }
        }
        const parent = path.dirname(current);
        if (parent === current) {
            throw new Error("Unable to locate the @typeagent/browser package.");
        }
        current = parent;
    }
}

const browserPackageRoot = findBrowserPackageRoot();

export function getBrowserPackageFilePath(relativePath: string): string {
    return path.join(browserPackageRoot, relativePath);
}

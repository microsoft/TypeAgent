// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import { fileURLToPath } from "node:url";
const packageRoot = path.join("..", "..");
export function getPackageFilePath(packageRootRelativePath: string) {
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

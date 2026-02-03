// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import { fileURLToPath } from "node:url";

export function getPackageFilePath(packageRootRelativePath: string) {
    if (path.isAbsolute(packageRootRelativePath)) {
        return packageRootRelativePath;
    }

    // From dispatcher/dispatcher/dist/utils/ (where this compiled file lives):
    // - For agent paths (agents/*): go up 4 levels to reach packages/
    //   dispatcher/dispatcher/dist/utils/ -> ../../../../ -> packages/
    // - For internal paths (./src/*): go up 2 levels to reach dispatcher/dispatcher/
    //   dispatcher/dispatcher/dist/utils/ -> ../../ -> dispatcher/dispatcher/
    const isAgentPath = packageRootRelativePath.startsWith("agents/");
    const baseDir = isAgentPath
        ? path.join("..", "..", "..", "..") // packages/ root
        : path.join("..", ".."); // dispatcher/dispatcher/ root

    return fileURLToPath(
        new URL(path.join(baseDir, packageRootRelativePath), import.meta.url),
    );
}

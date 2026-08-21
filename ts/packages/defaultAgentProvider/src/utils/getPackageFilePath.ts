// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import { fileURLToPath } from "node:url";
const packageRoot = path.join("..", "..");
export function getPackageFilePath(packageRootRelativePath: string) {
    if (path.isAbsolute(packageRootRelativePath)) {
        return packageRootRelativePath;
    }

    const runtimeRoot = process.env.TYPEAGENT_RUNTIME_ROOT;
    if (runtimeRoot) {
        if (
            packageRootRelativePath === "node_modules" ||
            packageRootRelativePath.startsWith("node_modules/") ||
            packageRootRelativePath.startsWith("node_modules\\") ||
            packageRootRelativePath.startsWith("./node_modules/") ||
            packageRootRelativePath.startsWith(".\\node_modules\\")
        ) {
            return path.resolve(
                runtimeRoot,
                packageRootRelativePath.replace(/^\.?[\\/]/, ""),
            );
        }
        return path.resolve(
            runtimeRoot,
            "default-agent-provider",
            packageRootRelativePath,
        );
    }

    return fileURLToPath(
        new URL(
            path.join(packageRoot, packageRootRelativePath),
            import.meta.url,
        ),
    );
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

export interface RipgrepRuntime {
    path: string;
    sha256: string;
}

export async function resolvePackagedRipgrep(): Promise<RipgrepRuntime> {
    const resolvedPath = await realpath(await resolvePackagedRipgrepPath());
    return {
        path: resolvedPath,
        sha256: createHash("sha256")
            .update(await readFile(resolvedPath))
            .digest("hex"),
    };
}

export async function resolvePackagedRipgrepPath(): Promise<string> {
    const localRequire = createRequire(import.meta.url);
    const copilotManifest = localRequire.resolve(
        "@github/copilot/package.json",
    );
    const copilotRequire = createRequire(copilotManifest);
    const platformTags = resolvePlatformTags(copilotRequire);

    for (const platformTag of platformTags) {
        const packageName = `@github/copilot-${platformTag}-${process.arch}`;
        let packageBinary: string;
        try {
            packageBinary = copilotRequire.resolve(packageName);
        } catch {
            continue;
        }

        const packageRoot = path.dirname(packageBinary);
        const binaryName = process.platform === "win32" ? "rg.exe" : "rg";
        for (const binaryPlatform of new Set([platformTag, process.platform])) {
            const candidate = path.join(
                packageRoot,
                "ripgrep",
                "bin",
                `${binaryPlatform}-${process.arch}`,
                binaryName,
            );
            try {
                if ((await stat(candidate)).isFile()) {
                    return candidate;
                }
            } catch {
                // Try the other packaged platform layout.
            }
        }
    }

    throw new Error(
        `Bundled ripgrep not found in @github/copilot-${process.platform}-${process.arch}`,
    );
}

function resolvePlatformTags(copilotRequire: NodeRequire): string[] {
    if (process.platform !== "linux") return [process.platform];
    try {
        const detectLibc = copilotRequire("detect-libc") as {
            isNonGlibcLinuxSync(): boolean;
        };
        return detectLibc.isNonGlibcLinuxSync()
            ? ["linuxmusl", "linux"]
            : ["linux", "linuxmusl"];
    } catch {
        return ["linux", "linuxmusl"];
    }
}

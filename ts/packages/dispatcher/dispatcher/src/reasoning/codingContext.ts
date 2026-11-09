// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import type { UserContext } from "@typeagent/dispatcher-types";

function isWithinRoot(candidate: string, root: string): boolean {
    const relative = path.relative(root, candidate);
    return (
        relative === "" ||
        (!relative.startsWith("..") && !path.isAbsolute(relative))
    );
}

export function getCodingAttachmentPaths(
    workingDirectory: string,
    attachments: string[] | undefined,
    userContext: UserContext | undefined,
): string[] | undefined {
    const paths = new Set(attachments ?? []);
    const activeFilePath = userContext?.editor?.activeFilePath;
    if (activeFilePath !== undefined) {
        try {
            const root = fs.realpathSync(workingDirectory);
            const candidate = fs.realpathSync(
                path.isAbsolute(activeFilePath)
                    ? activeFilePath
                    : path.resolve(root, activeFilePath),
            );
            if (
                isWithinRoot(candidate, root) &&
                fs.statSync(candidate).isFile()
            ) {
                paths.add(candidate);
            }
        } catch {
            // The active editor may refer to an unsaved or client-local file.
        }
    }
    return paths.size > 0 ? [...paths] : undefined;
}

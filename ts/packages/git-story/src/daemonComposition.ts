// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
    ApprovedUpdateDestination,
    SessionPrivacyFilter,
} from "./sessionWatcher.js";

// Trusted local code, selected only by the daemon's startup environment.
// There is deliberately no built-in privacy policy or destination.
export type DaemonSessionDependencies = {
    privacyFilter: SessionPrivacyFilter;
    approvedUpdateDestination: ApprovedUpdateDestination;
};

export async function loadDaemonDependencies(
    file: string | undefined,
): Promise<DaemonSessionDependencies | undefined> {
    if (file === undefined) return undefined;
    try {
        if (!path.isAbsolute(file) || !(await fs.stat(file)).isFile())
            throw new Error();
        const adapter = await import(pathToFileURL(file).href);
        const dependencies: unknown =
            await adapter.createSessionWatcherDependencies();
        if (
            !dependencies ||
            typeof dependencies !== "object" ||
            !("privacyFilter" in dependencies) ||
            typeof dependencies.privacyFilter !== "function" ||
            !("approvedUpdateDestination" in dependencies) ||
            typeof dependencies.approvedUpdateDestination !== "function"
        )
            throw new Error();
        const validated = dependencies as DaemonSessionDependencies;
        return {
            privacyFilter: validated.privacyFilter,
            approvedUpdateDestination: validated.approvedUpdateDestination,
        };
    } catch {
        throw new Error("Cannot load configured Session Watcher adapter");
    }
}

export function copilotHome(): string {
    const home = process.env.GIT_STORY_COPILOT_HOME ?? os.homedir();
    if (!path.isAbsolute(home))
        throw new Error("GIT_STORY_COPILOT_HOME must be absolute");
    return path.normalize(home);
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { getConfigDir } from "./plugin-config.js";

export function localRecipeScope(cwd: string) {
    const profileId =
        process.env.TYPEAGENT_RECIPE_PROFILE_ID ?? "local-default";
    if (!profileId.trim() || profileId.length > 256)
        throw new Error("A bounded local recipe profile ID is required.");
    const workspace = resolve(cwd);
    return {
        workspaceId:
            process.platform === "win32" ? workspace.toLowerCase() : workspace,
        profileId,
    };
}

export function localRecipeDirectory(cwd: string): string {
    const digest = createHash("sha256")
        .update(JSON.stringify(localRecipeScope(cwd)))
        .digest("hex");
    return join(resolve(getConfigDir()), "recipes", digest);
}

export function localRecipeEndpoint(cwd: string, sessionId: string): string {
    if (!sessionId.trim() || sessionId.length > 4096)
        throw new Error(
            "The native Copilot session ID is required for local recipes.",
        );
    const digest = createHash("sha256").update(sessionId).digest("hex");
    return join(localRecipeDirectory(cwd), `session-${digest}.json`);
}

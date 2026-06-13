// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAgent,
    TypeAgentAction,
    ActionResult,
} from "@typeagent/agent-sdk";
import {
    createActionResultFromMarkdownDisplay,
    createActionResultFromError,
} from "@typeagent/agent-sdk/helpers/action";
import { StudioActions } from "./studioSchema.js";
import { StudioServiceProxyClient } from "studio-service";
import {
    initializeStudioContext,
    updateStudioContext,
    closeStudioContext,
    lookupStudioServiceEntry,
} from "./lib/studioServiceLifecycle.js";
import {
    formatStudioInfo,
    formatCollisions,
    formatEvents,
} from "./lib/inspect.js";

export function instantiate(): AppAgent {
    return {
        initializeAgentContext: initializeStudioContext,
        updateAgentContext: updateStudioContext,
        closeAgentContext: closeStudioContext,
        executeAction,
    };
}

/** Shown when no standalone Studio service has announced itself for the workspace. */
const NOT_RUNNING = [
    "## TypeAgent Studio — service not running",
    "",
    "No Studio service is connected for this workspace. Open the repository in",
    "VS Code with the **TypeAgent Studio** extension (it launches the service",
    "automatically), or run `typeagent-studio serve --workspace <repoRoot>`.",
].join("\n");

/**
 * Forward a read-only action to the standalone Studio service for `repoRoot`,
 * discovered via the in-process registry. The agent no longer hosts the runtime
 * — it proxies — so an absent service is reported honestly rather than guessed.
 */
async function withService<T>(
    repoRoot: string | undefined,
    fn: (client: StudioServiceProxyClient) => Promise<T>,
): Promise<T | undefined> {
    const entry = lookupStudioServiceEntry(repoRoot);
    if (entry === undefined) {
        return undefined;
    }
    const client = await StudioServiceProxyClient.connect({
        port: entry.port,
        token: entry.token,
        ...(repoRoot !== undefined ? { repoRoot } : {}),
    });
    if (client === undefined) {
        return undefined;
    }
    try {
        return await fn(client);
    } finally {
        client.close();
    }
}

async function executeAction(
    action: TypeAgentAction<StudioActions>,
    _context: ActionContext<unknown>,
): Promise<ActionResult> {
    switch (action.actionName) {
        case "getStudioInfo": {
            const info = await withService(action.parameters?.repoRoot, (c) =>
                c.getStudioInfo(),
            );
            return info === undefined
                ? createActionResultFromMarkdownDisplay(NOT_RUNNING)
                : createActionResultFromMarkdownDisplay(
                      formatStudioInfo(info.repoRootInfo, info.agentLocations),
                  );
        }
        case "listCollisions": {
            const collisions = await withService(
                action.parameters?.repoRoot,
                (c) => c.listCollisions(),
            );
            return collisions === undefined
                ? createActionResultFromMarkdownDisplay(NOT_RUNNING)
                : createActionResultFromMarkdownDisplay(
                      formatCollisions(collisions),
                  );
        }
        case "queryEvents": {
            const { limit, repoRoot } = action.parameters;
            const events = await withService(repoRoot, (c) =>
                c.queryRecentEvents(limit ?? 20),
            );
            return events === undefined
                ? createActionResultFromMarkdownDisplay(NOT_RUNNING)
                : createActionResultFromMarkdownDisplay(formatEvents(events));
        }
        default:
            return createActionResultFromError(
                `Unknown studio action: ${(action as TypeAgentAction<StudioActions>).actionName}`,
            );
    }
}

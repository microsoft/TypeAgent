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
import { getStudioRuntime } from "./lib/runtime.js";
import {
    initializeStudioContext,
    updateStudioContext,
    closeStudioContext,
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

async function executeAction(
    action: TypeAgentAction<StudioActions>,
    _context: ActionContext<unknown>,
): Promise<ActionResult> {
    switch (action.actionName) {
        case "getStudioInfo": {
            const runtime = getStudioRuntime(action.parameters?.repoRoot);
            const info = runtime.getRepoRootInfo();
            const locations = await runtime.getAgentLocations();
            return createActionResultFromMarkdownDisplay(
                formatStudioInfo(info, locations),
            );
        }
        case "listCollisions": {
            const runtime = getStudioRuntime(action.parameters?.repoRoot);
            const collisions = await runtime.listCollisions();
            return createActionResultFromMarkdownDisplay(
                formatCollisions(collisions),
            );
        }
        case "queryEvents": {
            const { limit, repoRoot } = action.parameters;
            const events = await getStudioRuntime(repoRoot).queryRecentEvents(
                limit ?? 20,
            );
            return createActionResultFromMarkdownDisplay(formatEvents(events));
        }
        default:
            return createActionResultFromError(
                `Unknown studio action: ${(action as TypeAgentAction<StudioActions>).actionName}`,
            );
    }
}

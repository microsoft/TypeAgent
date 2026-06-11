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
    formatAgentList,
    formatStudioInfo,
    formatCollisions,
} from "./lib/inspect.js";

export function instantiate(): AppAgent {
    return {
        executeAction,
    };
}

async function executeAction(
    action: TypeAgentAction<StudioActions>,
    _context: ActionContext<unknown>,
): Promise<ActionResult> {
    switch (action.actionName) {
        case "listAgents": {
            const runtime = getStudioRuntime(action.parameters?.repoRoot);
            const agents = await runtime.listAvailableAgents();
            return createActionResultFromMarkdownDisplay(
                formatAgentList(agents),
            );
        }
        case "getStudioInfo": {
            const runtime = getStudioRuntime(action.parameters?.repoRoot);
            const info = runtime.getRepoRootInfo();
            const agents = await runtime.listAvailableAgents();
            return createActionResultFromMarkdownDisplay(
                formatStudioInfo(info, agents.length),
            );
        }
        case "listCollisions": {
            const runtime = getStudioRuntime(action.parameters?.repoRoot);
            const collisions = await runtime.listCollisions();
            return createActionResultFromMarkdownDisplay(
                formatCollisions(collisions),
            );
        }
        default:
            return createActionResultFromError(
                `Unknown studio action: ${(action as TypeAgentAction<StudioActions>).actionName}`,
            );
    }
}

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
    formatAgentDescription,
    formatAgentSources,
    formatCorpusSearch,
    formatEvents,
    collisionsForAgent,
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
        case "describeAgent": {
            const { agent, repoRoot } = action.parameters;
            const runtime = getStudioRuntime(repoRoot);
            const [available, health, corpus, allCollisions, feedback] =
                await Promise.all([
                    runtime.listAvailableAgents(),
                    runtime.checkAgentHealth(agent),
                    runtime.listCorpusEntries(agent),
                    runtime.listCollisions(),
                    runtime.listFeedback(),
                ]);
            const emoji = available.find((a) => a.name === agent)?.emoji;
            return createActionResultFromMarkdownDisplay(
                formatAgentDescription(agent, {
                    ...(emoji !== undefined ? { emoji } : {}),
                    health,
                    corpusCount: corpus.length,
                    collisions: collisionsForAgent(allCollisions, agent),
                    feedback: feedback.filter((f) => f.agent === agent),
                }),
            );
        }
        case "getSchema": {
            const { agent, repoRoot } = action.parameters;
            const sources =
                await getStudioRuntime(repoRoot).getAgentSources(agent);
            return createActionResultFromMarkdownDisplay(
                formatAgentSources(agent, "schema", sources),
            );
        }
        case "getGrammar": {
            const { agent, repoRoot } = action.parameters;
            const sources =
                await getStudioRuntime(repoRoot).getAgentSources(agent);
            return createActionResultFromMarkdownDisplay(
                formatAgentSources(agent, "grammar", sources),
            );
        }
        case "searchCorpus": {
            const { agent, query, repoRoot } = action.parameters;
            const entries =
                await getStudioRuntime(repoRoot).listCorpusEntries(agent);
            return createActionResultFromMarkdownDisplay(
                formatCorpusSearch(agent, entries, query),
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

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Pattern: external-api — REST/OAuth cloud API bridge.
// Implement TeamsClient with your API's authentication and endpoints.

import {
    ActionContext,
    AppAgent,
    TypeAgentAction,
    ActionResult,
} from "@typeagent/agent-sdk";
import { createActionResultFromTextDisplay } from "@typeagent/agent-sdk/helpers/action";
import { TeamsActions } from "./teamsSchema.js";

// ---- API client --------------------------------------------------------

class TeamsClient {
    private token: string | undefined;

    /** Authenticate and store the access token. */
    async authenticate(): Promise<void> {
        // TODO: implement OAuth flow or API key loading.
        // Store token in: ~/.typeagent/profiles/<profile>/teams/token.json
        throw new Error("authenticate() not yet implemented");
    }

    async callApi(endpoint: string, params: Record<string, unknown>): Promise<unknown> {
        if (!this.token) await this.authenticate();
        // TODO: implement HTTP call using this.token
        throw new Error(`callApi(${endpoint}) not yet implemented`);
    }
}

// ---- Agent lifecycle ---------------------------------------------------

type Context = { client: TeamsClient };

export function instantiate(): AppAgent {
    return {
        initializeAgentContext,
        updateAgentContext,
        executeAction,
    };
}

async function initializeAgentContext(): Promise<Context> {
    return { client: new TeamsClient() };
}

async function updateAgentContext(
    enable: boolean,
    _context: ActionContext<Context>,
): Promise<void> {
    // Optionally authenticate eagerly when the agent is enabled.
}

async function executeAction(
    action: TypeAgentAction<TeamsActions>,
    context: ActionContext<Context>,
): Promise<ActionResult> {
    const { client } = context.agentContext;
    // TODO: map each action to a client.callApi() call.
    return createActionResultFromTextDisplay(
        `Executing ${action.actionName} — not yet implemented.`,
    );
}

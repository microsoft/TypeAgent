// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Pattern: external-api — REST/OAuth cloud API bridge.
// Implement __AgentName__Client with your API's authentication and endpoints.

import {
    ActionContext,
    AppAgent,
    SessionContext,
    TypeAgentAction,
    ActionResult,
} from "@typeagent/agent-sdk";
import { createActionResultFromTextDisplay } from "@typeagent/agent-sdk/helpers/action";
import { __AgentName__Actions } from "./__agentName__Schema.js";

// ---- API client --------------------------------------------------------

class __AgentName__Client {
    private token: string | undefined;

    /** Authenticate and store the access token. */
    async authenticate(): Promise<void> {
        // TODO: implement OAuth flow or API key loading.
        // Store token in: ~/.typeagent/profiles/<profile>/__agentName__/token.json
        throw new Error("authenticate() not yet implemented");
    }

    async callApi(
        endpoint: string,
        params: Record<string, unknown>,
    ): Promise<unknown> {
        if (!this.token) await this.authenticate();
        // TODO: implement HTTP call using this.token
        throw new Error(`callApi(${endpoint}) not yet implemented`);
    }
}

// ---- Agent lifecycle ---------------------------------------------------

type Context = { client: __AgentName__Client };

export function instantiate(): AppAgent {
    return {
        initializeAgentContext,
        updateAgentContext,
        executeAction,
    };
}

async function initializeAgentContext(): Promise<Context> {
    return { client: new __AgentName__Client() };
}

async function updateAgentContext(
    _enable: boolean,
    _context: SessionContext<Context>,
    _schemaName: string,
): Promise<void> {
    // Optionally authenticate eagerly when the agent is enabled.
}

async function executeAction(
    action: TypeAgentAction<__AgentName__Actions>,
    context: ActionContext<Context>,
): Promise<ActionResult> {
    const { client } = context.sessionContext.agentContext;
    // TODO: map each action to a client.callApi() call.
    return createActionResultFromTextDisplay(
        `Executing ${action.actionName} — not yet implemented.`,
    );
}

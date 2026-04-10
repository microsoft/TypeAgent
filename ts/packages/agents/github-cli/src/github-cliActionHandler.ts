// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAgent,
    TypeAgentAction,
    ActionResult,
} from "@typeagent/agent-sdk";
import { createActionResultFromTextDisplay } from "@typeagent/agent-sdk/helpers/action";
import { GithubCliActions } from "./github-cliSchema.js";

export function instantiate(): AppAgent {
    return {
        initializeAgentContext,
        executeAction,
    };
}

async function initializeAgentContext(): Promise<unknown> {
    return {};
}

async function executeAction(
    action: TypeAgentAction<GithubCliActions>,
    context: ActionContext<unknown>,
): Promise<ActionResult> {
    // TODO: implement action handlers
    return createActionResultFromTextDisplay(
        `Executing ${action.actionName} — not yet implemented.`,
    );
}

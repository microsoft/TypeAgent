// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Pattern: llm-streaming — LLM-injected agent with streaming responses.
// Runs inside the dispatcher process (injected: true in manifest).
// Uses aiclient + typechat; streams partial results via streamingActionContext.

import {
    ActionContext,
    AppAgent,
    TypeAgentAction,
    ActionResult,
} from "@typeagent/agent-sdk";
import { createActionResultFromMarkdownDisplay } from "@typeagent/agent-sdk/helpers/action";
import { __AgentName__Actions } from "./__agentName__Schema.js";

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
    action: TypeAgentAction<__AgentName__Actions>,
    context: ActionContext<unknown>,
): Promise<ActionResult> {
    switch (action.actionName) {
        case "generateResponse": {
            // TODO: call your LLM and stream chunks via:
            //   context.streamingActionContext?.appendDisplay(chunk)
            return createActionResultFromMarkdownDisplay(
                "Streaming response not yet implemented.",
            );
        }
        default:
            return createActionResultFromMarkdownDisplay(
                `Unknown action: ${(action as any).actionName}`,
            );
    }
}

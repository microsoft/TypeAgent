// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAction,
    AppAgent,
    SessionContext,
    ActionResult,
} from "@typeagent/agent-sdk";
import {
    createActionResultFromTextDisplay,
    createActionResultFromError,
} from "@typeagent/agent-sdk/helpers/action";

import { EchoAction } from "./echoActionsSchema.js";

export function instantiate(): AppAgent {
    return {
        initializeAgentContext: initializeEchoContext,
        updateAgentContext: updateEchoContext,
        executeAction: executeEchoAction,
    };
}

type EchoActionContext = {
    echoCount: number;
    echoRequests: Set<string> | undefined;
};

async function initializeEchoContext() {
    return {
        echoCount: 0,
        echoRequests: undefined,
    };
}

async function updateEchoContext(
    enable: boolean,
    context: SessionContext<EchoActionContext>,
): Promise<void> {
    if (enable) {
        context.agentContext.echoRequests = new Set<string>();
        context.agentContext.echoCount = 0;
    }
    context.agentContext.echoCount++;
}

async function executeEchoAction(
    action: AppAction,
    context: ActionContext<EchoActionContext>,
) {
    let result = await handleEchoAction(
        action as EchoAction,
        context.sessionContext.agentContext,
    );
    return result;
}

async function handleEchoAction(
    action: EchoAction,
    echoContext: EchoActionContext,
) {
    let result: ActionResult | undefined = undefined;
    let displayText: string | undefined = undefined;
    switch (action.actionName) {
        case "echoGen":
            displayText = `>> Echo: ${action.parameters.text}`;
            result = createActionResultFromTextDisplay(
                displayText,
                displayText,
            );
            break;
        default:
            result = createActionResultFromError(
                "Unable to process the action",
            );
            break;
    }
    return result;
}

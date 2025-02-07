// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, AppAgent, TypeAgentAction } from "@typeagent/agent-sdk";
import {
    createActionResultFromTextDisplay,
    createActionResultFromError,
} from "@typeagent/agent-sdk/helpers/action";
import { EchoAction } from "./echoActionSchema.js";

export function instantiate(): AppAgent {
    return {
        initializeAgentContext: initializeEchoContext,
        executeAction: executeEchoAction,
    };
}

type EchoActionContext = {
    echoCount: number;
};

async function initializeEchoContext(): Promise<EchoActionContext> {
    return { echoCount: 0 };
}

async function executeEchoAction(
    action: TypeAgentAction<EchoAction>,
    context: ActionContext<EchoActionContext>,
) {
    // The context created in initializeEchoContext is returned in the action context.
    const echoContext = context.sessionContext.agentContext;
    switch (action.actionName) {
        case "echoGen":
            const displayText = `>> Echo ${++echoContext.echoCount}: ${
                action.parameters.text
            }`;
            return createActionResultFromTextDisplay(displayText, displayText);

        default:
            return createActionResultFromError("Unable to process the action");
    }
}

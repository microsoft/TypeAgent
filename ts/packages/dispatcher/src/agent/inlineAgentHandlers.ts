// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DispatcherAgentContext,
    DispatcherAgent,
    DispatcherAction,
    ActionContext,
} from "@typeagent/agent-sdk";

import { executeCorrectionAction } from "../action/correctionActionHandler.js";
import { executeSessionAction } from "../action/system/sessionActionHandler.js";
import { executeConfigAction } from "../action/system/configActionHandler.js";

export function loadInlineAgent(name: string): DispatcherAgent {
    return inlineHandlers[name] ?? {};
}

const inlineHandlers: { [key: string]: DispatcherAgent } = {
    correction: {
        executeAction: executeCorrectionAction,
    },
    system: {
        executeAction: executeSystemAction,
    },
};

function executeSystemAction(action: DispatcherAction, context: ActionContext) {
    switch (action.translatorName) {
        case "system.session":
            return executeSessionAction(action, context);
        case "system.config":
            return executeConfigAction(action, context);
    }

    throw new Error(`Invalid system sub-translator: ${action.translatorName}`);
}

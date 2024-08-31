// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgent, AppAction, ActionContext } from "@typeagent/agent-sdk";
import { executeSessionAction } from "../action/system/sessionActionHandler.js";
import { executeConfigAction } from "../action/system/configActionHandler.js";

export function loadInlineAgent(name: string): AppAgent {
    return inlineHandlers[name] ?? {};
}

const inlineHandlers: { [key: string]: AppAgent } = {
    system: {
        executeAction: executeSystemAction,
    },
};

function executeSystemAction(action: AppAction, context: ActionContext) {
    switch (action.translatorName) {
        case "system.session":
            return executeSessionAction(action, context);
        case "system.config":
            return executeConfigAction(action, context);
    }

    throw new Error(`Invalid system sub-translator: ${action.translatorName}`);
}

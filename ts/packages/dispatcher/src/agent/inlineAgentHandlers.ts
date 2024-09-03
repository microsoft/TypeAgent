// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgent, AppAction, ActionContext } from "@typeagent/agent-sdk";
import { executeSessionAction } from "../action/system/sessionActionHandler.js";
import { executeConfigAction } from "../action/system/configActionHandler.js";
import { CommandHandlerContext } from "../handlers/common/commandHandlerContext.js";
import { getDispatcherConfig } from "../utils/config.js";

export function loadInlineAgents(context: CommandHandlerContext) {
    const configs = getDispatcherConfig().agents;
    const inlineAgents: [string, AppAgent][] = [];

    for (const [name, config] of Object.entries(configs)) {
        if (config.type !== "module") {
            inlineAgents.push([name, loadInlineAgent(name, context)]);
        }
    }
    return inlineAgents;
}

function loadInlineAgent(
    name: string,
    context: CommandHandlerContext,
): AppAgent {
    const handlers = inlineHandlers[name];
    if (handlers === undefined) {
        throw new Error(`Invalid inline agent name: ${name}`);
    }
    return { ...handlers, initializeAgentContext: async () => context };
}

const inlineHandlers: { [key: string]: AppAgent } = {
    system: {
        executeAction: executeSystemAction,
    },
};

function executeSystemAction(
    action: AppAction,
    context: ActionContext<CommandHandlerContext>,
) {
    switch (action.translatorName) {
        case "system.session":
            return executeSessionAction(action, context);
        case "system.config":
            return executeConfigAction(action, context);
    }

    throw new Error(`Invalid system sub-translator: ${action.translatorName}`);
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CommandHandlerTable,
    getCommandInterface,
} from "@typeagent/agent-sdk/helpers/command";
import { RequestCommandHandler } from "../handlers/requestCommandHandler.js";
import { TranslateCommandHandler } from "../handlers/translateCommandHandler.js";
import { ExplainCommandHandler } from "../handlers/explainCommandHandler.js";
import { CorrectCommandHandler } from "../handlers/correctCommandHandler.js";
import { ActionContext, AppAgent } from "@typeagent/agent-sdk";
import { CommandHandlerContext } from "../internal.js";
import { createActionResultNoDisplay } from "@typeagent/agent-sdk/helpers/action";
import {
    ClarifyRequestAction,
    DispatcherActions,
} from "./dispatcherActionSchema.js";

const dispatcherHandlers: CommandHandlerTable = {
    description: "Type Agent Dispatcher Commands",
    commands: {
        request: new RequestCommandHandler(),
        translate: new TranslateCommandHandler(),
        explain: new ExplainCommandHandler(),
        correct: new CorrectCommandHandler(),
    },
};

async function executeDispatcherAction(
    action: DispatcherActions,
    context: ActionContext<CommandHandlerContext>,
) {
    if (action.actionName === "clarifyRequest") {
        return clarifyRequestAction(action, context);
    }

    throw new Error(`Unknown dispatcher action: ${action.actionName}`);
}

function clarifyRequestAction(
    action: ClarifyRequestAction,
    context: ActionContext<CommandHandlerContext>,
) {
    const { clarifyingQuestion } = action.parameters;
    context.actionIO.appendDisplay({
        type: "text",
        speak: true,
        content: clarifyingQuestion,
    });

    context.actionIO.appendDisplay(`\n${JSON.stringify(action, undefined, 2)}`);

    return createActionResultNoDisplay(clarifyingQuestion);
}

export const dispatcherAgent: AppAgent = {
    executeAction: executeDispatcherAction,
    ...getCommandInterface(dispatcherHandlers),
};

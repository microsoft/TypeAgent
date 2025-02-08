// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CommandHandlerTable,
    getCommandInterface,
} from "@typeagent/agent-sdk/helpers/command";
import { RequestCommandHandler } from "./handlers/requestCommandHandler.js";
import { TranslateCommandHandler } from "./handlers/translateCommandHandler.js";
import { ExplainCommandHandler } from "./handlers/explainCommandHandler.js";
import {
    ActionContext,
    AppAgent,
    AppAgentManifest,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { CommandHandlerContext } from "../commandHandlerContext.js";
import { createActionResultNoDisplay } from "@typeagent/agent-sdk/helpers/action";
import { DispatcherActions } from "./schema/dispatcherActionSchema.js";
import { ClarifyRequestAction } from "./schema/clarifyActionSchema.js";

const dispatcherHandlers: CommandHandlerTable = {
    description: "Type Agent Dispatcher Commands",
    commands: {
        request: new RequestCommandHandler(),
        translate: new TranslateCommandHandler(),
        explain: new ExplainCommandHandler(),
    },
};

async function executeDispatcherAction(
    action: TypeAgentAction<DispatcherActions | ClarifyRequestAction>,
    context: ActionContext<CommandHandlerContext>,
) {
    if (
        action.actionName === "clarifyMultiplePossibleActionName" ||
        action.actionName === "clarifyMissingParameter" ||
        action.actionName === "clarifyUnresolvedReference"
    ) {
        return clarifyRequestAction(action, context);
    }

    throw new Error(`Unknown dispatcher action: ${action.actionName}`);
}

function clarifyRequestAction(
    action: ClarifyRequestAction,
    context: ActionContext<CommandHandlerContext>,
) {
    const { request, clarifyingQuestion } = action.parameters;
    context.actionIO.appendDisplay({
        type: "text",
        speak: true,
        content: clarifyingQuestion,
    });

    const result = createActionResultNoDisplay(clarifyingQuestion);
    result.additionalInstructions = [
        `Asked the user to clarify the request '${request}'`,
    ];
    return result;
}

export const dispatcherManifest: AppAgentManifest = {
    emojiChar: "🤖",
    description: "Built-in agent to dispatch requests",
    schema: {
        description: "",
        schemaType: "DispatcherActions",
        schemaFile: "./src/context/dispatcher/schema/dispatcherActionSchema.ts",
        injected: true,
        cached: false,
    },
    subActionManifests: {
        clarify: {
            schema: {
                description: "Action that helps you clarify your request.",
                schemaFile:
                    "./src/context/dispatcher/schema/clarifyActionSchema.ts",
                schemaType: "ClarifyRequestAction",
                injected: true,
                cached: false,
            },
        },
    },
};

export const dispatcherAgent: AppAgent = {
    executeAction: executeDispatcherAction,
    ...getCommandInterface(dispatcherHandlers),
};

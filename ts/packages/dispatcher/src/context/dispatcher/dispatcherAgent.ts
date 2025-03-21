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
import {
    ClarifyRequestAction,
    ClarifyUnresolvedReference,
} from "./schema/clarifyActionSchema.js";
import { loadAgentJsonTranslator } from "../../translation/agentTranslators.js";
import { lookupAndAnswer } from "../../search/search.js";
import { LookupAndAnswerAction } from "./schema/lookupActionSchema.js";

const dispatcherHandlers: CommandHandlerTable = {
    description: "Type Agent Dispatcher Commands",
    commands: {
        request: new RequestCommandHandler(),
        translate: new TranslateCommandHandler(),
        explain: new ExplainCommandHandler(),
    },
};

async function executeDispatcherAction(
    action: TypeAgentAction<
        DispatcherActions | ClarifyRequestAction | LookupAndAnswerAction
    >,
    context: ActionContext<CommandHandlerContext>,
) {
    switch (action.translatorName) {
        case "dispatcher.clarify":
            switch (action.actionName) {
                case "clarifyMultiplePossibleActionName":
                case "clarifyMissingParameter":
                    return clarifyRequestAction(action, context);
                case "clarifyUnresolvedReference":
                    return clarifyUnresolvedReferenceAction(action, context);
            }
            break;
        case "dispatcher.lookup":
            switch (action.actionName) {
                case "lookupAndAnswer":
                    return lookupAndAnswer(action, context);
            }
            break;
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

async function clarifyUnresolvedReferenceAction(
    action: ClarifyUnresolvedReference,
    context: ActionContext<CommandHandlerContext>,
) {
    const agents = context.sessionContext.agentContext.agents;
    if (
        !agents.isSchemaActive("dispatcher.lookup") ||
        !agents.isActionActive("dispatcher.lookup")
    ) {
        // lookup is disabled either for translation or action. Just ask the user.
        return clarifyRequestAction(action, context);
    }

    const actionConfigs = [
        agents.getActionConfig("dispatcher.lookup"),
        agents.getActionConfig("dispatcher.clarify"),
        agents.getActionConfig("dispatcher"),
    ];
    // TODO: cache this?
    const translator = loadAgentJsonTranslator(
        actionConfigs,
        [],
        agents,
        false, // no multiple
    );

    const result = await translator.translate(
        `What is ${action.parameters.reference}?`,
    );

    if (result.success) {
        const action = result.data;
        if (action.actionName === "lookupAndAnswer") {
            return lookupAndAnswer(action as LookupAndAnswerAction, context);
        }
    }

    return clarifyRequestAction(action, context);
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
        lookup: {
            schema: {
                description:
                    "Action that helps you look up information to answer user questions.",
                schemaFile:
                    "./src/context/dispatcher/schema/lookupActionSchema.ts",
                schemaType: "LookupAction",
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

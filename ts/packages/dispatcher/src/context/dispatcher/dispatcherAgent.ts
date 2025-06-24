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
    ActionResult,
    AppAgent,
    AppAgentManifest,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { CommandHandlerContext } from "../commandHandlerContext.js";
import {
    createActionResultFromMarkdownDisplay,
    createActionResultFromTextDisplay,
    createActionResultNoDisplay,
} from "@typeagent/agent-sdk/helpers/action";
import { DispatcherActions } from "./schema/dispatcherActionSchema.js";
import {
    ClarifyRequestAction,
    ClarifyUnresolvedReference,
} from "./schema/clarifyActionSchema.js";
import { loadAgentJsonTranslator } from "../../translation/agentTranslators.js";
import { lookupAndAnswer } from "../../search/search.js";
import {
    LookupAction,
    LookupActivity,
    LookupAndAnswerAction,
} from "./schema/lookupActionSchema.js";
import {
    getHistoryContext,
    translateRequest,
} from "../../translation/translateRequest.js";
import { ActivityActions } from "./schema/activityActionSchema.js";
import { ClarifyEntityAction } from "../../execute/pendingActions.js";

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
        | DispatcherActions
        | ClarifyRequestAction
        | LookupAction
        | LookupActivity
        | ActivityActions
        | ClarifyEntityAction
    >,
    context: ActionContext<CommandHandlerContext>,
) {
    switch (action.schemaName) {
        case "dispatcher.clarify":
            switch (action.actionName) {
                case "clarifyMultiplePossibleActionName":
                case "clarifyMissingParameter":
                    return clarifyRequestAction(action, context);
                case "clarifyUnresolvedReference":
                    const result = await clarifyWithLookup(action, context);
                    // If we fail to clarify with lookup, just ask the user.
                    return result ?? clarifyRequestAction(action, context);
                case "clarifyEntities":
                    return clarifyEntityAction(action, context);
            }
            break;
        case "dispatcher.lookup":
            switch (action.actionName) {
                case "lookupAndAnswer":
                    return lookupAndAnswer(action, context);
                case "startLookup":
                    const location =
                        action.parameters.lookup.source === "internet"
                            ? action.parameters.lookup.site !== undefined
                                ? `on internet sites ${action.parameters.lookup.site.join(", ")}`
                                : `on the internet`
                            : `in the conversation`;

                    const displayText = `Ok. What do you want to look up ${location}?`;
                    const result = createActionResultFromTextDisplay(
                        displayText,
                        displayText,
                    );
                    // TODO: formalize the schema for activityContext
                    result.activityContext = {
                        activityName: "lookup",
                        description: `Looking up ${location}`,
                        state: {
                            ...action.parameters.lookup,
                        },
                    };
                    return result;
            }
            break;
        case "dispatcher.activity":
            switch (action.actionName) {
                case "exitActivity":
                    const result =
                        createActionResultFromTextDisplay("Ok.  What's next?");

                    const systemContext = context.sessionContext.agentContext;
                    const endAction =
                        systemContext.activityContext?.activityEndAction;
                    if (endAction !== undefined) {
                        result.additionalActions = [endAction];
                    }
                    result.activityContext = null; // clear the activity context.

                    return result;
            }
            break;
    }

    throw new Error(
        `Unknown dispatcher action: ${action.schemaName}.${action.actionName}`,
    );
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

async function clarifyWithLookup(
    action: ClarifyUnresolvedReference,
    context: ActionContext<CommandHandlerContext>,
): Promise<ActionResult | undefined> {
    const systemContext = context.sessionContext.agentContext;
    const agents = systemContext.agents;
    if (
        !agents.isSchemaActive("dispatcher.lookup") ||
        !agents.isActionActive("dispatcher.lookup")
    ) {
        // lookup is disabled either for translation or action. Just ask the user.
        return undefined;
    }

    const actionConfigs = [
        agents.getActionConfig("dispatcher.lookup"),
        agents.getActionConfig("dispatcher"),
    ];
    // TODO: cache this?
    const translator = loadAgentJsonTranslator(actionConfigs, [], agents);

    const question = `What is ${action.parameters.reference}?`;
    const result = await translator.translate(question);

    if (!result.success) {
        return undefined;
    }
    const lookupAction = result.data as LookupAndAnswerAction;
    if (lookupAction.actionName !== "lookupAndAnswer") {
        return undefined;
    }
    const lookupResult = await lookupAndAnswer(
        lookupAction as LookupAndAnswerAction,
        context,
    );

    if (
        lookupResult.error !== undefined ||
        lookupResult.literalText === undefined
    ) {
        return undefined;
    }

    // TODO: This translation can probably more scoped based on the `actionName` field.
    const history = getHistoryContext(systemContext);

    history.promptSections.push({
        role: "assistant",
        content: lookupResult.literalText,
    });

    const translationResult = await translateRequest(
        action.parameters.request,
        context,
        history,
    );

    if (!translationResult) {
        // undefined means not found or not translated
        // null means cancelled because of replacement parse error.
        return undefined;
    }

    if (translationResult.requestAction.actions.length > 1) {
        // REVIEW: Expect only one action?.
        return undefined;
    }

    return {
        additionalActions: [translationResult.requestAction.actions[0].action],
        entities: [],
    };
}

function clarifyEntityAction(
    action: ClarifyEntityAction,
    context: ActionContext<CommandHandlerContext>,
): ActionResult {
    const { type, name, result } = action.parameters;

    if (result.entities.length < 2) {
        throw new Error(
            "ClarifyEntityAction should not be called with empty or single entity.",
        );
    }

    const question = [
        `Multiple ${type.toLowerCase()} entities named '${name}' were found`,
        ...result.entities.map((entity) => `- ${entity.name}`),
        "", // markdown needs an extra line to start a new paragraph
        `Please clarify which one you meant.`,
    ];

    return createActionResultFromMarkdownDisplay(
        question,
        undefined,
        result.entities,
    );
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
                schemaType: {
                    action: "LookupAction",
                    activity: "LookupActivity",
                },
                injected: true,
                cached: false,
            },
        },
        activity: {
            transient: true,
            schema: {
                description: "Action that manages activity context.",
                schemaFile:
                    "./src/context/dispatcher/schema/activityActionSchema.ts",
                schemaType: "ActivityActions",
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

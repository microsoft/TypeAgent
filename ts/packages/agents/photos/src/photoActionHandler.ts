// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAction,
    AppAgent,
    SessionContext,
    ActionResult,
    createActionResult,
} from "@typeagent/agent-sdk";
import { AnswerImageQuestionAction, PhotoAction } from "./photoSchema.js";

export function instantiate(): AppAgent {
    return {
        initializeAgentContext: initializePhotoContext,
        updateAgentContext: updatePhotoContext,
        executeAction: executePhotoAction,
        validateWildcardMatch: photoValidateWildcardMatch,
    };
}

type PhotoActionContext = {
    store: undefined;
};

async function executePhotoAction(
    action: AppAction,
    context: ActionContext<PhotoActionContext>,
) {
    let result = await handlePhotoAction(action as PhotoAction, context);
    return result;
}

async function photoValidateWildcardMatch(
    action: AppAction,
    context: SessionContext<PhotoActionContext>,
) {
    if (action.actionName === "describePhoto") {
        // TODO: implement?
    }
    return true;
}

async function initializePhotoContext() {
    return {};
}

async function updatePhotoContext(
    enable: boolean,
    context: SessionContext<PhotoActionContext>,
): Promise<void> {
    if (enable && context.sessionStorage) {
        // context.context.store = await createListStoreForSession(
        //     context.sessionStorage,
        //     "lists.json",
        // );
    } else {
        //context.context.store = undefined;
    }
}

async function handlePhotoAction(
    action: PhotoAction,
    photoContext: ActionContext<PhotoActionContext>,
) {
    let result: ActionResult | undefined = undefined;
    switch (action.actionName) {
        case "answerImageQuestion": {
            const answerAction = action as AnswerImageQuestionAction;
            const literalText = `Can't yet answer question: ${answerAction.parameters.questionText}`;
            result = createActionResult(literalText);
            break;
        }
        default:
            throw new Error(`Unknown action: ${action.actionName}`);
    }
    return result;
}

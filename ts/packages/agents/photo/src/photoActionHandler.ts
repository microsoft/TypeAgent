// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAction,
    AppAgent,
    SessionContext,
    ActionResult,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { createActionResult } from "@typeagent/agent-sdk/helpers/action";
import { PhotoAction } from "./photoSchema.js";

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
    action: TypeAgentAction<PhotoAction>,
    context: ActionContext<PhotoActionContext>,
) {
    let result = await handlePhotoAction(action, context);
    return result;
}

async function photoValidateWildcardMatch(
    action: AppAction,
    context: SessionContext<PhotoActionContext>,
) {
    return true;
}

async function initializePhotoContext() {
    return {};
}

async function updatePhotoContext(
    enable: boolean,
    context: SessionContext<PhotoActionContext>,
): Promise<void> {}

async function handlePhotoAction(
    action: PhotoAction,
    photoContext: ActionContext<PhotoActionContext>,
) {
    let result: ActionResult | undefined = undefined;
    switch (action.actionName) {
        case "takePhoto": {
            result = createActionResult("Showing camera...");
            photoContext.actionIO.takeAction("show-camera");
            break;
        }
        default:
            throw new Error(`Unknown action: ${action.actionName}`);
    }
    return result;
}

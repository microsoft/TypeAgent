// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAction,
    AppAgent,
    ActionResult,
} from "@typeagent/agent-sdk";
import { ImageAction } from "./imageSchema.js";

export function instantiate(): AppAgent {
    return {
        //initializeAgentContext: initializePhotoContext,
        //updateAgentContext: updatePhotoContext,
        executeAction: executePhotoAction,
        //validateWildcardMatch: photoValidateWildcardMatch,
    };
}

type ImageActionContext = {
    store: undefined;
};

async function executePhotoAction(
    action: AppAction,
    context: ActionContext<ImageActionContext>,
) {
    let result = await handlePhotoAction(action as ImageAction, context);
    return result;
}

async function handlePhotoAction(
    action: ImageAction,
    photoContext: ActionContext<ImageActionContext>,
) {
    let result: ActionResult | undefined = undefined;
    switch (action.actionName) {
        case "findImageAction": {
            // TODO: implement
            // result = createActionResult("Showing camera...");
            // photoContext.actionIO.takeAction("show-camera");
            break;
        }
        case "createImageAction":
            // TODO: implement
            break;
        default:
            throw new Error(`Unknown action: ${action.actionName}`);
    }
    return result;
}

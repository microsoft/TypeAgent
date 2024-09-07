// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAction,
    AppAgent,
    SessionContext,
    Storage,
    TurnImpression,
    createTurnImpressionFromDisplay,
} from "@typeagent/agent-sdk";
import { DescribeAction, PhotoAction } from "./photoSchema.js";

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
    let result: TurnImpression | undefined = undefined;
    let displayText: string | undefined = undefined;
    switch (action.actionName) {
        case "describeImage": {
            const addAction = action as DescribeAction;
            console.log(
                `Describing Image`,
                //`Adding items: ${addAction.parameters.items} to list ${addAction.parameters.listName}`,
            );
            // if (listContext.store !== undefined) {
            //     listContext.store.addItems(
            //         addAction.parameters.listName,
            //         addAction.parameters.items,
            //     );
            //     await listContext.store.save();
            //     displayText = `Added items: ${addAction.parameters.items} to list ${addAction.parameters.listName}`;
            //     result = createTurnImpressionFromDisplay(displayText);
            //     result.literalText = `Added item: ${addAction.parameters.items} to list ${addAction.parameters.listName}`;
            //     result.entities = [
            //         {
            //             name: addAction.parameters.listName,
            //             type: ["list"],
            //         },
            //     ];
            //     for (const item of addAction.parameters.items) {
            //         result.entities.push({
            //             name: item,
            //             type: ["item"],
            //         });
            //     }
            // }
            break;
        }
        default:
            throw new Error(`Unknown action: ${action.actionName}`);
    }
    return result;
}

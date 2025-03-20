// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAction,
    AppAgent,
    SessionContext,
    ActionResult,
    //Storage,
} from "@typeagent/agent-sdk";
import { ChildProcess, fork } from "child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { MontageAction } from "./montageActionSchema.js";
import { createActionResult, createActionResultFromError } from "@typeagent/agent-sdk/helpers/action";
import * as im from "image-memory";
import * as kp from "knowpro";

export function instantiate(): AppAgent {
    return {
        initializeAgentContext: initializeMontageContext,
        updateAgentContext: updateMontageContext,
        executeAction: executeMontageAction,
        //validateWildcardMatch: markdownValidateWildcardMatch,
    };
}

// The agent context
type MontageActionContext = {
    montage: PhotoMontage | undefined;
    imageCollection: im.ImageCollection | undefined;
    viewProcess: ChildProcess | undefined;
};

type PhotoMontage = {
    title: string;
    files: string[];
}

async function executeMontageAction(
    action: AppAction,
    context: ActionContext<MontageActionContext>,
) {
    let result = await handleMontageAction(action as MontageAction, context);
    return result;
}

// async function markdownValidateWildcardMatch(
//     action: AppAction,
//     context: SessionContext<MarkdownActionContext>,
// ) {
//     return true;
// }

async function initializeMontageContext() {    
    return {};
}

async function updateMontageContext(
    enable: boolean,
    context: SessionContext<MontageActionContext>,
): Promise<void> {
    if (enable) {

        // Load the image index from disk
        // TODO: make dynamic
        if (!context.agentContext.imageCollection) {
            const indexPath = "f:\pictures_index";
            context.agentContext.imageCollection = await im.ImageCollection.readFromFile(path.dirname(indexPath), path.basename(indexPath, path.extname(indexPath)));
        }

        // Create the montage
        // TODO: get from project memory
        if (!context.agentContext.montage) {
            context.agentContext.montage = { title: "Untitled Montage", files: [] };
        }

        if (!context.agentContext.viewProcess) {
            context.agentContext.viewProcess = await createViewServiceHost();
            // TODO: send rehydrated state
        }
    } else {
        // shut down service
        if (context.agentContext.viewProcess) {
            context.agentContext.viewProcess.kill();
        }
    }
}

async function handleMontageAction(
    action: MontageAction,
    actionContext: ActionContext<MontageActionContext>,
) {
    let result: ActionResult | undefined = undefined;
    //const agent = await createMarkdownAgent("GPT_4o");
    //const storage = actionContext.sessionContext.sessionStorage;

    if (!actionContext.sessionContext.agentContext.viewProcess) {
        return createActionResultFromError(`Unable to perform the requeste action. Disconnected from the canvas.`);
    }

    switch (action.actionName) {

        case "changeTitle": {
            actionContext.sessionContext.agentContext.viewProcess!.send(action);
            result = createActionResult(`Changed title to ${action.parameters.title}`)
            break;
        }

        case "clearSelectedPhotos": {
            actionContext.sessionContext.agentContext.viewProcess!.send(action);
            result = createActionResult(`Cleared the selection`)            
            break;
        }

        case "listPhotos": {
            // provide status
            result = createActionResult("Listing photos ...");

            let images: string[] | undefined = [];
            images = actionContext.sessionContext.agentContext.imageCollection?.messages.map((img) => img.metadata.img.fileName);

            // TODO: update project state with this action
            // TODO: update montage with this data and save it's state

            // add the images to the action if we have any
            if (images !== undefined) {
                action.parameters.files! = images
            }

            // send them to the visualizer/client
            actionContext.sessionContext.agentContext.viewProcess!.send(action);
            
            // report back to the user
            result = createActionResult(`Added ${images?.length} images.`);
            break;
        }

        case "removePhotos": {
            // provide status
            result = createActionResult("Searching...");

            // TODO: implement

            break;
        }

        case "selectPhotos": {
            // provide status
            result = createActionResult("Selecting...");

            if (actionContext.sessionContext.agentContext.imageCollection) {
                if (action.parameters.search_filters) {
                    const matches = await kp.searchConversationKnowledge(
                        actionContext.sessionContext.agentContext.imageCollection,
                        // search group
                        {
                            booleanOp: "and", // or
                            terms: filterToSearchTerm(action.parameters.search_filters),
                        },
                        // when filter
                        {
                            knowledgeType: "entity"
                        }
                    );

                    if (!action.parameters.files) {
                        action.parameters.files = [];
                    }

                    matches?.forEach((value: kp.SemanticRefSearchResult) => {
                        action.parameters.files?.push("yes!");
                    });
                } else {
                    result = createActionResultFromError("Unable to search images, no image index available.")
                }
            }

            // send select to the visualizer/client
            actionContext.sessionContext.agentContext.viewProcess!.send(action);

            // report back to the user
            let selectedCount: number = 0;
            selectedCount += action.parameters.files ? action.parameters.files.length : 0;
            selectedCount += action.parameters.indicies ? action.parameters.indicies.length : 0;
            
            result = createActionResult(`Selected ${selectedCount} images.`);
            break;                    

        }
    }
    return result;
}

function filterToSearchTerm(filters: string[]): kp.SearchTerm[] {
    let terms: kp.SearchTerm[] = [];
    filters.forEach(value => terms.push({ term: { text: value }}));

    return terms;
}

export async function createViewServiceHost() {
    let timeoutHandle: NodeJS.Timeout;

    const timeoutPromise = new Promise<undefined>((_resolve, reject) => {
        timeoutHandle = setTimeout(
            () => reject(new Error("Montage view service creation timed out")),
            10000,
        );
    });

    const viewServicePromise = new Promise<ChildProcess | undefined>(
        (resolve, reject) => {
            try {
                const expressService = fileURLToPath(
                    new URL(
                        path.join("..", "./route/route.js"),
                        import.meta.url,
                    ),
                );

                const childProcess = fork(expressService);

                childProcess.send({
                    type: "setFile",
                    filePath: "",
                });

                childProcess.on("message", function (message) {
                    if (message === "Success") {
                        resolve(childProcess);
                    } else if (message === "Failure") {
                        resolve(undefined);
                    }
                });

                childProcess.on("exit", (code) => {
                    console.log("Montage view server exited with code:", code);
                });
            } catch (e: any) {
                console.error(e);
                resolve(undefined);
            }
        },
    );

    return Promise.race([viewServicePromise, timeoutPromise]).then((result) => {
        clearTimeout(timeoutHandle);
        return result;
    });
}

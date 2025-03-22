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
import { FindPhotosAction, MontageAction, RemovePhotosAction, SelectPhotosAction } from "./montageActionSchema.js";
import { createActionResult, createActionResultFromError } from "@typeagent/agent-sdk/helpers/action";
import * as im from "image-memory";
import * as kp from "knowpro";
import { conversation as kpLib } from "knowledge-processor";
import { Facet } from "../../../../knowledgeProcessor/dist/conversation/knowledgeSchema.js";
//import registerDebug from "debug";

//const debugAgent = registerDebug("typeagent:agent:montage");

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
            context.agentContext.imageCollection = await im.ImageCollection.readFromFile("f:\\pictures_index", "index");
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

        // case "listPhotos": {
        //     // provide status
        //     result = createActionResult("Listing photos ...");

        //     let images: string[] | undefined = [];
        //     images = actionContext.sessionContext.agentContext.imageCollection?.messages.map((img) => img.metadata.img.fileName);

        //     // TODO: update project state with this action
        //     // TODO: update montage with this data and save it's state

        //     // add the images to the action if we have any
        //     if (images !== undefined) {

        //         if (!action.parameters) {
        //             action.parameters = {};
        //         }

        //         action.parameters.files! = images
        //     }

        //     // send them to the visualizer/client
        //     actionContext.sessionContext.agentContext.viewProcess!.send(action);
            
        //     // report back to the user
        //     result = createActionResult(`Added ${images?.length} images.`);
        //     break;
        // }

        case "removePhotos": {
            // provide status
            result = createActionResult("Removed requested images.");

            // search for the images requested by the user
            if (action.parameters.search_filters) {
                await findRequestedImages(action, actionContext.sessionContext.agentContext.imageCollection);
            } else {
                result = createActionResultFromError("Unable to search images, no image index available.");
            }

            // send select to the visualizer/client
            actionContext.sessionContext.agentContext.viewProcess!.send(action);

            result = createActionResult(`Removing requested images.`);
            break;
        }

        case "selectPhotos": {
            // provide status
            result = createActionResult("Selecting...");

            // search for the images requested by the user
            if (action.parameters.search_filters) {
                await findRequestedImages(action, actionContext.sessionContext.agentContext.imageCollection);
            } else {
                result = createActionResultFromError("Unable to search images, no image index available.");
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

        case "findPhotos": {

            // search for the images requested by the user
            if (actionContext.sessionContext.agentContext.imageCollection !== undefined) {
                if (action.parameters.search_filters && action.parameters.search_filters.length > 0) {
                    await findRequestedImages(action, actionContext.sessionContext.agentContext.imageCollection);
                } else {
                    (action as FindPhotosAction).parameters.files = actionContext.sessionContext.agentContext.imageCollection?.messages.map((img) => img.metadata.img.fileName);                
                }
            } else {
                result = createActionResultFromError("Unable to search images, no image index available.");            
            }

            // TODO: update project state with this action
            // TODO: update montage with this data and save it's state

            // send select to the visualizer/client
            actionContext.sessionContext.agentContext.viewProcess!.send(action);

            result = createActionResult(`Found ${action.parameters.files?.length} images.`);            
            break;
        }
    }
    return result;
}

async function findRequestedImages(action: FindPhotosAction | SelectPhotosAction | RemovePhotosAction, imageCollection: im.ImageCollection | undefined) {
    if (imageCollection) {
        if (action.parameters.search_filters) {
            const matches = await kp.searchConversationKnowledge(
                imageCollection,
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

            const imageFiles: Set<string> = new Set<string>();

            console.log(`Found ${matches?.size} matches for: ${action.parameters.search_filters}`);

            matches?.forEach((match: kp.SemanticRefSearchResult) => {
                match.semanticRefMatches.forEach((value: kp.ScoredSemanticRefOrdinal) => {                    
                    const e: kp.SemanticRef | undefined = imageCollection.semanticRefs[value.semanticRefOrdinal];
                    console.log(`\tMatch: ${e}`);
                    if (e) {
                        if (e.knowledgeType === "entity") {
                            const k: kpLib.ConcreteEntity = e.knowledge as kpLib.ConcreteEntity;

                            // did we get a direct hit on an image?
                            if (k.type.includes("image")) {
                                const f: Facet | undefined = k.facets?.find((v) => { return v.name === "File Name"; });

                                if (f?.value) {
                                    imageFiles.add(f?.value.toString());
                                }
                            } else {
                                // for non-images trace it back to the originating image and add that
                                const imgRange: kp.TextLocation = e.range.start;
                                const img: im.Image = imageCollection.messages[imgRange.messageOrdinal];

                                imageFiles.add(img.metadata.fileName);
                            }
                        }
                    }                            
                });
            });

            action.parameters.files = [...imageFiles];
        }
    }
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


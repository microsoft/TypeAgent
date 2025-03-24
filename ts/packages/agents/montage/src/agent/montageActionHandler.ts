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
import { ChildProcess, fork, spawn } from "child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { FindPhotosAction, ListPhotosAction, MontageAction, RemovePhotosAction, SelectPhotosAction, SetSearchParametersAction } from "./montageActionSchema.js";
import { createActionResult, createActionResultFromError } from "@typeagent/agent-sdk/helpers/action";
import * as im from "image-memory";
import * as kp from "knowpro";
import { conversation as kpLib } from "knowledge-processor";
import { Facet } from "../../../../knowledgeProcessor/dist/conversation/knowledgeSchema.js";
import { copyFileSync } from "node:fs";
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
    searchSettings: {
        minScore: number,
    }
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

async function initializeMontageContext() {    
    return {
        // default search settings
        searchSettings: {
            minScore: 0,
        }
    };
}

async function updateMontageContext(
    enable: boolean,
    context: SessionContext<MontageActionContext>,
): Promise<void> {
    if (enable) {

        // create a new montage
        context.agentContext.montage = {
            title: "Untitled Montage",
            files: []
        }

        // Load the image index from disk
        // TODO: make dynamic, load from session storage
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
            actionContext.sessionContext.agentContext.montage!.title = action.parameters.title;

            actionContext.sessionContext.agentContext.viewProcess!.send(action);
            result = createActionResult(`Changed title to ${action.parameters.title}`)
            break;
        }

        case "clearSelectedPhotos": {
            actionContext.sessionContext.agentContext.viewProcess!.send(action);
            result = createActionResult(`Cleared the selection`)            
            break;
        }

        case "removePhotos": {
            // provide status
            result = createActionResult("Removed requested images.");

            // search for the images requested by the user
            if (action.parameters.search_filters) {
                await findRequestedImages(action, actionContext.sessionContext.agentContext);
            } else {
                result = createActionResultFromError("Unable to search images, no image index available.");
            }

            // remove them from the montage
            // TODO: implement
            //actionContext.sessionContext.agentContext.montage!.files = actionContext.sessionContext.agentContext.montage?.files.filter((value) => !action.parameters.files?.includes(value))!;

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
                await findRequestedImages(action, actionContext.sessionContext.agentContext);
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

        case "listPhotos":
        case "findPhotos": {

            // provide status
            result = createActionResult("Searching photos...");

            // search for the images requested by the user
            if (actionContext.sessionContext.agentContext.imageCollection !== undefined) {
                if (action.parameters.search_filters && action.parameters.search_filters.length > 0) {
                    await findRequestedImages(action, actionContext.sessionContext.agentContext);
                } else {
                    (action as FindPhotosAction).parameters.files = actionContext.sessionContext.agentContext.imageCollection?.messages.map((img) => img.metadata.img.fileName.toLocaleLowerCase());                
                }
            } else {
                result = createActionResultFromError("Unable to search images, no image index available.");            
            }

            // TODO: update project state with this action
            // TODO: update montage with this data and save it's state
            actionContext.sessionContext.agentContext.montage!.files = [...new Set([...actionContext.sessionContext.agentContext.montage!.files, ...action.parameters.files!])];

            // send select to the visualizer/client
            actionContext.sessionContext.agentContext.viewProcess!.send(action);

            result = createActionResult(`Found ${action.parameters.files?.length} images.`);            
            break;
        }

        case "showSearchParameters": {
            result = createActionResult(`Search parameters:\n${JSON.stringify(actionContext.sessionContext.agentContext.searchSettings)}`);
            break;
        }

        case "setSearchParameters": {

            const settingsAction: SetSearchParametersAction = action as SetSearchParametersAction;

            if (settingsAction.parameters.minSearchScore) {
                actionContext.sessionContext.agentContext.searchSettings.minScore = settingsAction.parameters.minSearchScore;
            }

            result = createActionResult(`Updated search parameters to:\n${JSON.stringify(actionContext.sessionContext.agentContext.searchSettings)}`)
            break;
        }

        case "startSlideShow": {

            // TODO: dynamically get
            // create slide show dir
            actionContext.sessionContext.agentContext.montage!.files.forEach((file) => copyFileSync(file, path.join("f:\\slideshow", path.basename(file))));

            // copy files into slideshow dir 

            // start screen saver
            try {
                spawn("c:\\Windows\\System32\\PhotoScreensaver.scr", [ "/s"]);
            } catch (e) {
                console.log(e);
            }

            break;
        }
    }
    return result;
}

async function findRequestedImages(action: ListPhotosAction | FindPhotosAction | SelectPhotosAction | RemovePhotosAction, 
    context: MontageActionContext) {
    if (context.imageCollection) {
        if (action.parameters.search_filters) {
            const matches = await kp.searchConversationKnowledge(
                context.imageCollection,
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

                    if (value.score >= context.searchSettings.minScore) {
                        const semanticRef: kp.SemanticRef | undefined = context.imageCollection!.semanticRefs[value.semanticRefOrdinal];
                        console.log(`\tMatch: ${semanticRef}`);
                        if (semanticRef) {
                            if (semanticRef.knowledgeType === "entity") {
                                const entity: kpLib.ConcreteEntity = semanticRef.knowledge as kpLib.ConcreteEntity;

                                // did we get a direct hit on an image?
                                if (entity.type.includes("image")) {
                                    const f: Facet | undefined = entity.facets?.find((v) => { return v.name === "File Name"; });

                                    if (f?.value) {
                                        imageFiles.add(f?.value.toString().toLocaleLowerCase());
                                    }
                                } else {
                                    // for non-images trace it back to the originating image and add that
                                    const imgRange: kp.TextLocation = semanticRef.range.start;
                                    const img: im.Image = context.imageCollection!.messages[imgRange.messageOrdinal];

                                    imageFiles.add(img.metadata.fileName.toLocaleLowerCase());
                                }
                            } else if (semanticRef.knowledgeType === "action") {
                                // const action: kpLib.Action = semanticRef.knowledge as kpLib.Action;
                                // action.

                            } else if (semanticRef.knowledgeType === "tag") {

                            } else if (semanticRef.knowledgeType === "topic") {

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


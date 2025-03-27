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
import { CreateMontageAction, DeleteMontageAction, FindPhotosAction, ListPhotosAction, MontageAction, RemovePhotosAction, SelectPhotosAction, SetSearchParametersAction, SwitchMontageAction } from "./montageActionSchema.js";
import { createActionResult, createActionResultFromError, createActionResultNoDisplay } from "@typeagent/agent-sdk/helpers/action";
import * as im from "image-memory";
import * as kp from "knowpro";
import { conversation as kpLib } from "knowledge-processor";
import { Facet } from "../../../../knowledgeProcessor/dist/conversation/knowledgeSchema.js";
import { copyFileSync, existsSync, mkdirSync, rmdirSync } from "node:fs";
import Registry from "winreg";
import koffi from 'koffi';
import { displayResult } from "@typeagent/agent-sdk/helpers/display";
import registerDebug from "debug";

const debug = registerDebug("typeagent:agent:montage");

export function instantiate(): AppAgent {
    return {
        initializeAgentContext: initializeMontageContext,
        updateAgentContext: updateMontageContext,
        executeAction: executeMontageAction,
        closeAgentContext: closeMontageContext
    };
}

const montageFile: string = "montages.json";

// The agent context
type MontageActionContext = {
    montages: PhotoMontage[];
    montage: PhotoMontage | undefined;
    imageCollection: im.ImageCollection | undefined;
    viewProcess: ChildProcess | undefined;
    searchSettings: {
        minScore: number,
    }
};

// Montage definition
export type PhotoMontage = {
    id: number;
    title: string;
    files: string[];
    selected: string[];
}

async function executeMontageAction(
    action: AppAction,
    context: ActionContext<MontageActionContext>,
) {
    let result = await handleMontageAction(action as MontageAction, context);
    return result;
}

// Define the nativew functions we'll be using function
const shell32: koffi.IKoffiLib = koffi.load('shell32.dll');
const crypt32: koffi.IKoffiLib = koffi.load('crypt32.dll');

// define types
koffi.opaque("ITEMIDLIST");

// define functions
const ILCreateFromPathW = shell32.func('ITEMIDLIST* ILCreateFromPathW(str16 pszPath)');
const ILGetSize = shell32.func("uint ILGetSize(ITEMIDLIST* pidl)");
const ILFree = shell32.func("void ILFree(ITEMIDLIST* pidl)");
const CryptBinaryToStringW = crypt32.func("bool CryptBinaryToStringW(ITEMIDLIST* pbBinary, uint cbBinary, uint dwFlags, _Inout_ str16 pszString, _Inout_ uint* pcchString)");

async function initializeMontageContext() {    
    return {
        // default search settings
        searchSettings: {
            minScore: 0,
        }
    };
}

/**
 * Called when the agent is shutting down, writes the montages to disk
 * @param context The session context
 */
async function closeMontageContext(context: SessionContext<MontageActionContext>) {
    saveMontages(context);
}

async function updateMontageContext(
    enable: boolean,
    context: SessionContext<MontageActionContext>,
): Promise<void> {
    if (enable) {

        // Load all montages from disk
        context.agentContext.montages = [];
        if (await context.sessionStorage?.exists(montageFile)) {
            const data = await context.sessionStorage?.read(montageFile, "utf8");
            if (data) {
                context.agentContext.montages = JSON.parse(data);
            }
        }

        // if there are montages, load the last one otherwise create a new one
        if (context.agentContext.montages.length > 0) {
            context.agentContext.montage = context.agentContext.montages[context.agentContext.montages.length - 1];
        } else {
            // create a new montage
            context.agentContext.montage = {
                id: context.agentContext.montages.length,
                title: "Untitled Montage",
                files: [],
                selected: []
            }
        }

        // Load the image index from disk
        // TODO: allow swapping between montages
        if (!context.agentContext.imageCollection) {
            context.agentContext.imageCollection = await im.ImageCollection.readFromFile("f:\\pictures_index", "index");
        }

        if (!context.agentContext.viewProcess) {
            context.agentContext.viewProcess = await createViewServiceHost((montage: PhotoMontage) => {
                // harvest the id
                montage.id = context.agentContext.montage!.id;

                // overwite the working montage with the updated monage
                context.agentContext.montage = montage;
            });

            // send initial state
            context.agentContext.viewProcess?.send(context.agentContext.montage);
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
        // TODO: undo action?
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

        case "removePhotos": {
            // provide status
            result = createActionResult("Removed requested images.");

            // search for the images requested by the user
            if (action.parameters.search_filters) {
                await findRequestedImages(action, actionContext.sessionContext.agentContext);
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

            if (process.platform == "win32") {
                // start the slide show
                startSlideShow(actionContext.sessionContext.agentContext);
                result = createActionResult(`Showing ${actionContext.sessionContext.agentContext.montage?.title}.`);
            } else {
                result = createActionResultFromError(`This action is not supported on platform '${process.platform}'.`);
            }

            break;
        }

        case "createNewMontage": {
            const newMontageAction: CreateMontageAction = action as CreateMontageAction;
            actionContext.sessionContext.agentContext.montage = createNewMontage(actionContext.sessionContext.agentContext, newMontageAction.parameters.title);

            saveMontages(actionContext.sessionContext);

            // update montage state
            actionContext.sessionContext.agentContext.viewProcess?.send(actionContext.sessionContext.agentContext.montage!);

            result = createActionResult("Created new montage", false, [entityFromMontage(actionContext.sessionContext.agentContext.montage)]);
            break;
        }

        case "deleteMontage": {
            const deleteMontageAction: DeleteMontageAction = action as DeleteMontageAction;
            const montageIds: number[] = deleteMontageAction.parameters.id ? deleteMontageAction.parameters.id : [actionContext.sessionContext.agentContext.montage!.id];
            const deleteAll: boolean = deleteMontageAction.parameters.deleteAll ? deleteMontageAction.parameters.deleteAll : false;

            if (deleteAll) {
                actionContext.sessionContext.agentContext.montages = [];

                // create new active montage
                actionContext.sessionContext.agentContext.montage = createNewMontage(actionContext.sessionContext.agentContext);    
            } else if (deleteMontageAction.parameters.title !== undefined) {
                actionContext.sessionContext.agentContext.montages.filter((value) => {
                    // create new active montage if that's the one we are deleting
                    if (value.title == actionContext.sessionContext.agentContext.montage?.title) {
                        actionContext.sessionContext.agentContext.montage = createNewMontage(actionContext.sessionContext.agentContext);            
                    }

                    return value.title == deleteMontageAction.parameters.title
                });
            } else {
                // no id/title specified, delete the active montage or the one with the supplied id
                actionContext.sessionContext.agentContext.montages.filter(value => montageIds.indexOf(value.id) !== -1);

                // create new active montage
                actionContext.sessionContext.agentContext.montage = createNewMontage(actionContext.sessionContext.agentContext);    
            }

            saveMontages(actionContext.sessionContext);

            result = createActionResult("Montage deleted.");

            // update montage state
            actionContext.sessionContext.agentContext.viewProcess?.send(actionContext.sessionContext.agentContext.montage!);

            break;
        }

        case "switchMontage": {
            const switchMontageAction: SwitchMontageAction = action as SwitchMontageAction;

            if (switchMontageAction.parameters.id !== undefined) {
                const m: PhotoMontage | undefined = actionContext.sessionContext.agentContext.montages.find(value => value.id == switchMontageAction.parameters.id);
                
                if (m) {
                    actionContext.sessionContext.agentContext.montage = m;
                    result = createActionResult(`Switch montage to ${m.title}`);
                } else {
                    result = createActionResultFromError(`Unable to switch montage, requested montage does not exist.`);
                }
            } else {
                const m: PhotoMontage | undefined = actionContext.sessionContext.agentContext.montages.find(value => value.title == switchMontageAction.parameters.title);
                
                if (m) {
                    actionContext.sessionContext.agentContext.montage = m;
                    result = createActionResult(`Switch montage to ${m.title}`);
                } else {
                    result = createActionResultFromError(`Unable to switch montage, requested montage does not exist.`);     
                }           
            }

            // update montage state
            actionContext.sessionContext.agentContext.viewProcess?.send(actionContext.sessionContext.agentContext.montage!);

            break;
        }

        case "listMontages": {

            const names: string[] = [];
            actionContext.sessionContext.agentContext.montages.forEach(value => names.push(`${value.id}: ${value.title}`));

            displayResult(names, actionContext);

            result = createActionResultNoDisplay("done!");

            break;
        }
    }
    return result;
}

function createNewMontage(context: MontageActionContext, title: string = ""): PhotoMontage {
    // create a new montage
    return {
        id: context.montages.length,
        title: title.length == 0 ? "Untitled" : title,
        files: [],
        selected: []
    }    
}

/**
 * Creates an entity for conversation memory based on the supplied montage
 * @param montage - The montage to create an entity for
 */
function entityFromMontage(montage: PhotoMontage) {
    return {
        name: montage.title,
        type: ["project", "montage"],
        //additionalEntityText = montage.title;
        uniqueId: montage.id.toString()
    }
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

export async function createViewServiceHost(montageUpdatedCallback: (montage: PhotoMontage) => void) {
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
                    } else {
                        const mon: PhotoMontage | undefined = message as PhotoMontage;
                        if (mon) {
                            montageUpdatedCallback(mon);
                        }
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

async function saveMontages(context: SessionContext<MontageActionContext>) {
    // merge the "working montage" into the saved montages
    if (context.agentContext.montages.length > 0 && context.agentContext.montage !== undefined) {
        if (context.agentContext.montages[context.agentContext.montages.length - 1].id == context.agentContext.montage.id) {
            // replace
            context.agentContext.montages[context.agentContext.montages.length - 1] = context.agentContext.montage;
        } else {
            context.agentContext.montages.push(context.agentContext.montage);
        }
    } else {
        if (context.agentContext.montage !== undefined) {
            context.agentContext.montages.push(context.agentContext.montage);
        }
    }

    // save the montage state for later
    await context.sessionStorage?.write(montageFile, JSON.stringify(context.agentContext.montages));
}

/**
 * Starts the built-in windows slideshow screensaver
 * @param folder The optional folder to lanch the slideshow for
 */
function startSlideShow(context: MontageActionContext) {

    // copy images into slide show folder
    const slideShowDir = path.join(process.env["TEMP"]!, "typeagent_slideshow");
    if (existsSync(slideShowDir)) {
        rmdirSync(slideShowDir, { recursive: true });
    }

    // make the new dir
    mkdirSync(slideShowDir);

    // copy images into slideshow dir
    context.montage?.files.forEach(file => copyFileSync(file, path.join(slideShowDir, path.basename(file))));

    // update slideshow screen saver directory
    const key = new Registry({
        hive: Registry.HKCU,
        key: 'Software\\Microsoft\\Windows Photo Viewer\\Slideshow\\Screensaver'
      });
      
    // set the registry value
    const pidl = createEncryptedPIDLFromPath(slideShowDir)
    if (pidl) {
        key.set("EncryptedPIDL", "REG_SZ", pidl, (err) => {
            if (err) {
                console.error('Error reading registry value:', err);
            }
        });
    }
    
    // start slideshow screen saver
    try {
        spawn(`${process.env['SystemRoot']}\\System32\\PhotoScreensaver.scr`, [ "/s"]);
    } catch (e) {
        console.log(e);
    }    
}

/**
 * Creats an encrypted PIDL for use with the Photo Viewer slideshow screensaver
 * @param path - The path of the PIDL to create and encrypt
 * @returns - The encrypted PIDL
 */
function createEncryptedPIDLFromPath(path: string) {    
    const pidl = ILCreateFromPathW(path);
    const size: number = ILGetSize(pidl);
       
    let stringBuffer = [""];
    let requiredSize = [ 0 ];
    if (!CryptBinaryToStringW(pidl, size, 1, stringBuffer, requiredSize)) {
        debug(`ERROR encrypting PIDL for ${path}`);
    }
    
    ILFree(pidl);

    return stringBuffer[0];
}
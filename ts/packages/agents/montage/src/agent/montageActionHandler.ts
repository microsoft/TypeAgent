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
import { copyFileSync, existsSync, mkdirSync, rmdirSync } from "node:fs";
import Registry from "winreg";
import koffi from 'koffi';

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
    // merge the "working montage" into the saved montages
    if (context.agentContext.montages.length > 0 && context.agentContext.montage !== undefined) {
        if (context.agentContext.montages[context.agentContext.montages.length - 1].id == context.agentContext.montage.id) {
            // replace
            context.agentContext.montages[context.agentContext.montages.length -1] = context.agentContext.montage;
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
            } else {
                result = createActionResultFromError(`This action is not supported on platform '${process.platform}'.`);
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
    const pidl = createPIDLFromPath(slideShowDir)
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

// const ITEMIDLIST = koffi.struct('IDLIST_ABSOLUTE', {
//  mkid: koffi.struct('SHITEMID', {
//     cb: 'ushort',
//     abID: koffi.array('char', 1, 'Array')
//  })
// });
const ITEMIDLIST = koffi.struct('IDLIST_ABSOLUTE', {
    mkid: 'intptr'
   });

// const SHITEMID = koffi.struct('SHITEMID', {
//     cb: 'ushort',
//     abID: koffi.array('char', 1, 'Array')
// });

const SHITEMID = koffi.struct('SHITEMID', {
    cb: 'ushort',
    abID: 'intptr'
});

function createPIDLFromPath(path: string) {
    // Define the ILCreateFromPath function
    //const user32 = koffi.load('user32.dll');
    const shell32: koffi.IKoffiLib = koffi.load('shell32.dll');
    //const MessageBoxA_1 = user32.func('__stdcall', 'MessageBoxA', 'int', ['void *', 'str', 'str', 'uint']);
    //const MessageBoxA_2 = user32.func('int __stdcall MessageBoxA(void *hwnd, str text, str caption, uint type)');
    //const ILCreateFromPath = shell32.func('PIDLIST_ABSOLUTE ILCreateFromPath(PCTSTR pszPath)');
    const ILCreateFromPath = shell32.func('__stdcall', "ILCreateFromPath", ITEMIDLIST, ['str16']);
    const ILCreateFromPath2 = shell32.func('IDLIST_ABSOLUTE* ILCreateFromPath(char16_t* pszPath)');
    //console.log(MessageBoxA_1);
    //console.log(MessageBoxA_2);
    //console.log(ILCreateFromPath);
    const r = ILCreateFromPath(path);
    console.log(r);
    const ss = koffi.as(r, "SHITEMID");
    console.log(ss);

    //const sh = koffi.decode(r.mkid, "SHITEMID");
    //console.log(sh);
    console.log(SHITEMID);
    const r2 = ILCreateFromPath2(path);
    console.log(r2);
    // const ILCreateFromPath = shell32.func(
    //     'ILCreateFromPath', 
    //     'PIDLIST_ABSOLUTE', 
    //     ['PCTSTR']);
    
    // Call the ILCreateFromPath function
    // const bindCtx = null; // You can create a bind context if needed
    // const pidl = koffi.alloc(koffi.types.PIDLIST_ABSOLUTE, path.length);
    // const sfgaoIn = 0;
    // const sfgaoOut = koffi.alloc(koffi.types.sfgaoOut, 1024);
    
    // const result = SHParseDisplayName(path, bindCtx, pidl, sfgaoIn, sfgaoOut);
    //const result = ILCreateFromPath(path);
    
    // if (result === 0) {
    //     console.log('SHParseDisplayName succeeded');
    // } else {
    //     console.error('SHParseDisplayName failed with error code:', result);
    // }
 
    return null;
}

// const LPWSTR = ref.types.CString;
// const LPITEMIDLIST = ref.refType(ref.types.void);
// const HRESULT = ref.types.int32;

// // Load the Shell32 DLL
// const shell32 = ffi.Library('shell32', {
//     'SHParseDisplayName': [HRESULT, [LPWSTR, 'void', LPITEMIDLIST, 'uint32', 'void']],
//     'CoTaskMemFree': ['void', [LPITEMIDLIST]]
// });

// /**
//  * Creates a PIDL from a directory name
//  * @param path The dir to encrypt
//  */
// function createPIDLFromDirectoryName(path: string): Buffer | null {  
//     const pidlBuffer = ref.alloc(LPITEMIDLIST);
//     const hr = shell32.SHParseDisplayName(path, null, pidlBuffer, 0, null);
//     if (hr === 0) { // S_OK
//       return pidlBuffer.deref() as any as Buffer;
//     } else {
//         console.log("Failed to create PIDL!");
//         return null;
//     }
// }

// function freePIDL(pidl: Buffer): void {
//     shell32.CoTaskMemFree(pidl as ref.Pointer<void>);
// }
  


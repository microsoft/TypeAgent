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
import {
    CreateMontageAction,
    DeleteMontageAction,
    FindPhotosAction,
    ListPhotosAction,
    MergeMontageAction,
    MontageAction,
    RemovePhotosAction,
    SelectPhotosAction,
    SetSearchParametersAction,
    SwitchMontageAction,
} from "./montageActionSchema.js";
import {
    createActionResult,
    createActionResultFromError,
    createActionResultNoDisplay,
} from "@typeagent/agent-sdk/helpers/action";
import * as im from "image-memory";
import * as kp from "knowpro";
import { conversation as kpLib } from "knowledge-processor";
import { Facet } from "../../../../knowledgeProcessor/dist/conversation/knowledgeSchema.js";
import { copyFileSync, existsSync, mkdirSync, rmdirSync } from "node:fs";
//import Registry from "winreg";
import koffi from "koffi";
import {
    displayError,
    displayResult,
} from "@typeagent/agent-sdk/helpers/display";
import registerDebug from "debug";
import { spawnSync } from "node:child_process";

const debug = registerDebug("typeagent:agent:montage");

export function instantiate(): AppAgent {
    return {
        initializeAgentContext: initializeMontageContext,
        updateAgentContext: updateMontageContext,
        executeAction: executeMontageAction,
        closeAgentContext: closeMontageContext,
    };
}

const montageFile: string = "montages.json";

// The agent context
type MontageActionContext = {
    montageIdSeed: number;
    montages: PhotoMontage[];
    montage: PhotoMontage | undefined;
    imageCollection: im.ImageCollection | undefined;
    viewProcess: ChildProcess | undefined;
    searchSettings: {
        minScore: number;
        exactMatch: boolean;
    };
    indexes: im.IndexData[];
};

// Montage definition
export type PhotoMontage = {
    id: number;
    title: string;
    files: string[];
    selected: string[];
};

async function executeMontageAction(
    action: AppAction,
    context: ActionContext<MontageActionContext>,
) {
    let result = await handleMontageAction(action as MontageAction, context);
    return result;
}

// Define the nativew functions we'll be using function
const shell32: koffi.IKoffiLib | undefined =
    process.platform === "win32" ? koffi.load("shell32.dll") : undefined;
const crypt32: koffi.IKoffiLib | undefined =
    process.platform === "win32" ? koffi.load("crypt32.dll") : undefined;

// define types
koffi.opaque("ITEMIDLIST");

// define functions
const ILCreateFromPathW = shell32?.func(
    "ITEMIDLIST* ILCreateFromPathW(str16 pszPath)",
);
const ILGetSize = shell32?.func("uint ILGetSize(ITEMIDLIST* pidl)");
const ILFree = shell32?.func("void ILFree(ITEMIDLIST* pidl)");
const CryptBinaryToStringW = crypt32?.func(
    "bool CryptBinaryToStringW(ITEMIDLIST* pbBinary, uint cbBinary, uint dwFlags, _Inout_ str16 pszString, _Inout_ uint* pcchString)",
);

async function initializeMontageContext() {
    return {
        // default search settings
        searchSettings: {
            minScore: 5, // TODO: tune?
            exactMatch: false,
        },
    };
}

/**
 * Called when the agent is shutting down, writes the montages to disk
 * @param context The session context
 */
async function closeMontageContext(
    context: SessionContext<MontageActionContext>,
) {
    await saveMontages(context);
}

async function updateMontageContext(
    enable: boolean,
    context: SessionContext<MontageActionContext>,
): Promise<void> {
    if (enable) {
        // Load all montages from disk
        context.agentContext.montages = [];
        context.agentContext.montageIdSeed = 0;
        if (await context.sessionStorage?.exists(montageFile)) {
            const data = await context.sessionStorage?.read(
                montageFile,
                "utf8",
            );
            if (data) {
                const d = JSON.parse(data);
                context.agentContext.montageIdSeed = d.montageIdSeed
                    ? d.montageIdSeed
                    : 0;
                context.agentContext.montages = d.montages;
            }
        }

        // if there are montages, load the last one otherwise create a new one
        if (context.agentContext.montages.length > 0) {
            context.agentContext.montage =
                context.agentContext.montages[
                    context.agentContext.montages.length - 1
                ];
        }

        // Load the image index from disk
        // TODO: load from sesssion storage/directory
        // TODO: give the user a way to index their images
        // TODO: evaluate perf..is this fast enough give a large image index?
        if (!context.agentContext.imageCollection) {
            context.agentContext.indexes = await context.indexes("image");

            // TODO: allow the montage agent to switch between image indexes
            // TODO: handle the case where the image index is locked
            // TODO: handle image index that has been updated since we loaded it
            if (context.agentContext.indexes.length > 0) {
                // For now just load the first image index
                context.agentContext.imageCollection =
                    await im.ImageCollection.readFromFile(
                        context.agentContext.indexes[0].path,
                        "index",
                    );
            } else {
                debug(
                    "Unable to load image index, please create one using the @index.",
                );
            }
        }

        if (!context.agentContext.viewProcess) {
            context.agentContext.viewProcess = await createViewServiceHost(
                (montage: PhotoMontage) => {
                    // harvest the id
                    if (context.agentContext.montage) {
                        montage.id = context.agentContext.montage!.id;

                        // overwite the working montage with the updated monage
                        context.agentContext.montage = montage;
                    }
                },
            );

            // send initial state and allowed folder(s)
            if (context.agentContext.montage) {
                const folders: string[] = [];
                context.agentContext.indexes.forEach((idx) => {
                    folders.push(idx.location);
                });

                context.agentContext.viewProcess?.send({
                    allowedFolders: folders,
                });

                context.agentContext.viewProcess?.send(
                    context.agentContext.montage,
                );
            }
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

    if (!actionContext.sessionContext.agentContext.viewProcess) {
        return createActionResultFromError(
            `Unable to perform the requeste action. Disconnected from the canvas.`,
        );
    } else if (!actionContext.sessionContext.agentContext.imageCollection) {
        return createActionResultFromError(
            "No image index has been loaded! Please create one with the @index command.",
        );
    }

    switch (action.actionName) {
        // TODO: undo action?
        case "changeTitle": {
            actionContext.sessionContext.agentContext.viewProcess!.send(action);
            result = createActionResult(
                `Changed title to ${action.parameters.title}`,
            );
            break;
        }

        case "clearSelectedPhotos": {
            actionContext.sessionContext.agentContext.viewProcess!.send(action);
            result = createActionResult(`Cleared the selection`);
            break;
        }

        case "removePhotos": {
            // provide status
            result = createActionResult("Removed requested images.");

            // search for the images requested by the user
            if (action.parameters.search_filters) {
                await findRequestedImages(
                    action,
                    actionContext.sessionContext.agentContext,
                );
            } else {
                result = createActionResultFromError(
                    "Unable to search images, no image index available.",
                );
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
                await findRequestedImages(
                    action,
                    actionContext.sessionContext.agentContext,
                );
            } else {
                result = createActionResultFromError(
                    "Unable to search images, no image index available. Please run the image indexer before manipulating montages.",
                );
            }

            // send select to the visualizer/client
            actionContext.sessionContext.agentContext.viewProcess!.send(action);

            let selectedCount: number = 0;
            // what is the intersection of the images in the montage and what we found in the search...that is the selection
            // go through the files by name

            const intersection = action.parameters.files?.filter((item1) =>
                actionContext.sessionContext.agentContext.montage?.files.some(
                    (item2) => item1 === item2,
                ),
            );
            if (intersection) {
                selectedCount += intersection?.length;
            }

            action.parameters.indicies?.forEach((value) => {
                const indexedFile =
                    actionContext.sessionContext.agentContext.montage?.files[
                        value
                    ];

                // only count this index if it's not already been identified by file name
                if (indexedFile && intersection?.indexOf(indexedFile) === -1) {
                    selectedCount++;
                }
            });

            // report back to the user
            result = createActionResult(`Selected ${selectedCount} images.`);
            break;
        }

        case "listPhotos":
        case "findPhotos": {
            // provide status
            result = createActionResult("Searching photos...");

            // search for the images requested by the user
            if (
                actionContext.sessionContext.agentContext.imageCollection !==
                undefined
            ) {
                if (
                    action.parameters.search_filters &&
                    action.parameters.search_filters.length > 0
                ) {
                    await findRequestedImages(
                        action,
                        actionContext.sessionContext.agentContext,
                    );
                } else {
                    (action as FindPhotosAction).parameters.files =
                        actionContext.sessionContext.agentContext.imageCollection?.messages.map(
                            (img) =>
                                img.metadata.img.fileName.toLocaleLowerCase(),
                        );
                }
            } else {
                result = createActionResultFromError(
                    "Unable to search images, no image index available.",
                );
            }

            // TODO: update project state with this action
            // add found files to the montage
            actionContext.sessionContext.agentContext.montage!.files = [
                ...new Set([
                    ...actionContext.sessionContext.agentContext.montage!.files,
                    ...action.parameters.files!,
                ]),
            ];

            // send select to the visualizer/client
            actionContext.sessionContext.agentContext.viewProcess!.send(action);

            const count: number =
                actionContext.sessionContext.agentContext.montage!.files
                    .length - action.parameters.files!.length;
            let message = `Found ${action.parameters.files!.length} images. `;
            if (count > 0) {
                message += `New montage image count: ${actionContext.sessionContext.agentContext.montage!.files.length} images.`;
            }
            result = createActionResult(message);
            break;
        }

        case "showSearchParameters": {
            result = createActionResult(
                `Search parameters:\n${JSON.stringify(actionContext.sessionContext.agentContext.searchSettings)}`,
            );
            break;
        }

        case "setSearchParameters": {
            const settingsAction: SetSearchParametersAction =
                action as SetSearchParametersAction;

            actionContext.sessionContext.agentContext.searchSettings.minScore =
                settingsAction.parameters.minSearchScore
                    ? settingsAction.parameters.minSearchScore
                    : actionContext.sessionContext.agentContext.searchSettings
                          .minScore;
            actionContext.sessionContext.agentContext.searchSettings.exactMatch =
                settingsAction.parameters.exactMatch
                    ? settingsAction.parameters.exactMatch
                    : actionContext.sessionContext.agentContext.searchSettings
                          .exactMatch;

            result = createActionResult(
                `Updated search parameters to:\n${JSON.stringify(actionContext.sessionContext.agentContext.searchSettings)}`,
            );
            break;
        }

        case "startSlideShow": {
            if (process.platform == "win32") {
                // start the slide show
                startSlideShow(actionContext.sessionContext.agentContext);
                result = createActionResult(
                    `Showing ${actionContext.sessionContext.agentContext.montage?.title}.`,
                );
            } else {
                result = createActionResultFromError(
                    `This action is not supported on platform '${process.platform}'.`,
                );
            }

            break;
        }

        case "createNewMontage": {
            const newMontageAction: CreateMontageAction =
                action as CreateMontageAction;
            const newMontage: PhotoMontage = createNewMontage(
                actionContext.sessionContext.agentContext,
                newMontageAction.parameters.title,
            );

            // make the title the search terms
            if (
                newMontageAction.parameters.search_filters === undefined ||
                newMontageAction.parameters.search_filters.length == 0
            ) {
                if (
                    newMontageAction.parameters.title.toLocaleLowerCase() !==
                    "untitled"
                ) {
                    newMontageAction.parameters.search_filters = [
                        newMontageAction.parameters.title,
                    ];
                }
            }

            // add some images based on the montage title
            if (
                newMontageAction.parameters.search_filters &&
                newMontageAction.parameters.search_filters.length > 0
            ) {
                await findRequestedImages(
                    newMontageAction,
                    actionContext.sessionContext.agentContext,
                );
            }

            // add found files to the montage
            if (action.parameters.files !== undefined) {
                newMontage.files = [
                    ...new Set([
                        ...newMontage.files,
                        ...action.parameters.files!,
                    ]),
                ];
            }

            actionContext.sessionContext.agentContext.montages.push(newMontage);

            saveMontages(actionContext.sessionContext);

            // update montage state
            if (newMontageAction.parameters.focus === true) {
                actionContext.sessionContext.agentContext.montage = newMontage;
                actionContext.sessionContext.agentContext.viewProcess?.send(
                    actionContext.sessionContext.agentContext.montage!,
                );
                result = createActionResult("Created new montage", false, [
                    entityFromMontage(
                        actionContext.sessionContext.agentContext.montage,
                    ),
                ]);
            } else {
                result = createActionResultNoDisplay("Created new montage", [
                    entityFromMontage(newMontage),
                ]);
            }
            break;
        }

        case "deleteMontage": {
            const deleteMontageAction: DeleteMontageAction =
                action as DeleteMontageAction;
            const montageIds: number[] = deleteMontageAction.parameters.id
                ? deleteMontageAction.parameters.id
                : [-1];
            const deleteAll: boolean = deleteMontageAction.parameters.deleteAll
                ? deleteMontageAction.parameters.deleteAll
                : false;
            let deletedCount: number = 0;

            if (deleteAll) {
                deletedCount =
                    actionContext.sessionContext.agentContext.montages.length;
                actionContext.sessionContext.agentContext.montages = [];
                actionContext.sessionContext.agentContext.montage = undefined;
            } else if (deleteMontageAction.parameters.title !== undefined) {
                actionContext.sessionContext.agentContext.montages =
                    actionContext.sessionContext.agentContext.montages.filter(
                        (value) => {
                            if (
                                value.title.toLocaleLowerCase() ===
                                deleteMontageAction.parameters.title?.toLocaleLowerCase()
                            ) {
                                deletedCount++;
                                return false; // filter out
                            }

                            return true;
                        },
                    );
            } else {
                // no id/title specified, delete the active montage or the ones with the supplied ids
                if (actionContext.sessionContext.agentContext.montage) {
                    if (
                        montageIds.indexOf(
                            actionContext.sessionContext.agentContext.montage
                                ?.id,
                        ) !== -1
                    ) {
                        actionContext.sessionContext.agentContext.montage =
                            undefined;
                    }
                }

                deletedCount =
                    actionContext.sessionContext.agentContext.montages.length;
                actionContext.sessionContext.agentContext.montages =
                    actionContext.sessionContext.agentContext.montages.filter(
                        (value) => montageIds.indexOf(value.id) === -1,
                    );
                deletedCount -=
                    actionContext.sessionContext.agentContext.montages.length;
            }

            // save montage updates
            saveMontages(actionContext.sessionContext);

            result = createActionResult(`Deleted ${deletedCount} montages.`);

            // update montage state
            updateMontageViewerState(actionContext.sessionContext.agentContext);

            break;
        }

        case "switchMontage": {
            const switchMontageAction: SwitchMontageAction =
                action as SwitchMontageAction;

            if (switchMontageAction.parameters.id !== undefined) {
                const m: PhotoMontage | undefined =
                    actionContext.sessionContext.agentContext.montages.find(
                        (value) =>
                            value.id == switchMontageAction.parameters.id,
                    );

                if (m) {
                    actionContext.sessionContext.agentContext.montage = m;
                    result = createActionResult(`Switch montage to ${m.title}`);
                } else {
                    result = createActionResultFromError(
                        `Unable to switch montage, requested montage does not exist.`,
                    );
                }
            } else {
                const m: PhotoMontage | undefined =
                    actionContext.sessionContext.agentContext.montages.find(
                        (value) =>
                            value.title == switchMontageAction.parameters.title,
                    );

                if (m) {
                    actionContext.sessionContext.agentContext.montage = m;
                    result = createActionResult(`Switch montage to ${m.title}`);
                } else {
                    result = createActionResultFromError(
                        `Unable to switch montage, requested montage does not exist.`,
                    );
                }
            }

            // update montage state
            updateMontageViewerState(actionContext.sessionContext.agentContext);

            break;
        }

        case "listMontages": {
            if (actionContext.sessionContext.agentContext.montages.length > 0) {
                const names: string[] = [];
                actionContext.sessionContext.agentContext.montages.forEach(
                    (value) => names.push(`${value.id}: ${value.title}`),
                );

                displayResult(names, actionContext);

                result = createActionResultNoDisplay("done!");
            } else {
                result = createActionResult("There are no montages.");
            }

            break;
        }

        case "mergeMontages": {
            const mergeMontageAction: MergeMontageAction =
                action as MergeMontageAction;

            // create a new montage
            const merged = createNewMontage(
                actionContext.sessionContext.agentContext,
                mergeMontageAction.parameters.mergeMontageTitle,
            );

            let mergedCount: number = 0;
            mergeMontageAction.parameters.ids?.forEach((id) => {
                const montage: PhotoMontage | undefined =
                    actionContext.sessionContext.agentContext.montages.find(
                        (value) => value.id === id,
                    );
                merged.files = [...merged.files, ...montage!.files];
                mergedCount++;
            });

            mergeMontageAction.parameters.titles?.forEach((title) => {
                const montage: PhotoMontage | undefined =
                    actionContext.sessionContext.agentContext.montages.find(
                        (value) => value.title === title,
                    );
                if (montage !== undefined) {
                    merged.files = [...merged.files, ...montage.files];
                    mergedCount++;
                } else {
                    displayError(
                        `Unable to find a montage called '${title}', unable to merge it.`,
                        actionContext,
                    );
                }
            });

            // add the montage
            actionContext.sessionContext.agentContext.montages.push(merged);

            // save montage updates
            saveMontages(actionContext.sessionContext);

            // make this new montage the active montage
            actionContext.sessionContext.agentContext.montage = merged;

            // send select to the visualizer/client
            actionContext.sessionContext.agentContext.viewProcess!.send(merged);

            result = createActionResultNoDisplay(
                `Merged ${mergedCount} montages.`,
            );

            break;
        }
    }
    return result;
}

/**
 * Notifies the montage canvas to update with the supplied montage data (or reset)
 * @param context - The agent context
 */
function updateMontageViewerState(context: MontageActionContext) {
    // update montage state
    if (context.montage !== undefined) {
        context.viewProcess?.send(context.montage!);
    } else {
        context.viewProcess?.send({ actionName: "reset" });
    }
}

function createNewMontage(
    context: MontageActionContext,
    title: string = "",
): PhotoMontage {
    // create a new montage
    return {
        id: context.montageIdSeed++,
        title: title.length == 0 ? "Untitled" : title,
        files: [],
        selected: [],
    };
}

/**
 * Creates an entity for conversation memory based on the supplied montage
 * @param montage - The montage to create an entity for
 */
function entityFromMontage(montage: PhotoMontage) {
    return {
        name: montage.title,
        type: ["project", "montage"],
        uniqueId: montage.id.toString(),
        facets: [
            {
                name: "status",
                value: "This montage has been created but not editited. Awaiting review.",
            },
        ],
    };
}

async function findRequestedImages(
    action:
        | ListPhotosAction
        | FindPhotosAction
        | SelectPhotosAction
        | RemovePhotosAction
        | CreateMontageAction,
    context: MontageActionContext,
    exactMatch: boolean = false,
) {
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
                    //knowledgeType: "entity"
                },
                // options
                {
                    exactMatch: exactMatch,
                    usePropertyIndex: true,
                    useTimestampIndex: true,
                },
            );

            const imageFiles: Set<string> = new Set<string>();

            debug(
                `Found ${matches?.size} matches for: ${action.parameters.search_filters}`,
            );

            matches?.forEach((match: kp.SemanticRefSearchResult) => {
                match.semanticRefMatches.forEach(
                    (value: kp.ScoredSemanticRefOrdinal) => {
                        if (value.score >= context.searchSettings.minScore) {
                            const semanticRef: kp.SemanticRef | undefined =
                                context.imageCollection!.semanticRefs[
                                    value.semanticRefOrdinal
                                ];
                            if (semanticRef) {
                                if (semanticRef.knowledgeType === "entity") {
                                    const entity: kpLib.ConcreteEntity =
                                        semanticRef.knowledge as kpLib.ConcreteEntity;

                                    // did we get a direct hit on an image?
                                    if (entity.type.includes("image")) {
                                        const f: Facet | undefined =
                                            entity.facets?.find((v) => {
                                                return v.name === "File Name";
                                            });

                                        if (f?.value) {
                                            imageFiles.add(
                                                f?.value
                                                    .toString()
                                                    .toLocaleLowerCase(),
                                            );
                                        }
                                    } else {
                                        // for non-images trace it back to the originating image and add that
                                        const imgRange: kp.TextLocation =
                                            semanticRef.range.start;
                                        const img: im.Image =
                                            context.imageCollection!.messages[
                                                imgRange.messageOrdinal
                                            ];

                                        imageFiles.add(
                                            img.metadata.fileName.toLocaleLowerCase(),
                                        );
                                    }
                                } else if (
                                    semanticRef.knowledgeType === "action"
                                ) {
                                    const imgRange: kp.TextLocation =
                                        semanticRef.range.start;
                                    const img: im.Image =
                                        context.imageCollection!.messages[
                                            imgRange.messageOrdinal
                                        ];
                                    imageFiles.add(
                                        img.metadata.fileName.toLocaleLowerCase(),
                                    );
                                } else if (
                                    semanticRef.knowledgeType === "tag"
                                ) {
                                    // TODO: implement
                                } else if (
                                    semanticRef.knowledgeType === "topic"
                                ) {
                                    // TODO: implement
                                    debug("topic");
                                }
                            }
                        }
                    },
                );
            });

            action.parameters.files = [...imageFiles];
        }
    }
}

function filterToSearchTerm(filters: string[]): kp.SearchTerm[] {
    let terms: kp.SearchTerm[] = [];
    filters.forEach((value) => terms.push({ term: { text: value } }));

    return terms;
}

export async function createViewServiceHost(
    montageUpdatedCallback: (montage: PhotoMontage) => void,
) {
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
                        const mon: PhotoMontage | undefined =
                            message as PhotoMontage;
                        if (mon) {
                            montageUpdatedCallback(mon);
                        }
                    }
                });

                childProcess.on("exit", (code) => {
                    debug("Montage view server exited with code:", code);
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
    if (context.agentContext.montage !== undefined) {
        const index: number = context.agentContext.montages.findIndex(
            (value, index) => {
                return value.id === context.agentContext.montage?.id;
            },
        );

        // if we didn't find the montage in the listed montages we add the working montage to the list
        // or update it if we did find it
        if (index > -1) {
            context.agentContext.montages[index] = context.agentContext.montage;
        } else {
            context.agentContext.montages.push(context.agentContext.montage);
        }
    }

    // save the montages for later
    await context.sessionStorage?.write(
        montageFile,
        JSON.stringify({
            montageIdSeed: context.agentContext.montageIdSeed,
            montages: context.agentContext.montages,
        }),
    );
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
    context.montage?.files.forEach((file) =>
        copyFileSync(file, path.join(slideShowDir, path.basename(file))),
    );

    // update slideshow screen saver directory
    // const key = new Registry({
    //     hive: Registry.HKCU,
    //     key: "Software\\Microsoft\\Windows Photo Viewer\\Slideshow\\Screensaver",
    // });

    // create the key if it doesn't exist
    // BUGBUG - winreg does NOT work if the key has spaces in it
    // https://github.com/fresc81/node-winreg
    // there's a pending PR to fix but no response from the author so we just do it manually here ourselves
    spawnSync("reg", [
        "add",
        "HKCU\\Software\\Microsoft\\Windows Photo Viewer\\Slideshow\\ScreenSaver",
    ]);
    // key.create((err) => {
    //     // remove spanSync once win-reg get's updated
    // });

    // set the registry value
    const pidl = createEncryptedPIDLFromPath(slideShowDir);
    if (pidl) {
        spawnSync("reg", [
            "add",
            "HKCU\\Software\\Microsoft\\Windows Photo Viewer\\Slideshow\\ScreenSaver",
            "/v",
            "EncryptedPIDL",
            "/t",
            "REG_SZ",
            "/d",
            pidl,
            "/f",
        ]);

        // fast
        spawnSync("reg", [
            "add",
            "HKCU\\Software\\Microsoft\\Windows Photo Viewer\\Slideshow\\ScreenSaver",
            "/v",
            "Speed",
            "/t",
            "REG_DWORD",
            "/d",
            "2",
            "/f",
        ]);

        // shuffle
        spawnSync("reg", [
            "add",
            "HKCU\\Software\\Microsoft\\Windows Photo Viewer\\Slideshow\\ScreenSaver",
            "/v",
            "Shuffle",
            "/t",
            "REG_DWORD",
            "/d",
            "1",
            "/f",
        ]);
        // key.set("EncryptedPIDL", "REG_SZ", pidl, (err) => {
        //     if (err) {
        //         console.error("Error reading registry value:", err);
        //     }
        // });

        // key.set("Shuffle", "REG_DWORD", "1", () => {}); // randomize
        // key.set("Speed", "REG_DWORD", "2", () => {});   // "fast"
    }

    // start slideshow screen saver
    try {
        spawn(`${process.env["SystemRoot"]}\\System32\\PhotoScreensaver.scr`, [
            "/s",
        ]);
    } catch (e) {
        debug(e);
    }
}

/**
 * Creats an encrypted PIDL for use with the Photo Viewer slideshow screensaver
 * @param path - The path of the PIDL to create and encrypt
 * @returns - The encrypted PIDL
 */
function createEncryptedPIDLFromPath(path: string) {
    if (
        ILCreateFromPathW !== undefined &&
        CryptBinaryToStringW !== undefined &&
        ILGetSize !== undefined &&
        ILFree !== undefined
    ) {
        const pidl = ILCreateFromPathW(path);
        const size: number = ILGetSize(pidl);

        let stringBuffer = [" ".repeat(2048)];
        let bufferSize = [2048];
        if (!CryptBinaryToStringW(pidl, size, 1, stringBuffer, bufferSize)) {
            debug(`ERROR encrypting PIDL for ${path}`);
        }

        ILFree(pidl);

        return stringBuffer[0];
    }

    return undefined;
}

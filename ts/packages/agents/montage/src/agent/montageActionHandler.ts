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
    FindPhotosAction,
    ListPhotosAction,
    MontageAction,
    RemovePhotosAction,
    SelectPhotosAction,
} from "./montageActionSchema.js";
import {
    createActionResult,
    createActionResultFromError,
    createActionResultNoDisplay,
} from "@typeagent/agent-sdk/helpers/action";
import * as im from "image-memory";
import * as kp from "knowpro";
import { conversation as kpLib } from "knowledge-processor";
import { copyFileSync, existsSync, mkdirSync, rmdirSync } from "node:fs";
//import Registry from "winreg";
import koffi from "koffi";
import {
    displayError,
    displayResult,
} from "@typeagent/agent-sdk/helpers/display";
import registerDebug from "debug";
import { spawnSync } from "node:child_process";
import { createSemanticMap } from "typeagent";
import { openai, TextEmbeddingModel } from "aiclient";

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
    activeMontageId: number;
    imageCollection: im.ImageCollection | undefined;
    viewProcess: ChildProcess | undefined;
    searchSettings: {
        minScore: number;
        exactMatch: boolean;
    };
    indexes: im.IndexData[];
    fuzzyMatchingModel: TextEmbeddingModel | undefined;
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
            minScore: 0.5, // TODO tune?
            exactMatch: false,
        },

        getActiveMontage,
    };
}

/*
 * Returns the active (i.e. the montage being shown) montage
 */
function getActiveMontage(
    context: MontageActionContext,
): PhotoMontage | undefined {
    return context.montages.find((value) => {
        return value.id === context.activeMontageId;
    });
}

/*
 * Gets a unique montage ID
 */
function getUniqueMontageId(context: MontageActionContext) {
    let maxId = -1;

    context.montages.forEach((m) => {
        if (m.id > maxId) {
            maxId = m.id;
        }
    });

    return maxId + 1;
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
    const agentContext = context.agentContext;
    if (enable) {
        // Load all montages from disk
        agentContext.montages = [];
        agentContext.montageIdSeed = NaN;
        if (await context.sessionStorage?.exists(montageFile)) {
            const data = await context.sessionStorage?.read(
                montageFile,
                "utf8",
            );
            if (data) {
                const d = JSON.parse(data);
                // context.agentContext.montageIdSeed = d.montageIdSeed
                //     ? d.montageIdSeed
                //     : 0;
                agentContext.montages = d.montages;
            }
        }

        // if there are montages, load the last one otherwise create a new one
        if (agentContext.montages.length > 0) {
            agentContext.activeMontageId =
                agentContext.montages[agentContext.montages.length - 1].id;
        } else {
            agentContext.activeMontageId = -1;
        }

        // Load the image index from disk
        if (!agentContext.imageCollection) {
            agentContext.indexes = await context.indexes("image");

            // TODO: allow the montage agent to switch between image indexes
            // TODO: handle the case where the image index is locked
            // TODO: handle image index that has been updated since we loaded it
            if (agentContext.indexes.length > 0) {
                // For now just load the first image index
                agentContext.imageCollection =
                    await im.ImageCollection.readFromFile(
                        agentContext.indexes[0].path,
                        "index",
                    );
            } else {
                debug(
                    "Unable to load image index, please create one using the @index.",
                );
            }
        }

        // Start the montage rendering host
        if (!agentContext.viewProcess) {
            agentContext.viewProcess = await createViewServiceHost(
                (montage: PhotoMontage) => {
                    // replace the active montage with the one we just got from the client
                    if (agentContext.activeMontageId > -1) {
                        // remove the active montage
                        agentContext.montages = agentContext.montages.filter(
                            (value) => value.id != agentContext.activeMontageId,
                        );

                        // push the received montage onto the stack
                        montage.id = agentContext.activeMontageId;
                        agentContext.montages.push(montage);
                    }
                },
            );

            // send initial state and allowed folder(s)
            if (agentContext.activeMontageId > -1) {
                const folders: string[] = [];
                agentContext.indexes.forEach((idx) => {
                    folders.push(idx.location);
                });

                // send the folder info
                const indexPath = path.join(
                    agentContext.indexes[0].path,
                    "cache",
                );
                folders.push(indexPath);
                agentContext.viewProcess?.send({
                    folders: {
                        allowedFolders: folders,
                        indexCachePath: indexPath,
                        indexedLocation: agentContext.indexes[0].location,
                    },
                });

                agentContext.viewProcess?.send(getActiveMontage(agentContext)!);
            }
        }

        // create the embedding model for fuzzy matching
        if (!agentContext.fuzzyMatchingModel) {
            agentContext.fuzzyMatchingModel = openai.createEmbeddingModel();
        }
    } else {
        // shut down service
        if (agentContext.viewProcess) {
            agentContext.viewProcess.kill();
        }
    }
}

async function handleMontageAction(
    action: MontageAction,
    actionContext: ActionContext<MontageActionContext>,
) {
    let result: ActionResult | undefined = undefined;
    const agentContext = actionContext.sessionContext.agentContext;
    if (!agentContext.viewProcess) {
        return createActionResultFromError(
            `Unable to perform the requested action. Disconnected from the canvas.`,
        );
    } else if (!agentContext.imageCollection) {
        return createActionResultFromError(
            "No image index has been loaded! Please create one with the @index command.",
        );
    }

    switch (action.actionName) {
        // TODO: undo action?
        case "changeTitle": {
            agentContext.viewProcess!.send(action);
            result = createActionResult(
                `Changed title to ${action.parameters.title}`,
            );
            break;
        }

        case "clearSelectedPhotos": {
            agentContext.viewProcess!.send(action);
            result = createActionResult(`Cleared the selection`);
            break;
        }

        case "removePhotos": {
            // provide status
            result = createActionResult("Removed requested images.");

            // search for the images requested by the user
            if (action.parameters.search_filters) {
                await findRequestedImages(action, agentContext);
            } else {
                result = createActionResultFromError(
                    "Unable to search images, no image index available.",
                );
            }

            // send select to the visualizer/client
            agentContext.viewProcess!.send(action);

            result = createActionResult(`Removing requested images.`);
            break;
        }

        case "selectPhotos": {
            // provide status
            result = createActionResult("Selecting...");

            // search for the images requested by the user
            if (action.parameters.search_filters) {
                await findRequestedImages(action, agentContext);
            } else {
                result = createActionResultFromError(
                    "Unable to search images, no image index available. Please run the image indexer before manipulating montages.",
                );
            }

            // send select to the visualizer/client
            agentContext.viewProcess!.send(action);

            let selectedCount: number = 0;
            // what is the intersection of the images in the montage and what we found in the search...that is the selection
            // go through the files by name
            const activeMontage = getActiveMontage(agentContext);
            const intersection = action.parameters.files?.filter((item1) =>
                activeMontage?.files.some((item2) => item1 === item2),
            );
            if (intersection) {
                selectedCount += intersection?.length;
            }

            action.parameters.indices?.forEach((value) => {
                const indexedFile = activeMontage?.files[value];
                debug(indexedFile);
                // only count this index if it's not already been identified by file name
                if (
                    indexedFile &&
                    (intersection === undefined ||
                        intersection.indexOf(indexedFile) === -1)
                ) {
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
            if (agentContext.imageCollection !== undefined) {
                if (
                    action.parameters.search_filters &&
                    action.parameters.search_filters.length > 0
                ) {
                    await findRequestedImages(action, agentContext);
                } else {
                    action.parameters.files =
                        agentContext.imageCollection?.messages
                            .getAll()
                            .map((img) =>
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
            const montage = getActiveMontage(agentContext);
            if (montage === undefined) {
                return createActionResultFromError(
                    "No active montage to add images to.",
                );
            }
            montage.files = [
                ...new Set([...montage.files, ...action.parameters.files!]),
            ];

            // send select to the visualizer/client
            agentContext.viewProcess!.send(action);

            const fileCount = montage.files.length;
            const count: number = fileCount - action.parameters.files!.length;
            let message = `Found ${action.parameters.files!.length} images. `;
            if (count > 0) {
                message += `New montage image count: ${fileCount} images.`;
            }
            result = createActionResult(message);
            break;
        }

        case "showSearchParameters": {
            result = createActionResult(
                `Search parameters:\n${JSON.stringify(agentContext.searchSettings)}`,
            );
            break;
        }

        case "setSearchParameters": {
            agentContext.searchSettings.minScore = action.parameters
                .minSearchScore
                ? action.parameters.minSearchScore
                : agentContext.searchSettings.minScore;
            agentContext.searchSettings.exactMatch = action.parameters
                .exactMatch
                ? action.parameters.exactMatch
                : agentContext.searchSettings.exactMatch;

            result = createActionResult(
                `Updated search parameters to:\n${JSON.stringify(agentContext.searchSettings)}`,
            );
            break;
        }

        case "startSlideShow": {
            if (process.platform == "win32") {
                // start the slide show
                startSlideShow(agentContext);
                result = createActionResult(
                    `Showing ${getActiveMontage(agentContext)?.title}.`,
                );
            } else {
                result = createActionResultFromError(
                    `This action is not supported on platform '${process.platform}'.`,
                );
            }

            break;
        }

        case "createNewMontage": {
            const montage = createNewMontage(
                agentContext,
                action.parameters.title,
            );

            // make the title the search terms
            if (
                action.parameters.search_filters === undefined ||
                action.parameters.search_filters.length == 0
            ) {
                if (
                    action.parameters.title.toLocaleLowerCase() !== "untitled"
                ) {
                    action.parameters.search_filters = [
                        action.parameters.title,
                    ];
                }
            }

            // add some images based on the montage title
            if (
                action.parameters.search_filters &&
                action.parameters.search_filters.length > 0
            ) {
                await findRequestedImages(action, agentContext);
            }

            // add found files to the montage
            if (
                action.parameters.files !== undefined &&
                action.parameters.files.length > 0
            ) {
                debug(
                    `Adding files to montage '${montage.title}': ${action.parameters.files.join(",")}`,
                );
                montage.files = [
                    ...new Set([...montage.files, ...action.parameters.files]),
                ];
            }

            debug(montage);
            saveMontages(actionContext.sessionContext);

            // update montage state
            if (action.parameters.focus === true) {
                agentContext.viewProcess?.send(getActiveMontage(agentContext)!);
                result = createActionResult("Created new montage", false, [
                    entityFromMontage(getActiveMontage(agentContext)!),
                ]);
            } else {
                result = createActionResultNoDisplay("Created new montage", [
                    entityFromMontage(getActiveMontage(agentContext)!),
                ]);
            }
            break;
        }

        case "deleteMontage": {
            const montageIds: number[] = action.parameters.id
                ? action.parameters.id
                : [-1];
            const deleteAll: boolean = action.parameters.deleteAll
                ? action.parameters.deleteAll
                : false;
            let deletedCount: number = 0;

            if (deleteAll) {
                deletedCount = agentContext.montages.length;
                agentContext.montages = [];
                agentContext.activeMontageId = -1;
            } else if (action.parameters.title !== undefined) {
                agentContext.montages = agentContext.montages.filter(
                    (value) => {
                        if (
                            value.title.toLocaleLowerCase() ===
                            action.parameters.title?.toLocaleLowerCase()
                        ) {
                            deletedCount++;
                            return false; // filter out
                        }

                        return true;
                    },
                );
            } else {
                // no id/title specified, delete the active montage or the ones with the supplied ids
                if (agentContext.activeMontageId > -1) {
                    if (
                        montageIds.indexOf(agentContext.activeMontageId) !== -1
                    ) {
                        agentContext.activeMontageId = -1;
                    }
                }

                deletedCount = agentContext.montages.length;
                agentContext.montages = agentContext.montages.filter(
                    (value) => montageIds.indexOf(value.id) === -1,
                );
                deletedCount -= agentContext.montages.length;
            }

            // save montage updates
            saveMontages(actionContext.sessionContext);

            result = createActionResult(`Deleted ${deletedCount} montages.`);

            // update montage state
            updateMontageViewerState(agentContext);

            break;
        }

        case "switchMontage": {
            if (action.parameters.id !== undefined) {
                const m: PhotoMontage | undefined = agentContext.montages.find(
                    (value) => value.id == action.parameters.id,
                );

                if (m) {
                    agentContext.activeMontageId = m.id;
                    result = createActionResult(`Switch montage to ${m.title}`);
                } else {
                    result = createActionResultFromError(
                        `Unable to switch montage, requested montage (id = ${action.parameters.id}) does not exist.`,
                    );
                }
            } else {
                let m: PhotoMontage | undefined = agentContext.montages.find(
                    (value) => value.title == action.parameters.title,
                );

                if (!m) {
                    // try fuzzy matching
                    m = await getMontageByFuzzyMatching(
                        action.parameters.title,
                        agentContext.montages,
                        agentContext.fuzzyMatchingModel,
                    );
                }

                if (m) {
                    agentContext.activeMontageId = m.id;
                    result = createActionResult(`Switch montage to ${m.title}`);
                } else {
                    result = createActionResultFromError(
                        `Unable to switch montage, requested montage does not exist.`,
                    );
                }
            }

            // update montage state
            updateMontageViewerState(agentContext);

            break;
        }

        case "listMontages": {
            if (agentContext.montages.length > 0) {
                const names: string[] = [];
                agentContext.montages.forEach((value) =>
                    names.push(`${value.id}: ${value.title}`),
                );

                displayResult(names, actionContext);

                result = createActionResultNoDisplay("done!");
            } else {
                result = createActionResult("There are no montages.");
            }

            break;
        }

        case "mergeMontages": {
            // create a new montage
            const activeMontage = createNewMontage(
                agentContext,
                action.parameters.mergeMontageTitle,
            );

            let mergedCount: number = 0;
            action.parameters.ids?.forEach((id) => {
                const montage: PhotoMontage | undefined =
                    agentContext.montages.find((value) => value.id === id);
                activeMontage.files = [
                    ...activeMontage.files,
                    ...montage!.files,
                ];
                mergedCount++;
            });

            action.parameters.titles?.forEach((title) => {
                const montage: PhotoMontage | undefined =
                    agentContext.montages.find(
                        (value) => value.title === title,
                    );
                if (montage !== undefined) {
                    activeMontage.files = [
                        ...activeMontage.files,
                        ...montage.files,
                    ];
                    mergedCount++;
                } else {
                    displayError(
                        `Unable to find a montage called '${title}', unable to merge it.`,
                        actionContext,
                    );
                }
            });

            // save montage updates
            saveMontages(actionContext.sessionContext);

            // send select to the visualizer/client
            agentContext.viewProcess!.send(getActiveMontage(agentContext)!);

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
    const activeMontage = getActiveMontage(context);

    // update montage state
    if (activeMontage !== undefined) {
        context.viewProcess?.send(activeMontage);
    } else {
        context.viewProcess?.send({ actionName: "reset" });
    }
}

/*
 *  Creates a new Montage and adds it to the agent context.
 */
function createNewMontage(
    context: MontageActionContext,
    title: string = "",
): PhotoMontage {
    // create a new montage
    const newMontage: PhotoMontage = {
        id: getUniqueMontageId(context),
        title: title.length == 0 ? "Untitled" : title,
        files: [],
        selected: [],
    };

    // add the montage to the context
    context.montages.push(newMontage);

    // make this the active montage
    context.activeMontageId = newMontage.id;

    return newMontage;
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
                },
            );

            const imageFiles: Set<string> = new Set<string>();

            debug(
                `Found ${matches?.size} matches for: ${action.parameters.search_filters}`,
            );

            matches?.forEach((match: kp.SemanticRefSearchResult) => {
                match.semanticRefMatches.forEach(
                    (value: kp.ScoredSemanticRefOrdinal) => {
                        debug(value);
                        if (value.score >= context.searchSettings.minScore) {
                            const semanticRef: kp.SemanticRef | undefined =
                                context.imageCollection!.semanticRefs.get(
                                    value.semanticRefOrdinal,
                                );
                            if (semanticRef) {
                                if (semanticRef.knowledgeType === "entity") {
                                    const entity: kpLib.ConcreteEntity =
                                        semanticRef.knowledge as kpLib.ConcreteEntity;

                                    // did we get a direct hit on an image?
                                    if (entity.type.includes("image")) {
                                        const f: kpLib.Facet | undefined =
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
                                            context.imageCollection!.messages.get(
                                                imgRange.messageOrdinal,
                                            );

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
                                        context.imageCollection!.messages.get(
                                            imgRange.messageOrdinal,
                                        );
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

            if (imageFiles.size > 0) {
                debug(`Adding ${imageFiles.size} images to montage.`);
                action.parameters.files = [...imageFiles];
            }
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

/*
 * Writes the montages to disk.
 */
async function saveMontages(context: SessionContext<MontageActionContext>) {
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
    const montage = getActiveMontage(context);

    // no montage = no slide show
    if (montage === undefined) {
        return;
    }

    montage.files.forEach((file) =>
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

async function getMontageByFuzzyMatching(
    fuzzyTitle: string | undefined,
    montages: PhotoMontage[],
    model: TextEmbeddingModel | undefined,
): Promise<PhotoMontage | undefined> {
    if (fuzzyTitle === undefined) {
        return undefined;
    }

    const map = await createSemanticMap<PhotoMontage>(model);
    await map.setMultiple(montages.map((pm) => [pm.title, pm]));

    const scoredResults = await map.getNearest(fuzzyTitle);

    if (scoredResults?.item && scoredResults.score > 0.5) {
        return scoredResults?.item;
    } else {
        return undefined;
    }
}

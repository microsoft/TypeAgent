// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAgent,
    SessionContext,
    ActionResult,
    TypeAgentAction,
    AppAgentInitSettings,
} from "@typeagent/agent-sdk";
import { ChildProcess, fork, spawn } from "child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
    CreateMontageAction,
    AddPhotosAction,
    MontageAction,
    RemovePhotosAction,
    SelectPhotosAction,
    MontageActivity,
    Montage,
} from "./montageActionSchema.js";
import {
    createActionResult,
    createActionResultFromError,
    createActionResultFromMarkdownDisplay,
} from "@typeagent/agent-sdk/helpers/action";
import * as im from "image-memory";
import * as kp from "knowpro";
import { conversation as kpLib } from "knowledge-processor";
import { copyFileSync, existsSync, mkdirSync, rmdirSync } from "node:fs";
//import Registry from "winreg";
import koffi from "koffi";
import {
    displayError,
    displayStatus,
} from "@typeagent/agent-sdk/helpers/display";
import registerDebug from "debug";
import { spawnSync } from "node:child_process";
import { createSemanticMap } from "typeagent";
import { openai, TextEmbeddingModel } from "aiclient";
import { ResolveEntityResult } from "../../../../agentSdk/dist/agentInterface.js";

const debug = registerDebug("typeagent:agent:montage");

export function instantiate(): AppAgent {
    return {
        initializeAgentContext: initializeMontageContext,
        updateAgentContext: updateMontageContext,
        resolveEntity,
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
    imageCollection?: im.ImageCollection | undefined;
    viewProcess?: ChildProcess | undefined;
    localHostPort: number;
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

async function resolveEntity(
    type: string,
    name: string,
    context: SessionContext<MontageActionContext>,
): Promise<ResolveEntityResult | undefined> {
    const agentContext = context.agentContext;
    if (type === "Montage") {
        const montage = await findMontageByTitle(name, agentContext);
        if (montage) {
            return {
                entity: entityFromMontage(montage),
            };
        }
    }
    return undefined;
}

async function executeMontageAction(
    action: TypeAgentAction<MontageAction | MontageActivity>,
    context: ActionContext<MontageActionContext>,
) {
    const agentContext = context.sessionContext.agentContext;
    const lastActiveMontage = getActiveMontage(agentContext);
    const result = await handleMontageAction(action, context);
    const currentActiveMontage = getActiveMontage(agentContext);
    if (lastActiveMontage !== currentActiveMontage) {
        // if the active montage has changed, update the viewer
        updateMontageViewerState(agentContext);
    }

    if (result.error === undefined) {
        let activityName = "edit";
        let verb = "Editing";

        if (action.actionName === "createNewMontage") {
            activityName = "create";
            verb = "Created new";
        }

        if (
            action.actionName === "startEditMontage" ||
            action.actionName === "createNewMontage" ||
            (context.activityContext !== undefined &&
                context.activityContext.state.title !==
                    currentActiveMontage?.title)
        ) {
            result.activityContext =
                currentActiveMontage !== undefined
                    ? {
                          activityName: activityName,
                          description: `${verb} montage ${currentActiveMontage.title}`,
                          state: {
                              title: currentActiveMontage.title,
                          },
                          openLocalView: true,
                      }
                    : null;
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

async function initializeMontageContext(
    settings?: AppAgentInitSettings,
): Promise<MontageActionContext> {
    const localHostPort = settings?.localHostPort;
    if (localHostPort === undefined) {
        throw new Error("Local view port not assigned.");
    }
    return {
        // default search settings
        searchSettings: {
            minScore: 0.5, // TODO tune?
            exactMatch: false,
        },
        localHostPort,
        montageIdSeed: NaN,
        montages: [],
        activeMontageId: -1,
        fuzzyMatchingModel: undefined,
        indexes: [],
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
        agentContext.activeMontageId = -1;
        if (await context.sessionStorage?.exists(montageFile)) {
            const data = await context.sessionStorage?.read(
                montageFile,
                "utf8",
            );
            if (data) {
                const d = JSON.parse(data);
                agentContext.activeMontageId = d.activeMontageId;
                agentContext.montages = d.montages;
            }
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
                agentContext.localHostPort,
            );

            const folders: string[] = [];
            agentContext.indexes.forEach((idx) => {
                folders.push(idx.location);
            });

            // send the folder info
            const indexPath = path.join(agentContext.indexes[0].path, "cache");
            folders.push(indexPath);
            agentContext.viewProcess?.send({
                folders: {
                    allowedFolders: folders,
                    indexCachePath: indexPath,
                    indexedLocation: agentContext.indexes[0].location,
                },
            });

            // send initial state and allowed folder(s)
            if (agentContext.activeMontageId > -1) {
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
    action: TypeAgentAction<MontageAction | MontageActivity>,
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

    const updateViewWithAction = (
        montage: PhotoMontage,
        action: TypeAgentAction<MontageAction | MontageActivity>,
    ) => {
        if (montage.id === agentContext.activeMontageId) {
            agentContext.viewProcess!.send(action);
        }
    };
    switch (action.actionName) {
        // TODO: undo action?
        case "changeTitle": {
            const montage = await ensureActionMontage(agentContext, action);
            montage.title = action.parameters.newTitle;
            saveMontages(actionContext.sessionContext);

            updateViewWithAction(montage, action);
            result = createActionResult(
                `Changed title to ${action.parameters.newTitle}`,
                false,
                [entityFromMontage(montage)],
            );
            break;
        }

        case "clearSelectedPhotos": {
            const montage = await ensureActiveMontage(agentContext, action);
            agentContext.viewProcess!.send(action);
            result = createActionResult(`Cleared the selection`, false, [
                entityFromMontage(montage),
            ]);
            break;
        }

        case "removePhotos": {
            // TODO: Support updating non-active montages
            const montage = await ensureActiveMontage(agentContext, action);
            // provide status
            displayStatus("Removing requested images.", actionContext);

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

            result = createActionResult(`Removed requested images.`, false, [
                entityFromMontage(montage),
            ]);
            break;
        }

        case "selectPhotos": {
            // provide status
            displayStatus("Selecting...", actionContext);

            const montage = await ensureActionMontage(agentContext, action);
            // if the montage is not the active one, switch to it
            agentContext.activeMontageId = montage.id;

            // search for the images requested by the user
            if (action.parameters.search_filters) {
                await findRequestedImages(action, agentContext);
            } else {
                result = createActionResultFromError(
                    "Unable to search images, no image index available. Please run the image indexer before manipulating montages.",
                );
            }

            // send select to the visualizer/client
            updateViewWithAction(montage, action);

            let selectedCount: number = 0;
            // what is the intersection of the images in the montage and what we found in the search...that is the selection
            // go through the files by name
            const intersection = action.parameters.files?.filter((item1) =>
                montage?.files.some((item2) => item1 === item2),
            );
            if (intersection) {
                selectedCount += intersection?.length;
            }

            action.parameters.indices?.forEach((value) => {
                const indexedFile = montage?.files[value];
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

        case "addPhotos": {
            const montage = await ensureActionMontage(agentContext, action);
            // provide status
            displayStatus("Searching photos...", actionContext);

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

            montage.files = [
                ...new Set([...montage.files, ...action.parameters.files!]),
            ];

            // send select to the visualizer/client
            updateViewWithAction(montage, action);

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
                const montage = await ensureActionMontage(agentContext, action);
                // start the slide show
                startSlideShow(montage, agentContext);
                result = createActionResult(
                    `Showing ${montage.title}.`,
                    false,
                    [entityFromMontage(montage)],
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
                // make this the active montage
                agentContext.activeMontageId = montage.id;
            }

            result = createActionResult("Created new montage", false, [
                entityFromMontage(montage),
            ]);
            break;
        }

        case "deleteAllMontages":
            const deletedCount = agentContext.montages.length;
            agentContext.montages = [];
            // save montage updates
            saveMontages(actionContext.sessionContext);

            result = createActionResult(`Deleted ${deletedCount} montages.`);

            break;

        case "deleteMontage": {
            let deletedCount: number = 0;

            agentContext.montages = agentContext.montages.filter((value) => {
                if (
                    value.title.toLocaleLowerCase() ===
                    action.parameters.title?.toLocaleLowerCase()
                ) {
                    deletedCount++;
                    return false; // filter out
                }

                return true;
            });

            // save montage updates
            saveMontages(actionContext.sessionContext);

            result = createActionResult(`Deleted ${deletedCount} montages.`);

            break;
        }

        case "startEditMontage": {
            const montage = await ensureActionMontage(agentContext, action);

            agentContext.activeMontageId = montage.id;
            result = createActionResult(
                `Editing montage ${montage.title}`,
                false,
                [entityFromMontage(montage)],
            );
            break;
        }

        case "listMontages": {
            if (agentContext.montages.length > 0) {
                const names: string[] = [];
                agentContext.montages.forEach((value) =>
                    names.push(`- ${value.title}`),
                );

                result = createActionResultFromMarkdownDisplay(
                    names.join("\n"),
                    agentContext.montages.map((m) => entityFromMontage(m)),
                );
            } else {
                result = createActionResult("There are no montages.");
            }

            break;
        }

        case "mergeMontages": {
            // create a new montage
            const activeMontage = createNewMontage(
                agentContext,
                action.parameters.mergedMontageTitle,
            );
            agentContext.activeMontageId = activeMontage.id;

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

            result = createActionResult(`Merged ${mergedCount} montages.`);
            break;
        }
    }
    return result;
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

    return newMontage;
}

/**
 * Creates an entity for conversation memory based on the supplied montage
 * @param montage - The montage to create an entity for
 */
function entityFromMontage(montage: PhotoMontage) {
    return {
        name: montage.title,
        type: ["Montage", "project"],
        uniqueId: montage.id.toString(),
        facets: [
            {
                name: "status",
                value: "This montage has been created but not edited. Awaiting review.",
            },
        ],
    };
}

async function findRequestedImages(
    action:
        | AddPhotosAction
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
                debug(
                    `Filtered to ${imageFiles.size} images for ${action.actionName} action.`,
                );
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

async function findMontageByTitle(
    title: string,
    agentContext: MontageActionContext,
): Promise<PhotoMontage | undefined> {

    // no montages
    if (agentContext.montages.length === 0) {
        return undefined;
    }

    // Try exact match
    const montage = agentContext.montages.find((value) => value.title == title);
    if (montage) {
        debug(`Found montage ${montage.title} by title`);
        return montage;
    }

    // Try fuzzy match
    const fuzzyMontage = await getMontageByFuzzyMatching(
        title,
        agentContext.montages,
        agentContext.fuzzyMatchingModel,
    );

    debug(
        fuzzyMontage
            ? `Found montage ${fuzzyMontage.title} by fuzzy matching with ${title}`
            : `Unable to find montage ${title}`,
    );

    return fuzzyMontage;
}

async function getActionMontage(
    agentContext: MontageActionContext,
    action: TypeAgentAction<{
        actionName: string;
        parameters: { title: string };
    }>,
) {
    const entity = action.entities?.title;
    if (entity) {
        const montage = agentContext.montages.find((value) => {
            return value.id.toString() === entity.uniqueId;
        });

        debug(
            montage
                ? `Found montage ${montage.title} by entity id ${entity.uniqueId}`
                : `Unable to find montage by entity id ${entity.uniqueId}`,
        );

        return montage;
    }
    return findMontageByTitle(action.parameters.title, agentContext);
}

async function ensureActionMontage(
    agentContext: MontageActionContext,
    action: TypeAgentAction<{
        actionName: string;
        parameters: { title: string };
    }>,
) {
    const m = await getActionMontage(agentContext, action);
    if (!m) {
        throw new Error(`Unable to find montage '${action.parameters.title}'`);
    }
    return m;
}

async function ensureActiveMontage(
    agentContext: MontageActionContext,
    action: TypeAgentAction<{
        actionName: string;
        parameters: { title: string };
    }>,
) {
    const m = await ensureActionMontage(agentContext, action);
    if (m.id !== agentContext.activeMontageId) {
        throw new Error(
            `Unable to perform action on montage '${action.parameters.title}', it is not the active montage.`,
        );
    }
    return m;
}

export async function createViewServiceHost(
    montageUpdatedCallback: (montage: PhotoMontage) => void,
    port: number,
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

                const childProcess = fork(expressService, [port.toString()]);

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
            activeMontageId: context.agentContext.activeMontageId,
            montages: context.agentContext.montages,
        }),
    );
}

/**
 * Starts the built-in windows slideshow screensaver
 * @param folder The optional folder to lanch the slideshow for
 */
function startSlideShow(montage: PhotoMontage, context: MontageActionContext) {
    // copy images into slide show folder
    const slideShowDir = path.join(process.env["TEMP"]!, "typeagent_slideshow");
    if (existsSync(slideShowDir)) {
        rmdirSync(slideShowDir, { recursive: true });
    }

    // make the new dir
    mkdirSync(slideShowDir);

    // copy images into slideshow dir
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
    if (fuzzyTitle === undefined || montages.length === 0) {
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

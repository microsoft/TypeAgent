// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ConstructionAction =
    | NewConstructionStoreAction
    | LoadConstructionStoreAction
    | SaveConstructionStoreAction
    | SetConstructionAutoSaveAction
    | DisableConstructionStoreAction
    | ShowConstructionInfoAction
    | ListConstructionsAction
    | ImportConstructionsAction
    | PruneConstructionsAction
    | DeleteConstructionAction
    | SetBuiltInConstructionCacheAction
    | SetConstructionMergeAction
    | SetWildcardMatchingAction
    | SetEntityWildcardMatchingAction;

// Create a new construction store, optionally at a specified path.
export type NewConstructionStoreAction = {
    actionName: "newConstructionStore";
    parameters?: { file?: string };
};

// Load a construction store from disk or the current session setting.
export type LoadConstructionStoreAction = {
    actionName: "loadConstructionStore";
    parameters?: { file?: string };
};

// Save the current construction store, optionally to a specified path.
export type SaveConstructionStoreAction = {
    actionName: "saveConstructionStore";
    parameters?: { file?: string };
};

// Enable or disable automatic construction-store saving.
export type SetConstructionAutoSaveAction = {
    actionName: "setConstructionAutoSave";
    parameters: { enabled: boolean };
};

// Disable the construction store.
export type DisableConstructionStoreAction = {
    actionName: "disableConstructionStore";
};

// Show information about the current construction store.
export type ShowConstructionInfoAction = {
    actionName: "showConstructionInfo";
};

// List constructions, optionally filtered by match, part, or ID.
export type ListConstructionsAction = {
    actionName: "listConstructions";
    parameters?: {
        verbose?: boolean;
        allMatchStrings?: boolean;
        builtIn?: boolean;
        match?: string[];
        part?: string[];
        ids?: number[];
    };
};

// Import constructions from files or host-provided test data.
export type ImportConstructionsAction = {
    actionName: "importConstructions";
    parameters?: {
        files?: string[];
        extended?: boolean;
    };
};

// Prune outdated constructions from the cache.
export type PruneConstructionsAction = {
    actionName: "pruneConstructions";
};

// Delete one construction by namespace and ID.
export type DeleteConstructionAction = {
    actionName: "deleteConstruction";
    parameters: {
        namespace: string;
        id: number;
    };
};

// Enable or disable the built-in construction cache.
export type SetBuiltInConstructionCacheAction = {
    actionName: "setBuiltInConstructionCache";
    parameters: { enabled: boolean };
};

// Enable or disable construction match-set merging.
export type SetConstructionMergeAction = {
    actionName: "setConstructionMerge";
    parameters: { enabled: boolean };
};

// Enable or disable wildcard matching for constructions.
export type SetWildcardMatchingAction = {
    actionName: "setWildcardMatching";
    parameters: { enabled: boolean };
};

// Enable or disable entity wildcard matching for constructions.
export type SetEntityWildcardMatchingAction = {
    actionName: "setEntityWildcardMatching";
    parameters: { enabled: boolean };
};

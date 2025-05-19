// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type MontageAction =
    | SelectPhotosAction
    | AddPhotosAction
    | ChangeTitleAction
    | RemovePhotosAction
    | ClearSelectionAction
    | ShowSearchParametersAction
    | SetSearchParametersAction
    | StartSlideShowAction
    | DeleteMontageAction
    | DeleteAllMontageAction
    | ListMontageAction
    | MergeMontageAction;

export type MontageActivity = StartEditMontageAction | CreateMontageAction;
export type MontageEntity = Montage;
export type Montage = string;
export type StartEditMontageAction = {
    actionName: "startEditMontage";
    parameters: {
        // title of the montage
        title: Montage;
    };
};

// Select images in an existing montage
export type SelectPhotosAction = {
    actionName: "selectPhotos";
    parameters: {
        // title of the montage
        title: Montage;
        // any search terms to use indicating the photos to remove
        search_filters?: string[];
        // any indices provided indicating the photos to remove from the set of available images
        indices?: number[];
        // placeholder for images to be populated later
        files?: string[];
    };
};

// add photos to the montage
export type AddPhotosAction = {
    actionName: "addPhotos";
    parameters: {
        // title of the montage
        title: Montage;
        // placeholder for images to be populated later
        files?: string[];
        // always empty
        search_filters?: string[];
    };
};

// Changes the montage title
export type ChangeTitleAction = {
    actionName: "changeTitle";
    parameters: {
        // current title of the montage to change
        title: Montage;
        newTitle: string;
    };
};

// Removes the images that match the supplied criteria
export type RemovePhotosAction = {
    actionName: "removePhotos";
    parameters: {
        // title of the montage
        title: Montage;
        // any search terms to use indicating the photos to remove
        search_filters?: string[];
        // any indices provided indicating the photos to remove from the set of available images
        indices?: number[];
        // flag indicating if we are remove selected images or inverse
        selected?: "selected" | "inverse" | "all";
        // placeholder for images to be populated later
        files?: string[];
    };
};

// Clears the currently selected images
export type ClearSelectionAction = {
    actionName: "clearSelectedPhotos";
    parameters: {
        // title of the montage
        title: Montage;
    };
};

// Shows search parameters
export type ShowSearchParametersAction = {
    actionName: "showSearchParameters";
    parameters: {};
};

// Update search parameters
export type SetSearchParametersAction = {
    actionName: "setSearchParameters";
    parameters: {
        // search score value starts at 0
        minSearchScore?: number;
        // only return exact matches?
        exactMatch?: boolean;
    };
};

// Starts a slide show with the images in the active montage
export type StartSlideShowAction = {
    actionName: "startSlideShow";
    parameters: {
        title: Montage;
    };
};

// Creates a new montage
export type CreateMontageAction = {
    actionName: "createNewMontage";
    parameters: {
        // Montage title, defaults to "Untitled"
        title: Montage;
        // any search terms to use to seed the montage based off of the title
        search_filters?: string[];
        // a flag indicating if the UI should immediately switch to this montage, defaults to true
        focus: boolean;
        // placeholder for images to be populated later
        files?: string[];
    };
};

// Deletes the identified montage
export type DeleteMontageAction = {
    actionName: "deleteMontage";
    parameters: {
        // The title of the montage to delete
        title: Montage;
    };
};

export type DeleteAllMontageAction = {
    actionName: "deleteAllMontages";
    parameters: {};
};

// Lists all montages by name
export type ListMontageAction = {
    actionName: "listMontages";
};

// Merges two or more montages together
export type MergeMontageAction = {
    actionName: "mergeMontages";
    parameters: {
        // The title of the merged montage
        mergedMontageTitle: string;
        // The titles of the montages to merge
        titles?: Montage[];
        // THe ids of the montages to merge
        ids?: number[];
    };
};

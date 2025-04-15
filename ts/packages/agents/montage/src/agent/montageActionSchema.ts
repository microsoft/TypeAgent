// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type MontageAction =
    | FindPhotosAction
    | SelectPhotosAction
    | ListPhotosAction
    | ChangeTitleAction
    | RemovePhotosAction
    | ClearSelectionAction
    | ShowSearchParametersAction
    | SetSearchParametersAction
    | StartSlideShowAction
    | CreateMontageAction
    | DeleteMontageAction
    | SwitchMontageAction
    | ListMontageAction
    | MergeMontageAction;

// Find images to add to the montage.
export type FindPhotosAction = {
    actionName: "findPhotos";
    parameters: {
        // any search terms to use indicating the photos to remove
        search_filters: string[];
        // placeholder for images to be populated later
        files?: string[];
    };
};

// Selects images in the UI that have already been found
export type SelectPhotosAction = {
    actionName: "selectPhotos";
    parameters: {
        // any search terms to use indicating the photos to remove
        search_filters?: string[];
        // any indicies provided indicating the photos to remove from the set of available images
        indicies?: number[];
        // placeholder for images to be populated later
        files?: string[];
    };
};

// Lists/adds all available photos
export type ListPhotosAction = {
    actionName: "listPhotos";
    parameters: {
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
        title: string;
    };
};

// Removes the images that match the supplied criteria
export type RemovePhotosAction = {
    actionName: "removePhotos";
    parameters: {
        // any search terms to use indicating the photos to remove
        search_filters?: string[];
        // any indicies provided indicating the photos to remove from the set of available images
        indicies?: number[];
        // flag indicating if we are remove selected images or inverse
        selected?: "selected" | "inverse" | "all";
        // placeholder for images to be populated later
        files?: string[];
    };
};

// Clears the currently selected images
export type ClearSelectionAction = {
    actionName: "clearSelectedPhotos";
    parameters: {};
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
        // only return exact maches?
        exactMatch?: boolean;
    };
};

// Starts a slide show with the images in the active montage
export type StartSlideShowAction = {
    actionName: "startSlideShow";
    parameters: {};
};

// Creates a new montage
export type CreateMontageAction = {
    actionName: "createNewMontage";
    parameters: {
        // Montage title, defaults to "Untitled"
        title: string;
        // any search terms to use to seed the montage based off of the title
        search_filters?: string[];
        // a flag indicating if the UI should imediately switch to this montage, defaults to true
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
        title?: string;
        // The ids (if known) of the montage to delete
        id?: number[];
        // A flag indicating to remove all montages
        deleteAll?: boolean;
    };
};

// Switches the active montage
export type SwitchMontageAction = {
    actionName: "switchMontage";
    parameters: {
        // The title of the montage to switch to
        title?: string;
        // The id (if known) of the montage to switch to
        id?: number;
    };
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
        mergeMontageTitle: string;
        // The titles of the montages to merge
        titles?: string[];
        // THe ids of the montages to merge
        ids?: number[];
    };
};

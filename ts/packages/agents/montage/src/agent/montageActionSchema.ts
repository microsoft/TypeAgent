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
    | StartSlideShowAction;

// Find images to add to the montage.
export type FindPhotosAction = {
    actionName: "findPhotos";
    parameters: {
        // any search terms to use indicating the photos to remove
        search_filters: string[];
        // placeholder for images to be populated later
        files?: string[];
    }
}

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
    }
}

// Lists/adds all available photos
export type ListPhotosAction = {
    actionName: "listPhotos";
    parameters: {
        // placeholder for images to be populated later
        files?: string[];
        // always empty
        search_filters?: string[];
    }
}

// Changes the montage title
export type ChangeTitleAction = {
    actionName: "changeTitle";
    parameters: {
        title: string;
    }
}

// Removes the images the images that match the supplied criteria
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
    }
}

// Clears the currently selected images
export type ClearSelectionAction = {
    actionName: "clearSelectedPhotos";
    parameters: {}
}

export type ShowSearchParametersAction = {
    actionName: "showSearchParameters";
    parameters: {}
}

export type SetSearchParametersAction = {
    actionName: "setSearchParameters";
    parameters: {
        // search score value starts at 0
        minSearchScore?: number;
    }
}

export type StartSlideShowAction = {
    actionName: "startSlideShow";
    parameters: {}
}


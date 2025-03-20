// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type MontageAction =
    | FindPhotosAction
    | SelectPhotosAction
    | ListPhotosAction
    | ChangeTitleAction
    | RemovePhotosAction
    | ClearSelectionAction;

// Finds photos based on image content/description/etc.
export type FindPhotosAction = {
    actionName: "findPhotos";
    parameters: {
        // any search terms to use indicating the photos to remove
        search_filters: string[];
        // placeholder for images to be populated later
        files?: string[];
    }
}

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
    }
}

export type ChangeTitleAction = {
    actionName: "changeTitle";
    parameters: {
        title: string;
    }
}

export type RemovePhotosAction = {
    actionName: "removePhotos";
    parameters: {
        // any search terms to use indicating the photos to remove
        search_filters?: string[];
        // any indicies provided indicating the photos to remove from the set of available images
        indicies?: number[];
        // flag indicating if we are remove selected images
        selected?: boolean;
        // placeholder for images to be populated later
        files?: string[];
    }
}

export type ClearSelectionAction = {
    actionName: "clearSelectedPhotos";
    parameters: {
    }
}


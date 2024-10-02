// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ImageAction = FindImageAction | CreateImageAction | UnknownAction;

// Choose this action if the requests to "see," "show," or implicitly desires visual output
// Finds images on the internet to show the user
// if the user asks for "some", randomly select anywere betwee 3 and 10 images
export type FindImageAction = {
    actionName: "findImageAction";
    parameters: {
        // the original request of the user
        originalRequest: string;
        // the search term for the image(s) to find
        searchTerm: string;
        // the number of images to show the user
        numImages: number;
    };
};

// creates an image based on the supplied description
export type CreateImageAction = {
    actionName: "createImageAction";
    parameters: {
        // the original request of the user
        originalRequest: string;
    };
};

// if the user types text that can not easily be understood as a list action, this action is used
export interface UnknownAction {
    actionName: "unknown";
    parameters: {
        // text typed by the user that the system did not understand
        text: string;
    };
}

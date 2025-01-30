// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ImageAction = FindImageAction | CreateImageAction;

// Choose this action if the user wants to "see", "show", "find", "lookup" pictures/images/photos/memes or otherwise requesting visual output
// Finds images on the internet to show the user
// if the user asks doesn't specify a quantity, randomly select anywhere between 3 and 10 images
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
        // the image caption
        caption: string;
        // the number of images to generate
        numImages: number;
    };
};

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ImageAction = CreateImageAction;

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

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ImageAction = CreateImageAction | EditImageAction;

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

// Edits / transforms an image the user has already supplied (typically
// the most recent attachment). Use this for requests like "cartoonize
// that image", "make a watercolor version of this photo", "stylize this
// as a pencil sketch", etc.
export type EditImageAction = {
    actionName: "editImageAction";
    parameters: {
        // the original request of the user
        originalRequest: string;
        // The natural-language description of the edit to perform
        // (e.g. "cartoonize", "make this a watercolor painting").
        editPrompt: string;
        // The file name of the source image to edit. This MUST be the
        // exact name of an image that is either (a) attached to the
        // current request, or (b) listed as an image entity from a
        // recent turn (e.g. `generated_images/<uuid>.png` from a prior
        // editImageAction / createImageAction result). NEVER invent a
        // filename — if no such image is available, do not emit this
        // action; ask the user to attach an image instead.
        sourceImage: string;
    };
};

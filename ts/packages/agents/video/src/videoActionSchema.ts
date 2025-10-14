// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type VideoAction = CreateVideoAction;

// creates a video based on the supplied description
export type CreateVideoAction = {
    actionName: "createVideoAction";
    parameters: {
        // the original request of the user
        originalRequest: string;
        // the video caption
        caption: string;
        // The file names of any attachments the user provided
        relatedFiles?: string[];
    };
};

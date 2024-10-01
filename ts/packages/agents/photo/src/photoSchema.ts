// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type PhotoAction = TakePhotoAction | UploadImageAction | UnknownAction;

// uses a camera attached to the system to take a photo
export type TakePhotoAction = {
    actionName: "takePhoto";
    parameters: {
        // the original request of the user
        originalRequest: string;
    };
};

// allows the user to upload an image from their s
export interface UploadImageAction {
    actionName: "uploadImage";
    parameters: {
        // the original request of the user
        originalRequest: string;
    };
}

// if the user types text that can not easily be understood as a list action, this action is used
export interface UnknownAction {
    actionName: "unknown";
    parameters: {
        // text typed by the user that the system did not understand
        text: string;
    };
}

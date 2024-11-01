// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type PhotoAction = TakePhotoAction;

// uses a camera attached to the system to take a photo
export type TakePhotoAction = {
    actionName: "takePhoto";
    parameters: {
        // the original request of the user
        originalRequest: string;
    };
};

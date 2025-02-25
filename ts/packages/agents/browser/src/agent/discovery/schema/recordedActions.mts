// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// This captures the parameters for a user intent type
export type UserIntentParameter = {
    name: string;
    type: string;
    defaultValue?: any;
    description: string;
    required: boolean;
};
export type UserIntent = {
    actiontName: string;
    // a consise list of the parameters that should be captured from the user in order to implenent this action
    parameters: UserIntentParameter[];
};

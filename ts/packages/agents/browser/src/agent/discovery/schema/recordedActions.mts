// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// This captures the parameters for a user intent type
export type UserIntentParameter = {
    // a concise name for the parameter, in camelCase. This should only contain alphanumeric characters
    shortName: string;
    // a longer, descriptive name for the parameter. This value can contain non-alphanumeric characters
    name: string;
    type: string;
    // The default value for the parameter. If this value is set based on a HTML
    // page, check whether the target element has a default value
    defaultValue?: any;
    description: string;
    // Indicates whether a parameter is required. If a parameter has a default value
    // then it is not required.
    required: boolean;
};

export type UserIntent = {
    // a concise name for the action, in camelCase
    actiontName: string;
    // a consise list of the parameters that should be captured from the user in order to implenent this action
    parameters: UserIntentParameter[];
};

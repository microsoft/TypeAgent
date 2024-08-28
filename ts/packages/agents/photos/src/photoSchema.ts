// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type PhotoAction =
    | DescribeAction
    | UnknownAction;

// describes an image 
export type DescribeAction = {
    actionName: "describeImage";
    parameters: {
        image: Uint8Array;
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

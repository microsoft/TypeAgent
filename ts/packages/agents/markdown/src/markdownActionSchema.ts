// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type MarkdownAction =
    | CreateDocumentAction
    | UpdateDocumentAction
    | UnknownAction;

// creates a new markdown document
export type CreateDocumentAction = {
    actionName: "createDocument";
    parameters: {
        // the name to use for the document
        name: string;
    };
};

// Updates the document by adding, removing or editing parts of the document.
export type UpdateDocumentAction = {
    actionName: "updateDocument";
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

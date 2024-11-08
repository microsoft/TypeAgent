// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type MarkdownAction = CreateDocumentAction | UpdateDocumentAction;

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

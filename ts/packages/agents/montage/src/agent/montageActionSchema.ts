// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type MontageAction =
    | FindPhotoAction
    | ListPhotoAction;
    // | AddPhotoAction
    // | RemovePhotoAction
    // | FinishedAction;

export type FindPhotoAction = {
    actionName: "findPhotoAction";
    parameters: {
        filters: string[];
    }
}

// Lists all available photos
export type ListPhotoAction = {
    actionName: "listPhotoAction";
    parameters: {  
    }
}

// // creates a new markdown document
// export type CreateDocumentAction = {
//     actionName: "createDocument";
//     parameters: {
//         // the name to use for the document
//         name: string;
//     };
// };

// // opens an existing markdown document
// export type OpenDocumentAction = {
//     actionName: "openDocument";
//     parameters: {
//         // the name to use for the document
//         name: string;
//     };
// };

// // Updates the document by adding, removing or editing parts of the document.
// export type UpdateDocumentAction = {
//     actionName: "updateDocument";
//     parameters: {
//         // the original request of the user
//         originalRequest: string;
//     };
// };

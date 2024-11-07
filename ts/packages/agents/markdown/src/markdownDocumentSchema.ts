// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type MarkdownContent = {
    // a brief summary of the change made to the document. This should not be just a repetition of the user's request.
    operationSummary?: string;
    // the Markdown content for this file. The markdown uses GitHub flavor syntax. Diagrams can be added
    // to the document using markdown.js syntax. Equations can be written using LaTex syntax. Maps can be
    // added using GeoJSON syntax.
    content?: string;
};

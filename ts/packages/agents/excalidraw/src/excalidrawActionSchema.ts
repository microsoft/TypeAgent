// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ExcalidrawAction = CreateDiagramAction | ExportDiagramAction;

// Creates an Excalidraw diagram from source content such as documentation,
// architecture descriptions, Visio XML exports, Mermaid markdown, or plain text.
// The agent uses AI to interpret the content and generate a visual diagram.
export type CreateDiagramAction = {
    actionName: "createDiagram";
    parameters: {
        // the original request from the user
        originalRequest: string;
        // the source content to convert into a diagram — either raw text/markdown/XML,
        // or a file path (absolute or relative) whose contents will be read automatically
        sourceContent: string;
        // the type of the source content
        sourceType:
            | "markdown"
            | "text"
            | "visio-xml"
            | "mermaid"
            | "architecture";
        // optional title for the diagram
        diagramTitle?: string;
        // optional output file path; defaults to ~/Documents/<title>.excalidraw
        outputPath?: string;
    };
};

// Exports a previously generated or provided Excalidraw JSON to a file at the specified path.
export type ExportDiagramAction = {
    actionName: "exportDiagram";
    parameters: {
        // the original request from the user
        originalRequest: string;
        // the Excalidraw JSON content to export (as a string)
        excalidrawJson: string;
        // the output file path for the .excalidraw file
        outputPath: string;
    };
};

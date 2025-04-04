// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ShellAction = OpenCanvasAction | CloseCanvasAction;

// Used to show/open/display the canvas of the specified tool/site in the shell
export type OpenCanvasAction = {
    actionName: "openCanvas";
    parameters: {
        // Alias or URL for the site of the open.
        site:
            | "paelobiodb"
            | "crossword"
            | "commerce"
            | "montage"
            | "markdown"
            | string;
    };
};

// Used to close the currently open shell canvas
export type CloseCanvasAction = {
    actionName: "closeCanvas";
};

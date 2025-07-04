// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type CodeActions =
    | ChangeColorThemeAction
    | SplitEditorAction
    | ChangeEditorLayoutAction
    | NewFileAction
    | AddCodeSnippetAction;

export type CodeActivity = LaunchVSCodeAction;

// Launch or Start VSCode
export type LaunchVSCodeAction = {
    actionName: "launchVSCode";
    parameters: {
        mode: "last" | "folder" | "workspace";
        path?: string; // Required if mode is "folder" or "workspace"
    };
};

export type ColorTheme =
    | "Default Light+"
    | "Default Dark+"
    | "Monokai"
    | "Monokai Dimmed"
    | "Solarized Dark"
    | "Solarized Light"
    | "Quiet Light"
    | "Red"
    | "Kimbie Dark"
    | "Abyss"
    | "Default High Contrast Light";

// Change the color scheme of the editor
export type ChangeColorThemeAction = {
    actionName: "changeColorScheme";
    parameters: {
        // e.g., "Light+", "Dark+", "Monokai", "Solarized Dark", "Solarized Light"
        theme: ColorTheme;
    };
};

export type SplitDirection = "right" | "left" | "up" | "down";

// Split to update the current editor window into a new editor pane to the left, right, above, or below
export type SplitEditorAction = {
    actionName: "splitEditor";
    parameters: {
        // e.g., "right", "left", "up", "down", only if specified by the user
        direction?: SplitDirection;
    };
};

export type LayoutColumns = "single" | "double" | "three";

// Change the editor layout to single, double or three column layout
export type ChangeEditorLayoutAction = {
    actionName: "changeEditorLayout";
    parameters: {
        // e.g., "single", "double", "three" column editor layout. Fill only if specified by the user
        columnCount?: LayoutColumns;
    };
};

export type CodeLanguage =
    | "plaintext"
    | "html"
    | "python"
    | "javaScript"
    | "typeScript"
    | "markdown";

// Create a new file, this is not same as opening a file or finding a file in the workspace
export type NewFileAction = {
    actionName: "newFile";
    parameters: {
        fileName: string; // If not filename is provided, "Untitled" is used
        language: CodeLanguage; // plaintext, html, python, javaScript, typeScript, markdown etc.
        // Content of the new file is based on language and user input, default is "Hello, World!",
        // for ex: Create a markdown file with a list of top ten AI papers and links should fill
        // the content field with a list of papers and their links from
        // arxiv. If the user asks to create a python file with code to merge two arrays of strings
        // the content field should be filled with the python function to merge the arrays
        content: string;
    };
};

// Add a code snippet to the current file
export type AddCodeSnippetAction = {
    actionName: "addCodeSnippet";
    parameters: {
        snippet: string; // Code snippet to add
        language: string; // Programming language of the snippet
    };
};

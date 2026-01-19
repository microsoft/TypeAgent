// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type CodeActions =
    | ChangeColorThemeAction
    | SplitEditorAction
    | ChangeEditorLayoutAction
    | NewFileAction;

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
export type EditorPosition = "first" | "last" | "active";

// ACTION: Split an editor window into multiple panes showing the same file or different files side-by-side.
// This creates a new editor pane (split view) for working with multiple files simultaneously.
// USE THIS for: "split editor", "split the editor with X", "duplicate this editor to the right", "split X"
//
// Examples:
// - "split editor to the right" → splits active editor
// - "split the first editor" → splits leftmost editor
// - "split app.tsx to the left" → finds editor showing app.tsx and splits it
// - "split the last editor down" → splits rightmost editor downward
// - "split the editor with utils.ts" → finds editor showing utils.ts and splits it
export type SplitEditorAction = {
    actionName: "splitEditor";
    parameters: {
        // Direction to split: "right", "left", "up", "down". Only include if user specifies direction.
        direction?: SplitDirection;
        // Which editor to split by position. Use "first" for leftmost editor, "last" for rightmost, "active" for current editor, or a number (0-based index).
        editorPosition?: EditorPosition | number;
        // Which editor to split by file name. Extract the file name or pattern from user request.
        // Examples: "app.tsx", "main.py", "utils", "codeActionHandler"
        // Use this when user says "split X" or "split the editor with X" where X is a file name.
        fileName?: string;
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

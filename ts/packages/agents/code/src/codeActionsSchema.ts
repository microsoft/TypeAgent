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

// ACTION: Change the VS Code editor's color theme (NOT a system / Windows desktop theme).
// USE THIS for any request about an EDITOR / IDE / "code" / "vscode" / syntax color theme,
// e.g. "change my vscode color theme to Monokai", "set the editor theme to Solarized Dark",
// "switch theme to Dark+", "use the Monokai theme in vscode".
// USE THIS even when the user just says "change my color theme to <name>" — by default
// the user is talking about the editor they are looking at, NOT a Windows desktop theme.
// The recognized names are common VS Code theme names: "Light+", "Dark+", "Monokai",
// "Monokai Dimmed", "Solarized Dark", "Solarized Light", "Quiet Light", "Red", "Tomorrow Night Blue",
// "Kimbie Dark", "Abyss", "Default High Contrast Light", etc.
// DO NOT route these to a desktop / Windows personalization "ApplyTheme" action.
export type ChangeColorThemeAction = {
    actionName: "changeColorScheme";
    parameters: {
        // The VS Code color theme name, e.g. "Monokai", "Solarized Dark", "Dark+".
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

// ACTION: Create a new file in the editor.
// USE THIS for any "create a new <lang> file called X with <content>", "make a new file",
// "new typescript/python/markdown file" — for both untitled scratch files and named files.
// This is the SINGLE canonical action for creating files. Do NOT emit a schema name like
// "code-editor" or "code-general" as the actionName — always use "newFile" exactly.
// Distinct from opening or finding an existing file in the workspace.
//
// EXAMPLES (always route these to newFile):
//   "create a new typescript file called scratch.ts with a hello world function"
//     → { actionName: "newFile", parameters: { fileName: "scratch.ts", language: "typeScript",
//          content: "function helloWorld() { console.log('Hello, World!'); }\n" } }
//   "make a new python file"
//     → { actionName: "newFile", parameters: { fileName: "Untitled", language: "python", content: "" } }
//   "new markdown file called notes.md"
//     → { actionName: "newFile", parameters: { fileName: "notes.md", language: "markdown", content: "" } }
//
// DO NOT route file-creation requests to dispatcher.reasoning, dispatcher.unknown,
// dispatcher.clarify, or any code-editor/code-general sub-schema. Always pick newFile here.
export type NewFileAction = {
    actionName: "newFile";
    parameters: {
        fileName: string; // If no filename is provided, "Untitled" is used
        language: CodeLanguage; // plaintext, html, python, javaScript, typeScript, markdown etc.
        // Content of the new file based on language and user input, default is "Hello, World!".
        // For "Create a markdown file with a list of top ten AI papers and links" → fill with a
        // list of papers and arxiv links. For "Create a python file with code to merge two arrays
        // of strings" → fill with the python function to merge the arrays.
        content: string;
    };
};

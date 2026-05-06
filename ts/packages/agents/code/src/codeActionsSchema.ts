// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type CodeActions =
    | ChangeColorThemeAction
    | SplitEditorAction
    | ChangeEditorLayoutAction
    | NewCodeFileAction
    | NewMarkdownFileAction
    | NewTextFileAction;

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

export type CodeFileLanguage =
    | "html"
    | "css"
    | "json"
    | "python"
    | "javaScript"
    | "typeScript";

// Create a new code file (Python, JavaScript, TypeScript, HTML, CSS, JSON, etc.) in the editor.
//
// Example:
// User: create a new typescript file called scratch.ts with a hello world function
// Agent: { actionName: "newCodeFile", parameters: { fileName: "scratch.ts",
//          language: "typeScript", content: "function helloWorld() { console.log('Hello, World!'); }\n" } }
export type NewCodeFileAction = {
    actionName: "newCodeFile";
    parameters: {
        // The file name; if omitted or empty, "untitled" is used.
        fileName: string | "untitled";
        // The programming language of the file.
        language: CodeFileLanguage;
        // Initial file content; empty string for an empty scratch file.
        content: string;
    };
};

// Create a new Markdown (.md) file in the editor.
//
// Example:
// User: create a markdown file with a list of top ten AI papers
// Agent: { actionName: "newMarkdownFile", parameters: { fileName: "papers.md",
//          content: "# Top 10 AI Papers\n..." } }
export type NewMarkdownFileAction = {
    actionName: "newMarkdownFile";
    parameters: {
        // The file name; if omitted or empty, "untitled" is used.
        fileName: string | "untitled";
        // Initial Markdown content; empty string for an empty scratch file.
        content: string;
    };
};

// Create a new plain text (.txt) file in the editor.
//
// Example:
// User: make a new text file called notes
// Agent: { actionName: "newTextFile", parameters: { fileName: "notes.txt", content: "" } }
export type NewTextFileAction = {
    actionName: "newTextFile";
    parameters: {
        // The file name; if omitted or empty, "untitled" is used.
        fileName: string | "untitled";
        // Initial text content; empty string for an empty scratch file.
        content: string;
    };
};

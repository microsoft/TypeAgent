// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type CodeActions =
    | ChangeColorThemeAction
    | SplitEditorAction
    | ChangeEditorLayoutAction
    | NewCodeFileAction
    | NewMarkdownFileAction
    | NewTextFileAction
    | GetActiveEditorAction
    | GetSelectionAction
    | GetDiagnosticsAction
    | ListOpenEditorsAction
    | GetFileContentAction
    | GetWorkspaceChangesAction;

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

// Change the VS Code editor's color theme.
//
// Example:
// User: change my vscode color theme to Monokai
// Agent: { actionName: "changeColorScheme", parameters: { theme: "Monokai" } }
export type ChangeColorThemeAction = {
    actionName: "changeColorScheme";
    parameters: {
        // The VS Code color theme name, e.g. "Monokai", "Solarized Dark", "Dark+".
        theme: ColorTheme;
    };
};

export type SplitDirection = "right" | "left" | "up" | "down";
export type EditorPosition = "first" | "last" | "active";

// Split an editor window into multiple panes showing the same file or different files side-by-side.
//
// Example:
// User: split editor to the right
// Agent: { actionName: "splitEditor", parameters: { direction: "right" } }
//
// Example:
// User: split the editor with utils.ts
// Agent: { actionName: "splitEditor", parameters: { fileName: "utils.ts" } }
export type SplitEditorAction = {
    actionName: "splitEditor";
    parameters: {
        // Direction to split: "right", "left", "up", "down". Only include if user specifies direction.
        direction?: SplitDirection;
        // Which editor to split by position: "first" (leftmost), "last" (rightmost), "active" (current),
        // or a 0-based index.
        editorPosition?: EditorPosition | number;
        // Which editor to split by file name. Extract the file name or pattern from user request.
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

// ── Read / introspection actions ────────────────────────────────────────────
// These return the current VS Code editor state to the caller and modify
// nothing. They are meant to be invoked by the reasoning agent (via
// discover_actions/execute_action) to inspect what the user is looking at.
// Results are returned as JSON in the action's display output.

// Get a coarse snapshot of the active editor: file path, language, dirty state,
// cursor position, selection range, visible range, workspace folders, open
// editor count, and diagnostic counts. Does NOT include file or selection text.
export type GetActiveEditorAction = {
    actionName: "getActiveEditor";
    parameters: {};
};

// Get the text currently selected in the active editor, along with its range.
// Returns an empty selection marker when nothing is selected.
export type GetSelectionAction = {
    actionName: "getSelection";
    parameters: {};
};

// Get the diagnostics (errors, warnings, info, hints) for a file. Defaults to
// the active file when fileName is omitted.
export type GetDiagnosticsAction = {
    actionName: "getDiagnostics";
    parameters: {
        // Workspace-relative path or file name. Omit to use the active file.
        fileName?: string;
    };
};

// List the open editor tabs across all editor groups (path, label, active,
// dirty). Does not include file contents.
export type ListOpenEditorsAction = {
    actionName: "listOpenEditors";
    parameters: {};
};

// Read the contents of a workspace file. Optionally restrict to a line range
// (0-based, inclusive). The file must be inside an open workspace folder.
export type GetFileContentAction = {
    actionName: "getFileContent";
    parameters: {
        // Workspace-relative path or file name to read.
        fileName: string;
        // Optional 0-based start line (inclusive).
        startLine?: number;
        // Optional 0-based end line (inclusive).
        endLine?: number;
    };
};

// Get a summary of pending source-control (git) changes in the workspace:
// per-repository branch, working-tree changes, and staged changes.
export type GetWorkspaceChangesAction = {
    actionName: "getWorkspaceChanges";
    parameters: {};
};

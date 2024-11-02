// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type CodeGeneralActions =
    | ShowCommandPaletteAction
    | GotoFileOrLineOrSymbolAction
    | NewWindowAction
    | ShowUserSettingsAction
    | ShowKeyboardShortcutsAction;

// Show or open the command palette that allows to search and execute commands
// Triggger this action only when asked to show/open the command palette explicitly
export type ShowCommandPaletteAction = {
    actionName: "showCommandPalette";
    parameters: {};
};

// Quick option to access a file, alternate way to search a file by name using keyboard shortcuts
// search by file name, or append : go to line, or  @ to go to symbol
// If the user request is open/show the search pane this action should not be triggered
export type GotoFileOrLineOrSymbolAction = {
    actionName: "gotoFileOrLineOrSymbol";
    parameters: {
        goto?: "file" | "line" | "symbol";
        // file name, line number, or symbol name, don't fill this propert if
        // the file name, line number or symbol name is not provided in the user request
        ref?: string;
    };
};

// New window/instance of vscode
export type NewWindowAction = {
    actionName: "newWindow";
    parameters: {};
};

// Show user settings
export type ShowUserSettingsAction = {
    actionName: "showUserSettings";
    parameters: {};
};

// Show keyboard shortcuts
export type ShowKeyboardShortcutsAction = {
    actionName: "showKeyboardShortcuts";
    parameters: {};
};

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type CodeDisplayActions =
    | ZoomInAction
    | ZoomOutAction
    | ZoomResetAction
    | ShowExplorerPane
    | ShowTextSearchAction
    | ShowSourceControlAction
    | ShowExtensionsAction
    | ShowOutputPanelAction
    | ToggleSearchDetailsAction
    | ReplaceInFilesAction
    | OpenMarkdownPreviewAction
    | OpenMarkdownPreviewToSideAction
    | ZenModeAction
    | CloseEditorAction
    | OpenSettingsAction;

// Zoom in the editor
export type ZoomInAction = {
    actionName: "zoomIn";
    parameters: {};
};

// Zoom out the editor
export type ZoomOutAction = {
    actionName: "zoomOut";
    parameters: {};
};

// Zoom reset
export type ZoomResetAction = {
    actionName: "fontZoomReset";
    parameters: {};
};

// Show explorer/show the file explorer
export type ShowExplorerPane = {
    actionName: "showExplorer";
    parameters: {};
};

// Show search or replace pane/window in the sidebar to search for text in the files
// Note that this is not for searching or finding files
export type ShowTextSearchAction = {
    actionName: "showSearch";
    parameters: {};
};

// Show source control
export type ShowSourceControlAction = {
    actionName: "showSourceControl";
    parameters: {};
};

// Show the extensions panel
export type ShowExtensionsAction = {
    actionName: "showExtensions";
    parameters: {};
};

// Show output panel
export type ShowOutputPanelAction = {
    actionName: "showOutputPanel";
    parameters: {};
};

// Toggle search details
export type ToggleSearchDetailsAction = {
    actionName: "toggleSearchDetails";
    parameters: {};
};

// Replace in files
export type ReplaceInFilesAction = {
    actionName: "replaceInFiles";
    parameters: {};
};

// Open markdown preview
export type OpenMarkdownPreviewAction = {
    actionName: "openMarkdownPreview";
    parameters: {};
};

// Open markdown preview to the side
export type OpenMarkdownPreviewToSideAction = {
    actionName: "openMarkdownPreviewToSide";
    parameters: {};
};

// Code in Zen Mode
export type ZenModeAction = {
    actionName: "zenMode";
    parameters: {};
};

// Close the current editor
export type CloseEditorAction = {
    actionName: "closeEditor";
    parameters: {};
};

// Open settings
export type OpenSettingsAction = {
    actionName: "openSettings";
    parameters: {};
};

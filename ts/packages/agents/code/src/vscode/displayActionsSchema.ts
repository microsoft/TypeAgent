// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type CodeDisplayActions =
    | ZoomInAction
    | ZoomOutAction
    | ZoomResetAction
    | ShowExplorerPane
    | ShowTextSearchAction
    | ShowSourceControlAction
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
};

// Zoom out the editor
export type ZoomOutAction = {
    actionName: "zoomOut";
};

// Zoom reset
export type ZoomResetAction = {
    actionName: "fontZoomReset";
};

// Show explorer/show the file explorer
export type ShowExplorerPane = {
    actionName: "showExplorer";
};

// Show search or replace pane/window in the sidebar to search for text in the files
// Note that this is not for searching or finding files
export type ShowTextSearchAction = {
    actionName: "showSearch";
};

// Show source control
export type ShowSourceControlAction = {
    actionName: "showSourceControl";
};

// Show output panel
export type ShowOutputPanelAction = {
    actionName: "showOutputPanel";
};

// Toggle search details
export type ToggleSearchDetailsAction = {
    actionName: "toggleSearchDetails";
};

// Replace in files
export type ReplaceInFilesAction = {
    actionName: "replaceInFiles";
};

// Open markdown preview
export type OpenMarkdownPreviewAction = {
    actionName: "openMarkdownPreview";
};

// Open markdown preview to the side
export type OpenMarkdownPreviewToSideAction = {
    actionName: "openMarkdownPreviewToSide";
};

// Code in Zen Mode
export type ZenModeAction = {
    actionName: "zenMode";
};

// Close the current editor
export type CloseEditorAction = {
    actionName: "closeEditor";
};

// Open settings
export type OpenSettingsAction = {
    actionName: "openSettings";
};

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type DesktopTaskbarActions =
    | AutoHideTaskbarAction
    | TaskbarAlignmentAction
    | TaskViewVisibilityAction
    | ToggleWidgetsButtonVisibilityAction
    | ShowBadgesOnTaskbarAction
    | DisplayTaskbarOnAllMonitorsAction
    | DisplaySecondsInSystrayClockAction;

// Auto-hides the taskbar
export type AutoHideTaskbarAction = {
    actionName: "AutoHideTaskbar";
    parameters: {
        hideWhenNotUsing: boolean;
        alwaysShow: boolean;
    };
};

// Sets taskbar alignment (left or center)
export type TaskbarAlignmentAction = {
    actionName: "TaskbarAlignment";
    parameters: {
        alignment: "left" | "center";
    };
};

// Shows or hides the Task View button
export type TaskViewVisibilityAction = {
    actionName: "TaskViewVisibility";
    parameters: {
        visibility: boolean;
    };
};

// Shows or hides the Widgets button
export type ToggleWidgetsButtonVisibilityAction = {
    actionName: "ToggleWidgetsButtonVisibility";
    parameters: {
        visibility: "show" | "hide";
    };
};

// Shows or hides badges on taskbar icons
export type ShowBadgesOnTaskbarAction = {
    actionName: "ShowBadgesOnTaskbar";
    parameters: {
        enableBadging?: boolean;
    };
};

// Shows taskbar on all monitors
export type DisplayTaskbarOnAllMonitorsAction = {
    actionName: "DisplayTaskbarOnAllMonitors";
    parameters: {
        enable?: boolean;
    };
};

// Shows seconds in the system tray clock
export type DisplaySecondsInSystrayClockAction = {
    actionName: "DisplaySecondsInSystrayClock";
    parameters: {
        enable?: boolean;
    };
};

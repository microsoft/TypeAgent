// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type DesktopActions =
    | LaunchProgramAction
    | CloseProgramAction
    | TileWindowsAction
    | MaximizeWindowAction
    | MinimizeWindowAction
    | SwitchToWindowAction
    | SetVolumeAction
    | RestoreVolumeAction
    | MuteVolumeAction
    | SetWallpaperAction
    | ChangeThemeModeAction
    | ConnectWifiAction
    | DisconnectWifiAction
    | ToggleAirplaneModeAction
    | CreateDesktopAction
    | MoveWindowToDesktopAction
    | PinWindowToAllDesktopsAction
    | SwitchDesktopAction
    | NextDesktopAction
    | PreviousDesktopAction
    | ToggleNotificationsAction
    | DebugAutoShellAction
    | SetTextSizeAction
    | SetScreenResolutionAction
    // ===== New Settings Actions (47 total) =====
    // Network Settings
    | BluetoothToggleAction
    | EnableWifiAction
    | EnableMeteredConnectionsAction
    // Display Settings
    | AdjustScreenBrightnessAction
    | EnableBlueLightFilterScheduleAction
    | AdjustColorTemperatureAction
    | DisplayScalingAction
    | AdjustScreenOrientationAction
    | RotationLockAction
    // Personalization Settings
    | EnableTransparencyAction
    | ApplyColorToTitleBarAction
    | HighContrastThemeAction
    // Taskbar Settings
    | AutoHideTaskbarAction
    | TaskbarAlignmentAction
    | TaskViewVisibilityAction
    | ToggleWidgetsButtonVisibilityAction
    | ShowBadgesOnTaskbarAction
    | DisplayTaskbarOnAllMonitorsAction
    | DisplaySecondsInSystrayClockAction
    // Mouse Settings
    | MouseCursorSpeedAction
    | MouseWheelScrollLinesAction
    | SetPrimaryMouseButtonAction
    | EnhancePointerPrecisionAction
    | AdjustMousePointerSizeAction
    | MousePointerCustomizationAction
    // Touchpad Settings
    | EnableTouchPadAction
    | TouchpadCursorSpeedAction
    // Privacy Settings
    | ManageMicrophoneAccessAction
    | ManageCameraAccessAction
    | ManageLocationAccessAction
    // Power Settings
    | BatterySaverActivationLevelAction
    | SetPowerModePluggedInAction
    | SetPowerModeOnBatteryAction
    // Gaming Settings
    | EnableGameModeAction
    // Accessibility Settings
    | EnableNarratorAction
    | EnableMagnifierAction
    | EnableStickyKeysAction
    | EnableFilterKeysAction
    | MonoAudioToggleAction
    // File Explorer Settings
    | ShowFileExtensionsAction
    | ShowHiddenAndSystemFilesAction
    // Time & Region Settings
    | AutomaticTimeSettingAction
    | AutomaticDSTAdjustmentAction
    // Focus Assist Settings
    | EnableQuietHoursAction
    // Multi-Monitor Settings
    | RememberWindowLocationsAction
    | MinimizeWindowsOnMonitorDisconnectAction;

// Launches a new program window on a Windows Desktop
// Example:
//  user: Launch edge
//  agent: {
//     "actionName": "launchProgram",
//     "parameters": {
//        "name": "edge"
//     }
//  }
export type LaunchProgramAction = {
    actionName: "launchProgram";
    parameters: {
        name: KnownPrograms | string; // The name of the software application
    };
};

// Closes a program window on a Windows Desktop
export type CloseProgramAction = {
    actionName: "closeProgram";
    parameters: {
        name: KnownPrograms | string; // The name of the software application
    };
};

// Maximizes a program window on a Windows Desktop
export type MaximizeWindowAction = {
    actionName: "maximize";
    parameters: {
        name: KnownPrograms | string; // The name of the software application
    };
};

// Minimizes a program window on a Windows Desktop
export type MinimizeWindowAction = {
    actionName: "minimize";
    parameters: {
        name: KnownPrograms;
    };
};

// Sets focus to a program window on a Windows Desktop
export type SwitchToWindowAction = {
    actionName: "switchTo";
    parameters: {
        name: KnownPrograms;
    };
};

// Positions program windows on a program window on a Windows Desktop
export type TileWindowsAction = {
    actionName: "tile";
    parameters: {
        leftWindow: KnownPrograms;
        rightWindow: KnownPrograms;
    };
};

export type SetVolumeAction = {
    actionName: "volume";
    parameters: {
        targetVolume: number; // value between 0 and 100
    };
};

export type RestoreVolumeAction = {
    actionName: "restoreVolume";
};

export type MuteVolumeAction = {
    actionName: "mute";
    parameters: {
        on: boolean;
    };
};

export type SetWallpaperAction = {
    actionName: "setWallpaper";
    parameters: {
        filePath?: string; // The path to the file
        url?: string; // The url to the image
    };
};

// Sets the theme mode of the current [windows] desktop
export type ChangeThemeModeAction = {
    actionName: "setThemeMode";
    parameters: {
        mode: "light" | "dark" | "toggle"; // the theme mode
    };
};

export type ConnectWifiAction = {
    actionName: "connectWifi";
    parameters: {
        ssid: string; // The SSID of the wifi network
        password?: string; // The password of the wifi network, if required
    };
};

// Disconnects from the current wifi network
export type DisconnectWifiAction = {
    actionName: "disconnectWifi";
    parameters: {
        // No parameters required
    };
};

export type ToggleAirplaneModeAction = {
    actionName: "toggleAirplaneMode";
    parameters: {
        enable: boolean; // true to enable, false to disable
    };
};

// creates a new Windows Desktop
export type CreateDesktopAction = {
    actionName: "createDesktop";
    parameters: {
        names: string[]; // The name(s) of the desktop(s) to create (default: Desktop 1, Desktop 2, etc.)
    };
};

export type MoveWindowToDesktopAction = {
    actionName: "moveWindowToDesktop";
    parameters: {
        name: KnownPrograms | string; // The name of the software application
        desktopId: number; // The ID of the desktop to move the window to
    };
};

export type PinWindowToAllDesktopsAction = {
    actionName: "pinWindow";
    parameters: {
        name: KnownPrograms | string; // The name of the software application
    };
};

export type SwitchDesktopAction = {
    actionName: "switchDesktop";
    parameters: {
        desktopId: number; // The ID of the desktop to switch to
    };
};

// switches to the next Windows Desktop
export type NextDesktopAction = {
    actionName: "nextDesktop";
    parameters: {
        // No parameters required
    };
};

// switches to the previous Windows Desktop
export type PreviousDesktopAction = {
    actionName: "previousDesktop";
    parameters: {
        // No parameters required
    };
};

// Shows/hides windows notification center
export type ToggleNotificationsAction = {
    actionName: "toggleNotifications";
    parameters: {
        enable: boolean; // true to enable, false to disable
    };
};

// Attaches the debugger to the AutoShell process
export type DebugAutoShellAction = {
    actionName: "debug";
    parameters: {};
};

// Changes the text size that appears throughout Windows and your apps
export type SetTextSizeAction = {
    actionName: "setTextSize";
    parameters: {
        // small changes are 5% increments, large changes are 25% increments
        size: number; // size in percentage (100% is default) (range is 100 - 225)
    };
};

// Change screen resolution
export type SetScreenResolutionAction = {
    actionName: "setScreenResolution";
    parameters: {
        width: number; // width in pixels
        height: number; // height in pixels
    };
};

// ===== New Settings Actions =====

// Network Settings

// Toggles Bluetooth radio on or off
export type BluetoothToggleAction = {
    actionName: "BluetoothToggle";
    parameters: {
        enableBluetooth?: boolean; // true to enable, false to disable
    };
};

// Enables or disables WiFi adapter
export type EnableWifiAction = {
    actionName: "enableWifi";
    parameters: {
        enable: boolean; // true to enable, false to disable
    };
};

// Enables or disables metered connection
export type EnableMeteredConnectionsAction = {
    actionName: "enableMeteredConnections";
    parameters: {
        enable: boolean;
    };
};

// Display Settings

// Adjusts screen brightness (increase or decrease)
export type AdjustScreenBrightnessAction = {
    actionName: "AdjustScreenBrightness";
    parameters: {
        brightnessLevel: "increase" | "decrease";
    };
};

// Enables or configures Night Light (blue light filter) schedule
export type EnableBlueLightFilterScheduleAction = {
    actionName: "EnableBlueLightFilterSchedule";
    parameters: {
        schedule: string;
        nightLightScheduleDisabled: boolean;
    };
};

// Adjusts the color temperature for Night Light
export type AdjustColorTemperatureAction = {
    actionName: "adjustColorTemperature";
    parameters: {
        filterEffect?: "reduce" | "increase";
    };
};

// Sets display scaling percentage (100, 125, 150, 175, 200)
export type DisplayScalingAction = {
    actionName: "DisplayScaling";
    parameters: {
        sizeOverride: string; // percentage as string
    };
};

// Adjusts screen orientation between portrait and landscape
export type AdjustScreenOrientationAction = {
    actionName: "AdjustScreenOrientation";
    parameters: {
        orientation: "portrait" | "landscape";
    };
};

// Locks or unlocks screen rotation
export type RotationLockAction = {
    actionName: "RotationLock";
    parameters: {
        enable?: boolean;
    };
};

// Personalization Settings

// Enables or disables transparency effects
export type EnableTransparencyAction = {
    actionName: "EnableTransparency";
    parameters: {
        enable: boolean;
    };
};

// Applies accent color to title bars
export type ApplyColorToTitleBarAction = {
    actionName: "ApplyColorToTitleBar";
    parameters: {
        enableColor: boolean;
    };
};

// Enables high contrast theme
export type HighContrastThemeAction = {
    actionName: "HighContrastTheme";
    parameters: {};
};

// Taskbar Settings

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

// Mouse Settings

// Adjusts mouse cursor speed
export type MouseCursorSpeedAction = {
    actionName: "MouseCursorSpeed";
    parameters: {
        speedLevel: number; // 1-20, default 10
        reduceSpeed?: boolean;
    };
};

// Sets the number of lines to scroll per mouse wheel notch
export type MouseWheelScrollLinesAction = {
    actionName: "MouseWheelScrollLines";
    parameters: {
        scrollLines: number; // 1-100
    };
};

// Sets the primary mouse button
export type SetPrimaryMouseButtonAction = {
    actionName: "setPrimaryMouseButton";
    parameters: {
        primaryButton: "left" | "right";
    };
};

// Enables or disables enhanced pointer precision (mouse acceleration)
export type EnhancePointerPrecisionAction = {
    actionName: "EnhancePointerPrecision";
    parameters: {
        enable?: boolean;
    };
};

// Adjusts mouse pointer size
export type AdjustMousePointerSizeAction = {
    actionName: "AdjustMousePointerSize";
    parameters: {
        sizeAdjustment: "increase" | "decrease";
    };
};

// Customizes mouse pointer color
export type MousePointerCustomizationAction = {
    actionName: "mousePointerCustomization";
    parameters: {
        color: string;
        style?: string;
    };
};

// Touchpad Settings

// Enables or disables the touchpad
export type EnableTouchPadAction = {
    actionName: "EnableTouchPad";
    parameters: {
        enable: boolean;
    };
};

// Adjusts touchpad cursor speed
export type TouchpadCursorSpeedAction = {
    actionName: "TouchpadCursorSpeed";
    parameters: {
        speed?: number;
    };
};

// Privacy Settings

// Manages microphone access for apps
export type ManageMicrophoneAccessAction = {
    actionName: "ManageMicrophoneAccess";
    parameters: {
        accessSetting: "allow" | "deny";
    };
};

// Manages camera access for apps
export type ManageCameraAccessAction = {
    actionName: "ManageCameraAccess";
    parameters: {
        accessSetting?: "allow" | "deny";
    };
};

// Manages location access for apps
export type ManageLocationAccessAction = {
    actionName: "ManageLocationAccess";
    parameters: {
        accessSetting?: "allow" | "deny";
    };
};

// Power Settings

// Sets the battery saver activation threshold
export type BatterySaverActivationLevelAction = {
    actionName: "BatterySaverActivationLevel";
    parameters: {
        thresholdValue: number; // 0-100
    };
};

// Sets power mode when plugged in
export type SetPowerModePluggedInAction = {
    actionName: "setPowerModePluggedIn";
    parameters: {
        powerMode: "bestPerformance" | "balanced" | "bestPowerEfficiency";
    };
};

// Sets power mode when on battery
export type SetPowerModeOnBatteryAction = {
    actionName: "SetPowerModeOnBattery";
    parameters: {
        mode?: string;
    };
};

// Gaming Settings

// Enables or disables Game Mode
export type EnableGameModeAction = {
    actionName: "enableGameMode";
    parameters: {};
};

// Accessibility Settings

// Enables or disables Narrator
export type EnableNarratorAction = {
    actionName: "EnableNarratorAction";
    parameters: {
        enable?: boolean;
    };
};

// Enables or disables Magnifier
export type EnableMagnifierAction = {
    actionName: "EnableMagnifier";
    parameters: {
        enable?: boolean;
    };
};

// Enables or disables Sticky Keys
export type EnableStickyKeysAction = {
    actionName: "enableStickyKeys";
    parameters: {
        enable: boolean;
    };
};

// Enables or disables Filter Keys
export type EnableFilterKeysAction = {
    actionName: "EnableFilterKeysAction";
    parameters: {
        enable?: boolean;
    };
};

// Enables or disables mono audio
export type MonoAudioToggleAction = {
    actionName: "MonoAudioToggle";
    parameters: {
        enable?: boolean;
    };
};

// File Explorer Settings

// Shows or hides file extensions in File Explorer
export type ShowFileExtensionsAction = {
    actionName: "ShowFileExtensions";
    parameters: {
        enable?: boolean;
    };
};

// Shows or hides hidden and system files in File Explorer
export type ShowHiddenAndSystemFilesAction = {
    actionName: "ShowHiddenAndSystemFiles";
    parameters: {
        enable?: boolean;
    };
};

// Time & Region Settings

// Enables or disables automatic time synchronization
export type AutomaticTimeSettingAction = {
    actionName: "AutomaticTimeSettingAction";
    parameters: {
        enableAutoTimeSync: boolean;
    };
};

// Enables or disables automatic DST adjustment
export type AutomaticDSTAdjustmentAction = {
    actionName: "AutomaticDSTAdjustment";
    parameters: {
        enable?: boolean;
    };
};

// Focus Assist Settings

// Enables or disables Focus Assist (Quiet Hours)
export type EnableQuietHoursAction = {
    actionName: "EnableQuietHours";
    parameters: {
        startHour?: number;
        endHour?: number;
    };
};

// Multi-Monitor Settings

// Remembers window locations based on monitor configuration
export type RememberWindowLocationsAction = {
    actionName: "RememberWindowLocations";
    parameters: {
        enable: boolean;
    };
};

// Minimizes windows when a monitor is disconnected
export type MinimizeWindowsOnMonitorDisconnectAction = {
    actionName: "MinimizeWindowsOnMonitorDisconnectAction";
    parameters: {
        enable?: boolean;
    };
};

export type KnownPrograms =
    | "chrome"
    | "word"
    | "excel"
    | "powerpoint"
    | "outlook"
    | "edge"
    | "visual studio"
    | "visual studio code"
    | "paint"
    | "notepad"
    | "calculator"
    | "file explorer"
    | "control panel"
    | "task manager"
    | "cmd"
    | "powershell"
    | "snipping tool"
    | "magnifier"
    | "paint 3d"
    | "task manager"
    | "spotify"
    | "m365 copilot";

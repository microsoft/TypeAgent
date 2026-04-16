// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type DesktopInputActions =
    | MouseCursorSpeedAction
    | MouseWheelScrollLinesAction
    | SetPrimaryMouseButtonAction
    | EnhancePointerPrecisionAction
    | AdjustMousePointerSizeAction
    | MousePointerCustomizationAction
    | CursorTrailAction
    | EnableTouchPadAction
    | TouchpadCursorSpeedAction
    | ToggleMouseSonarAction;

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
    actionName: "SetPrimaryMouseButton";
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
    actionName: "MousePointerCustomization";
    parameters: {
        color: string;
        style?: string;
    };
};

// Enables or disables the mouse cursor trail and sets its length
export type CursorTrailAction = {
    actionName: "CursorTrail";
    parameters: {
        enable: boolean;
        length?: number; // 2-12, default 7. Only used when enable is true
    };
};

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

// Enables or disables the "Find my pointer" sonar ring when pressing Ctrl
export type ToggleMouseSonarAction = {
    actionName: "ToggleMouseSonar";
    parameters: {
        enable: boolean;
    };
};

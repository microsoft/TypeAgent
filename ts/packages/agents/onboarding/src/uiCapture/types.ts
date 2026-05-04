// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * UI Automation pattern names exposed by the helper.
 * Mirrors UIAutomationHelper.Models.Pattern in the C# helper.
 */
export type Pattern =
    | "Invoke"
    | "Toggle"
    | "Value"
    | "RangeValue"
    | "Selection"
    | "SelectionItem"
    | "ExpandCollapse"
    | "Scroll"
    | "Window"
    | "Text";

/**
 * Verbs the helper can execute against an element. Slice 1 implements `invoke`;
 * the rest land in slice 2.
 */
export type ActionVerb =
    | "invoke"
    | "toggle"
    | "setValue"
    | "select"
    | "expand"
    | "scroll"
    | "sendKeys"
    | "focus"
    | "click";

export type Rect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export type ToggleState = "on" | "off" | "indeterminate";

export type TreeNode = {
    selector: string;
    automationId?: string;
    name?: string;
    controlType: string;
    className?: string;
    isEnabled: boolean;
    isOffscreen: boolean;
    hasKeyboardFocus: boolean;
    patterns: Pattern[];
    boundingRect: Rect;
    value?: string;
    toggleState?: ToggleState;
    children: TreeNode[];
};

export type WindowInfo = {
    pid: number;
    title: string;
    aumid?: string;
    mainWindow: string;
};

export type Screenshot = {
    pngBase64: string;
    rect: Rect;
};

export type ScriptHook = {
    command: string;
    args?: string[];
    cwd?: string;
};

export type SnapshotSource =
    | {
          kind: "folder";
          path: string;
          recursive?: boolean;
          exclude?: string[];
          requireKill?: boolean;
      }
    | { kind: "registry"; key: string; requireKill?: boolean }
    | {
          kind: "appCommand";
          capture?: ScriptHook;
          restore: ScriptHook;
          requireKill?: boolean;
      };

export type ProcessIdentity = {
    aumid?: string;
    processName?: string;
    exePath?: string;
};

export type DetectionStatus =
    | "auto-candidate"
    | "user-confirmed"
    | "user-provided"
    | "no-state";

export type SnapshotPolicy = {
    version: 1;
    integrationName: string;
    detectionStatus: DetectionStatus;
    processIdentity: ProcessIdentity;
    state: SnapshotSource[];
    hooks?: {
        beforeCapture?: ScriptHook[];
        afterRestore?: ScriptHook[];
    };
};

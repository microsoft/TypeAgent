// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type DisplayType = "html" | "iframe" | "text";

export type DynamicDisplay = {
    content: DisplayContent;
    nextRefreshMs: number; // in milliseconds, -1 means no more refresh.
};

export type DisplayContent =
    | string
    | {
          type: DisplayType; // Type of the content
          content: string;
          kind?: DisplayMessageKind; // Optional message kind for client specific styling
          speak?: boolean; // Optional flag to indicate if the content should be spoken
      };

export type DisplayMessageKind =
    | "info"
    | "status"
    | "warning"
    | "error"
    | "success";

export type DisplayAppendMode = "inline" | "block" | "temporary";

export type ClientAction =
    | "show-camera"
    | "show-notification"
    | "set-alarm"
    | "call-phonenumber"
    | "send-sms"
    | "search-nearby";

export interface ActionIO {
    readonly type: DisplayType;
    setDisplay(content: DisplayContent): void;

    // Append content to the display, default mode is "inline"
    appendDisplay(content: DisplayContent, mode?: DisplayAppendMode): void;

    // Tell the host process take a specific action
    takeAction(action: ClientAction, data?: unknown): void;
}

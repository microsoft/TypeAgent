// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type DisplayType = "html" | "iframe" | "text";

export type DynamicDisplay = {
    content: DisplayContent;
    nextRefreshMs: number; // in milliseconds, -1 means no more refresh.
};

// Single line, multiple lines, or table
export type MessageContent = string | string[] | string[][];

export type DisplayContent =
    | MessageContent // each string in the MessageContext is treated as text
    | {
          type: DisplayType; // Type of the content
          content: MessageContent; // each string in the MessageContext is treated as what `type` specifies
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
    | "search-nearby"
    | "automate-phone-ui";

export interface ActionIO {
    setDisplay(content: DisplayContent): void;

    // Append content to the display, default mode is "inline"
    appendDisplay(content: DisplayContent, mode?: DisplayAppendMode): void;

    // Tell the host process take a specific action
    takeAction(action: ClientAction, data?: unknown): void;
}

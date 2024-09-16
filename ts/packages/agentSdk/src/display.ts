// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type DisplayType = "html" | "text";

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
      };

export type DisplayMessageKind =
    | "info"
    | "status"
    | "warning"
    | "error"
    | "success";

export type DisplayAppendMode = "inline" | "block" | "temporary";

export interface ActionIO {
    readonly type: DisplayType;
    setDisplay(content: DisplayContent): void;

    // Append content to the display, default mode is "inline"
    appendDisplay(content: DisplayContent, mode?: DisplayAppendMode): void;
}

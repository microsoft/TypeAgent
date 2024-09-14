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
          type: DisplayType;
          content: string;
      };

export type DisplayAppendMode = "inline" | "block" | "temporary";

export interface ActionIO {
    readonly type: DisplayType;
    setDisplay(content: DisplayContent): void;
    appendDisplay(content: DisplayContent, mode?: DisplayAppendMode): void;
}

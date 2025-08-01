// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Display content to the dispatcher host.  It is up to the host to determine how to display the content
// Support for some display options varies from host to host.

// The content type to tell the host the format of the MessageContent:
// - text can supports use ANSI escape code to control additional text color and style
//   - depending on host support, host is expected to strip ANI escape code if not supported.
// - html and iframe might not be supported by all hosts.
export type DisplayType = "markdown" | "html" | "iframe" | "text";

export type DynamicDisplay = {
    content: DisplayContent;
    nextRefreshMs: number; // in milliseconds, -1 means no more refresh.
};

// Single line, multiple lines, or table
export type MessageContent = string | string[] | string[][];

export type DisplayContent =
    | MessageContent // each string in the MessageContent is treated as DisplayType "text"
    | {
          type: DisplayType; // Type of the content
          content: MessageContent; // each string in the MessageContext is treated as what `type` specifies
          kind?: DisplayMessageKind | undefined; // Optional message kind for client specific styling
          speak?: boolean; // Optional flag to indicate if the content should be spoken
      };

// Optional message kind for client specific styling
export type DisplayMessageKind =
    | "info"
    | "status"
    | "warning"
    | "error"
    | "success";

// Actual interpretation of DisplayAppendMode up to the dispatcher host.
// Block - message will be show with in a separate block from the surrounding message (new line for prev and next message)
// Inline - message will be show next the previous "inline" message.
// Temporary - same as "block", but will be replace by the next message.
export type DisplayAppendMode = "inline" | "block" | "temporary";

export type ClientAction =
    | "show-camera"
    | "show-notification"
    | "set-alarm"
    | "call-phonenumber"
    | "send-sms"
    | "search-nearby"
    | "automate-phone-ui"
    | "open-folder";

export interface ActionIO {
    // Set the display to the content provided
    setDisplay(content: DisplayContent): void;

    // Send diagnostic information back to the client
    appendDiagnosticData(data: any): void;

    // Append content to the display, default mode is "inline"
    appendDisplay(content: DisplayContent, mode?: DisplayAppendMode): void;

    // Tell the host process take a specific action
    takeAction(action: ClientAction, data?: unknown): void;
}

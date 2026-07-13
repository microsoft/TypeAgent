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

// A typed content entry with a specific display format
export interface TypedDisplayContent {
    type: DisplayType; // Type of the content
    content: MessageContent; // each string in the MessageContext is treated as what `type` specifies
    kind?: DisplayMessageKind | undefined; // Optional message kind for client specific styling
    speak?: boolean; // Optional flag to indicate if the content should be spoken
    // Alternative representations of the same content in different formats.
    // Clients should pick the best format they support (e.g., shell prefers "html", CLI prefers "text").
    // If no alternates match, clients fall back to the primary type/content.
    alternates?: Array<{ type: DisplayType; content: MessageContent }>;
}

// ---------------------------------------------------------------------------
// Structured content — a document of typed blocks (see
// docs/plans/structured-output/PLAN.md). Agents author a semantic view-model
// once; each client renders it at the highest fidelity it supports and falls
// back to the SDK-derived markdown/text `alternates` otherwise.
// ---------------------------------------------------------------------------

// Tone for a badge cell / list badge. Clients map these to colors.
export type BadgeTone = "neutral" | "info" | "success" | "warning" | "error";

// Semantic type of a table cell. Controls how a rich client renders it.
export type TableCellType =
    | "text"
    | "link"
    | "badge"
    | "number"
    | "date"
    | "code";

export interface TableColumn {
    id: string;
    header: string;
    type?: TableCellType; // default "text"
    align?: "left" | "right" | "center";
    sortable?: boolean; // per-column override of table.sortable
    // Reserved for future sticky columns. Carried in the type for
    // forward-compat; no client wires up sticky rendering yet.
    pinned?: "left" | "right";
}

// A table cell is either a bare scalar (rendered per the column type) or a
// rich object carrying a link target, badge tone, and/or tooltip.
export type TableCell =
    | string
    | number
    | {
          text: string;
          href?: string; // link target (cell type "link", or any cell)
          badge?: BadgeTone; // badge tone (cell type "badge")
          tooltip?: string;
      };

export interface TableBlock {
    kind: "table";
    columns: TableColumn[];
    rows: TableCell[][];
    caption?: string;
    // Affordances — interactive by default.
    sortable?: boolean; // default: true
    filterable?: boolean; // default: false
    readonly?: boolean; // lock order + content exactly as sent
    // Client-side pagination: render at most `pageSize` rows initially and
    // reveal the rest via a "Show more" control. All rows still ship in one
    // payload; this only affects rendering. Omit / <= 0 to show all rows.
    pageSize?: number;
    // Reserved for v2 row-actions (open question #3). Carried, not wired up.
    action?: unknown;
}

export interface HeadingBlock {
    kind: "heading";
    text: string;
    level?: 1 | 2 | 3;
}

export interface TextBlock {
    kind: "text";
    text: MessageContent;
    format?: "text" | "markdown"; // default "markdown"
}

export interface ListItem {
    text: string;
    href?: string;
    subtitle?: string;
    badges?: BadgeTone[];
}

export interface ListBlock {
    kind: "list";
    ordered?: boolean;
    items: ListItem[];
}

export interface KeyValuePair {
    label: string;
    value: TableCell;
}

export interface KeyValueBlock {
    kind: "keyValue";
    pairs: KeyValuePair[];
}

export interface CardBlock {
    kind: "card";
    title?: string;
    subtitle?: string;
    fields?: KeyValuePair[];
    href?: string;
}

export interface ImageBlock {
    kind: "image";
    src: string; // URL or dataURI; the agent rehydrates file paths
    alt?: string;
    caption?: string;
    width?: number;
    height?: number;
}

export interface CodeBlock {
    kind: "code";
    code: string;
    language?: string;
}

export interface DividerBlock {
    kind: "divider";
}

export type StructuredBlock =
    | HeadingBlock
    | TextBlock
    | TableBlock
    | ListBlock
    | KeyValueBlock
    | CardBlock
    | ImageBlock
    | CodeBlock
    | DividerBlock;

// An ordered document of typed blocks plus an optional machine-readable
// `rawData` payload. Added to the DisplayContent union so it rides the
// existing display plumbing with no new transport.
export interface StructuredContent {
    type: "structured";
    blocks: StructuredBlock[];
    rawData?: unknown; // machine-readable payload ("or otherwise" clients)
    dataSchema?: unknown; // optional JSON Schema describing rawData (carried, not enforced)
    kind?: DisplayMessageKind;
    speak?: boolean;
    // The SDK auto-derives a markdown/text alternate so clients that don't
    // understand `type: "structured"` degrade gracefully via getContentForType.
    alternates?: Array<{ type: DisplayType; content: MessageContent }>;
}

export type DisplayContent =
    | MessageContent // each string in the MessageContent is treated as DisplayType "text"
    | TypedDisplayContent
    | StructuredContent;

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
// Step - starts a new, distinct message container/bubble for this content (used by reasoning to show each phase inline).
export type DisplayAppendMode = "inline" | "block" | "temporary" | "step";

export type ClientAction =
    | "show-camera"
    | "show-notification"
    | "set-alarm"
    | "call-phonenumber"
    | "send-sms"
    | "search-nearby"
    | "automate-phone-ui"
    | "open-folder"
    | "trash-restore"
    | "trash-flush";

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

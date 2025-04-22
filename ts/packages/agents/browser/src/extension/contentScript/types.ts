// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Represents a bounding box for an element
 */
export interface BoundingBox {
    top: number;
    left: number;
    bottom: number;
    right?: number;
    width?: number;
    height?: number;
    selector?: string;
    index?: number;
}

/**
 * Represents a collection of bounding boxes for different element types
 */
export interface ElementBoundingBoxes {
    textInput: BoundingBox[];
    click: BoundingBox[];
    scroll: BoundingBox[];
    rows: BoundingBox[];
    cols: BoundingBox[];
    cells: BoundingBox[];
}

/**
 * Represents an action recorded during user interaction
 */
export interface RecordedAction {
    id: number;
    type: string;
    tag?: string;
    text?: string;
    value?: string;
    cssSelector?: string;
    boundingBox?: DOMRect;
    timestamp: number;
    htmlIndex: number;
    scrollX?: number;
    scrollY?: number;
    url?: string;
}

/**
 * Represents the result of page content extraction
 */
export interface PageContent {
    title?: string | null | undefined;
    content?: string | null | undefined;
    textContent?: string | null | undefined;
    length?: number | null | undefined;
    excerpt?: string | null | undefined;
    byline?: string | null | undefined;
    dir?: string | null | undefined;
    siteName?: string | null | undefined;
    lang?: string | null | undefined;
    formattedText?: string[];
    error?: string | null | undefined;
}

/**
 * Represents an HTML fragment
 */
export interface HtmlFragment {
    frameId: number;
    content: string;
    text?: string;
}

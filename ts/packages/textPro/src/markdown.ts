// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type MdElementName =
    | "root"
    | "br"
    | "h1"
    | "h2"
    | "h3"
    | "h4"
    | "h5"
    | "h6"
    | "p"
    | "blockquote"
    | "code"
    | "ol"
    | "ul"
    | "li"
    | "table"
    | "th"
    | "tr"
    | "td"
    | "strong"
    | "em"
    | "a";

export interface MarkdownElement {
    name: MdElementName;
    text: string;
    depth: number;
    children?: MarkdownElement[] | undefined;
    parent?: MarkdownElement | undefined;
}

export interface MarkdownImage extends MarkdownElement {
    name: "a";
    href: string;
}

export function createMdElement(
    tag: MdElementName,
    text: string = "",
    depth: number = 1,
): MarkdownElement {
    return { name: tag, text, depth };
}

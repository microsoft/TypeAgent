// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import * as cheerio from "cheerio";

/**
 * Extract all text from the given html.
 * @param html raw html
 * @param nodeQuery A JQuery like list of node types to extract text from. By default, p, div and span
 * @returns text
 */
export function htmlToText(html: string, nodeQuery?: string): string {
    //nodeQuery ??= "*:not(iframe, script, style, noscript)"; // "body, p, div, span, li, tr, td, h1, h2, h3, h4, h5, h6, a";
    nodeQuery ??=
        "a, p, div, span, em, strong, li, tr, td, h1, h2, h3, h4, h5, h6, article, section, header, footer";
    const $ = cheerio.load(html);
    const query = $(nodeQuery);
    return query
        .contents()
        .filter(function () {
            return (
                this.nodeType === 3 ||
                (this.nodeType === 1 && this.name === "a")
            );
        })
        .map(function () {
            return $(this).text().trim();
        })
        .filter(function () {
            return this.length > 0;
        })
        .get()
        .join(" ");
}

export type HtmlNode = HtmlTagNode | HtmlTextNode;

export interface HtmlTextNode {
    type: "text";
    text: string;
}

export interface HtmlTagNode {
    type: "tag";
    tagName: string;
    attribs: {
        [name: string]: string;
    };
}

export function simplifyText(html: string): string {
    const editor = new HtmlEditor(html);
    editor.simplify();
    return editor.getText().trim();
}

export function simplifyHtml(html: string): string {
    const editor = new HtmlEditor(html);
    editor.simplify();
    return editor.getHtml();
}

export function visitHtml(html: string, cb: (node: HtmlNode) => void) {}

export class HtmlEditor {
    private $: cheerio.CheerioAPI;
    private tagsToKeep: Set<string>;
    private removableAttrPrefixes: string[];

    constructor(
        public html: string,
        tagsToKeep?: string[] | undefined,
    ) {
        this.$ = cheerio.load(html);
        this.tagsToKeep = new Set(tagsToKeep ?? getTypicalTagNames());
        this.removableAttrPrefixes = getRemovableAttrPrefixes();
    }

    public getHtml(): string {
        return this.$.root().html();
    }

    public getText(): string {
        return this.$.root().text();
    }

    public simplify(simplifyAttr: boolean = true): void {
        this.keepOnly(this.$("html")[0], this.tagsToKeep);
        if (simplifyAttr) {
            this.removeAttributes();
        }
        this.trimText(this.$("html")[0]);
        this.flattenText(this.$("html")[0]);
    }

    public visitAll(cb: (node: HtmlNode) => void) {
        this.visitRecursive(this.$("html")[0], cb);
    }

    public visitRecursive(
        element: cheerio.Element,
        cb: (node: HtmlNode) => void,
    ): void {
        if (!element.children) {
            return;
        }
        for (let i = 0; i < element.children.length; ++i) {
            const child = element.children[i];
            if (child.type === "tag") {
                const childElement = child as cheerio.Element;
                const tagNode: HtmlTagNode = {
                    type: "tag",
                    tagName: childElement.tagName,
                    attribs: childElement.attribs,
                };
                cb(tagNode);
            } else if (child.type === "text") {
                const childNode = this.$(child);
                const text = childNode.text();
                if (text) {
                    cb({
                        type: "text",
                        text,
                    });
                }
            }
        }
    }

    public flattenText(element: cheerio.Element) {
        if (!element.children) {
            return;
        }
        for (let i = 0; i < element.children.length; ++i) {
            const child = element.children[i];
            if (child.type === "tag") {
                this.flattenText(child);
            }
        }
        let innerHtml: string | undefined;
        switch (element.tagName) {
            default:
                return;
            case "p":
                innerHtml = this.innerHtml(element);
                if (innerHtml) {
                    innerHtml += "\n\n";
                }
                break;
            case "div":
                innerHtml = this.innerHtml(element);
                if (innerHtml) {
                    innerHtml += "\n";
                }
                break;
            case "span":
                innerHtml = this.innerHtml(element);
                break;
        }
        this.replaceElement(element, innerHtml);
    }

    public keepOnly(element: cheerio.Element, tagsToKeep: Set<string>) {
        if (!element.children) {
            return;
        }
        for (let i = 0; i < element.children.length; ) {
            const child = element.children[i];
            switch (child.type) {
                default:
                    this.$(child).remove();
                    break;
                case "root":
                case "text":
                    ++i;
                    break;
                case "tag":
                    const childElement = child as cheerio.Element;
                    this.keepOnly(childElement, tagsToKeep);
                    if (!tagsToKeep.has(childElement.tagName)) {
                        if (this.replaceElement(childElement)) {
                            continue;
                        }
                    }
                    ++i;
                    break;
            }
        }
    }

    public removeAttributes(): void {
        this.removeAttr((attr) => this.isRemovableAttr(attr));
    }

    public removeAttr(
        attrFilter: (attr: string) => boolean,
        nodeQuery?: string,
    ) {
        nodeQuery ??= "*";
        this.$(nodeQuery).each((_, el) => {
            if (el.type !== "tag") {
                return;
            }
            for (const attr of Object.keys(el.attribs)) {
                if (attrFilter(attr)) {
                    this.$(el).removeAttr(attr);
                }
            }
        });
    }

    public trimText(element: cheerio.Element): void {
        if (!element.children) {
            return;
        }
        for (let i = 0; i < element.children.length; ++i) {
            const child = element.children[i];
            if (child.type === "tag") {
                this.trimText(child);
            }
        }
        if (!element.children) {
            return;
        }
        let i = 0;
        while (i < element.children.length) {
            const child = element.children[i];
            const childNode = this.$(child);
            if (child.type === "text") {
                let text = childNode.text();
                if (text.length > 1) {
                    text = text.trim();
                    if (text.length === 0) {
                        // Reduce the amount of unnecessary whitespace
                        childNode.replaceWith(" ");
                    }
                }
            }
            ++i;
        }
    }

    private replaceElement(
        el: cheerio.Element,
        innerHtml?: string | undefined | null,
    ): boolean {
        // Unwrap: replace the element with its children
        const $el = this.$(el);
        innerHtml ??= $el.html();
        if (innerHtml !== null && innerHtml.length > 0) {
            $el.replaceWith(innerHtml);
            return false;
        }
        $el.remove();
        return true;
    }

    private innerHtml(el: cheerio.Element): string {
        return this.$(el).html() ?? "";
    }

    private isRemovableAttr(attrName: string): boolean {
        return this.removableAttrPrefixes.some((a) => attrName.startsWith(a));
    }
}

function getTypicalTagNames(): string[] {
    return [
        "body",
        "a",
        "p",
        "div",
        "span",
        "em",
        "strong",
        "b",
        "i",
        "ol",
        "ul",
        "li",
        "table",
        "tr",
        "th",
        "td",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "article",
        "section",
        "header",
        "footer",
        "annotation",
        "blockquote",
        "code",
        "figure",
    ];
}

function getRemovableAttrPrefixes(): string[] {
    return [
        "class",
        "style",
        "aria",
        "id",
        "data",
        "tab",
        "dir",
        "x-",
        "role",
        "title",
        "lang",
        "accesskey",
    ];
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import * as cheerio from "cheerio";
import { collections } from "./index.js";

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

export type HtmlTag = {
    tag: string;
    attr?:
        | {
              [name: string]: string;
          }
        | undefined;
    text?: string | undefined;
};

export function htmlToHtmlTags(html: string): HtmlTag[] {
    const $ = cheerio.load(html);
    const nodeQuery =
        "a, p, div, span, em, strong, li, tr, th, td, h1, h2, h3, h4, h5, h6, article, section, header, footer, annotation, blockquote, code, figure";
    const htmlTags: HtmlTag[] = [];
    $(nodeQuery).each((_, el) => {
        const element = $(el);
        const tag = element[0].tagName;
        let text = getText($, element);
        //const text = $(element).text().trim();
        htmlTags.push({
            tag,
            attr: element[0].attribs,
            text: text || undefined,
        });
    });
    return htmlTags;
}

function getText(
    $: cheerio.CheerioAPI,
    element: cheerio.Cheerio<cheerio.Element>,
): string | undefined {
    let text = "";
    element.contents().each((_, child) => {
        if (child.type === "text") {
            text += $(child).text().trim();
        }
    });
    return text;
}

export function simplifyText(html: string): string {
    const editor = new HtmlEditor(html);
    editor.simplify();
    return editor.getText();
}

export function simplifyHtml(html: string): string {
    const editor = new HtmlEditor(html);
    editor.simplify();
    return editor.getHtml();
}

export class HtmlEditor {
    private $: cheerio.CheerioAPI;
    private usefulTags: Set<string>;

    constructor(
        public html: string,
        usefulTags?: string | Set<string> | undefined,
    ) {
        this.$ = cheerio.load(html.replaceAll("\n", ""));
        usefulTags ??=
            "body, a, p, div, span, em, strong, ol, ul, li, table, tr, th, td, h1, h2, h3, h4, h5, h6, article, section, header, footer, annotation, blockquote, code, figure";
        if (typeof usefulTags === "string") {
            usefulTags = collections.stringsToSet(usefulTags);
        }
        this.usefulTags = usefulTags;
    }

    public getHtml(): string {
        return this.$.root().html();
    }

    public getText(): string {
        return this.$.root().text();
    }

    public simplify() {
        this.keepOnly(this.$("html")[0], this.usefulTags);
        this.removeUnnecessaryAttr();
        this.flattenText(this.$("html")[0]);
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

    public keepOnly(element: cheerio.Element, usefulTags: Set<string>) {
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
                    this.keepOnly(childElement, usefulTags);
                    if (!usefulTags.has(childElement.tagName)) {
                        if (this.replaceElement(childElement)) {
                            continue;
                        }
                    }
                    ++i;
                    break;
            }
        }
    }

    public removeUnnecessaryAttr(): void {
        this.removeAttr((attr) => this.isProcessingAttr(attr));
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

    private isProcessingAttr(attr: string): boolean {
        return (
            attr.startsWith("class") ||
            attr.startsWith("style") ||
            attr === "id" ||
            attr === "dir" ||
            attr.startsWith("data") ||
            attr.startsWith("tab") ||
            attr.startsWith("aria")
        );
    }
}

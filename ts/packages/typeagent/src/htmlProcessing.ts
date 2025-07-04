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

function removeExtraWhitespace(html: string): string {
    return html.replaceAll(/\s+/g, " ");
}

class HtmlEditor {
    private $: cheerio.CheerioAPI;
    private tagsToKeep: Set<string>;
    private removableAttrPrefixes: string[];

    constructor(
        public html: string,
        tagsToKeep?: string[] | undefined,
    ) {
        html = removeExtraWhitespace(html);
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

export function htmlToMd(html: string, rootTag: string = "body"): string {
    const convertor = new HtmlToMdConvertor(html);
    return convertor.getMarkdown(rootTag);
}

export interface HtmlToMdConvertorEvents {
    onBlockStart(convertor: HtmlToMdConvertor, tagName: string): void;
    onHeading(
        convertor: HtmlToMdConvertor,
        tagName: string,
        level: number,
    ): void;
    onLink(convertor: HtmlToMdConvertor, text: string, url: string): void;
    onBlockEnd(convertor: HtmlToMdConvertor): void;
}

/**
 * Basic HTML to MD text convertor
 *
 * https://www.markdownguide.org/basic-syntax/
 * https://www.markdownguide.org/extended-syntax/#tables
 *
 */
export class HtmlToMdConvertor {
    private $: cheerio.CheerioAPI;
    private depth: number;
    private maxBlockDepth: number;
    private textBlocks: string[];
    private prefix: string[];

    private listStack: string[];
    public curBlock: string;

    public tagsToIgnore: string[];

    constructor(
        public html: string,
        public eventHandler?: HtmlToMdConvertorEvents,
    ) {
        html = removeExtraWhitespace(html);
        this.$ = cheerio.load(html);
        this.tagsToIgnore = [
            "header",
            "footer",
            "script",
            "link",
            "style",
            "meta",
            "form",
            "button",
            //"svg",
            "summary",
            "dialog",
            "details",
            //"react",
            "clipboard",
            "notification",
        ];
        this.textBlocks = [];
        this.curBlock = "";
        this.prefix = [];
        this.depth = 0;
        this.maxBlockDepth = 1;

        this.listStack = [];
    }

    public getMarkdown(rootPath = "body"): string {
        return this.getMarkdownBlocks(rootPath).join("");
    }

    public getMarkdownBlocks(rootPath: string = "body"): string[] {
        this.start();
        const root: cheerio.AnyNode = this.$(rootPath)[0];
        if (root && root.type === "tag") {
            this.traverseChildren(root as cheerio.Element);
        }
        return this.textBlocks;
    }

    private start(): void {
        this.textBlocks = [];
        this.curBlock = "";
        this.prefix = [];
        this.depth = 0;
        this.listStack = [];
    }

    private traverseChildren(element: cheerio.Element): void {
        for (let i = 0; i < element.children.length; ++i) {
            const child = element.children[i];
            switch (child.type) {
                default:
                    break;
                case "tag":
                    const childElement = child as cheerio.Element;
                    const tagName = childElement.tagName;
                    switch (tagName) {
                        default:
                            const shouldSkipTag = this.tagsToIgnore.some(
                                (tagPrefix) =>
                                    tagName === tagPrefix ||
                                    tagName.startsWith(tagPrefix),
                            );

                            if (!shouldSkipTag) {
                                this.traverseChildren(childElement);
                            }
                            break;
                        case "h1":
                        case "h2":
                        case "h3":
                        case "h4":
                        case "h5":
                        case "h6":
                            this.beginBlock(tagName);
                            this.appendPrefix();
                            this.appendHeading(
                                this.$(childElement).text(),
                                Number.parseInt(tagName[tagName.length - 1]),
                            );
                            this.endBlock();
                            break;
                        case "p":
                            this.beginBlock(tagName);
                            this.appendPrefix();
                            this.traverseChildren(childElement);
                            this.append("\n");
                            this.appendBlankLine();
                            this.endBlock();
                            break;
                        case "div":
                            this.appendPrefix();
                            this.traverseChildren(childElement);
                            this.appendLineBreak();
                            //this.append("\n");
                            break;
                        case "span":
                            this.traverseChildren(childElement);
                            break;
                        case "article":
                        case "section":
                            this.traverseChildren(childElement);
                            break;
                        case "blockquote":
                            this.beginBlock(tagName);
                            this.appendBlankLine();

                            this.appendPrefix();
                            this.append("> ");

                            this.prefix.push(">");
                            this.traverseChildren(childElement);
                            this.prefix.pop();

                            this.append("\n");
                            this.appendBlankLine();
                            this.endBlock();
                            break;
                        case "code":
                            this.beginBlock(tagName);
                            this.appendPrefix();
                            this.append("\t");
                            this.traverseChildren(childElement);
                            this.append("\n");
                            this.endBlock();
                            break;
                        case "ul":
                        case "ol":
                            this.beginBlock(tagName);
                            this.beginList(tagName);
                            this.traverseChildren(childElement);
                            this.endList();
                            this.endBlock();
                            break;
                        case "li":
                            this.appendPrefix();
                            if (this.listStack.length > 0) {
                                if (
                                    this.listStack[
                                        this.listStack.length - 1
                                    ] === "ul"
                                ) {
                                    this.append("- ");
                                } else {
                                    this.append("1. ");
                                }
                            }
                            this.traverseChildren(childElement);
                            this.append("\n");
                            break;
                        case "table":
                            this.beginBlock(tagName);
                            this.traverseChildren(childElement);
                            this.append("\n");
                            this.endBlock();
                            break;
                        case "tr":
                            this.traverseChildren(childElement);
                            this.append("|\n");
                            if (this.isTableHeader(childElement)) {
                                this.append(
                                    "| ---".repeat(element.children.length),
                                );
                                this.append("|\n");
                            }
                            break;
                        case "th":
                        case "td":
                            this.append("|");
                            this.traverseChildren(childElement);
                            break;
                        case "strong":
                        case "b":
                            this.append("**");
                            this.traverseChildren(childElement);
                            this.append("**");
                            break;
                        case "em":
                        case "i":
                            this.append("__");
                            this.traverseChildren(childElement);
                            this.append("__");
                            break;
                        case "a":
                            if (childElement.children.length > 0) {
                                const text = this.getInnerText(childElement);
                                if (text) {
                                    const href = childElement.attribs["href"];
                                    this.append(`[${text}](${href})`);
                                    this.eventHandler?.onLink(this, text, href);
                                }
                            }
                            break;
                        case "br":
                            this.appendLineBreak();
                            break;
                    }
                    break;
                case "text":
                    let text = this.getInnerText(child);
                    if (text && text.length > 0) {
                        this.append(text);
                    }
                    break;
            }
        }
    }

    private getInnerText(node: any): string | undefined {
        const childNode = this.$(node);
        let text = childNode.text();
        let originalLength = text.length;
        let spacesAdded = 0;
        if (originalLength > 0) {
            // Spaces are meaningful, but generated html can contain unnecessary whitespace
            text = text.trimStart();
            if (originalLength - text.length > 0) {
                text = " " + text;
                originalLength = text.length;
                spacesAdded++;
            }
            text = text.trimEnd();
            if (originalLength - text.length > 0) {
                // More than one trailing space.
                text += " ";
                spacesAdded++;
            }
            if (spacesAdded === 0 || text.length > spacesAdded) {
                return text;
            }
        }
        return undefined;
    }

    private beginBlock(name: string): void {
        this.depth++;
        if (this.depth <= this.maxBlockDepth) {
            this.endBlock(false);
            this.eventHandler?.onBlockStart(this, name);
        }
    }

    private endBlock(reduceDepth: boolean = true): void {
        if (this.depth <= this.maxBlockDepth) {
            if (this.curBlock.length > 0) {
                this.textBlocks.push(this.curBlock);
                this.eventHandler?.onBlockEnd(this);
            }
            this.curBlock = "";
        }
        if (this.depth > 0 && reduceDepth) {
            this.depth--;
        }
    }

    private beginList(tagName: string): void {
        this.listStack.push(tagName);
        if (this.listStack.length > 1) {
            this.append("\n");
            this.prefix.push("  ");
        }
    }

    private endList(): void {
        if (this.listStack.length > 1) {
            this.prefix.pop();
        }
        this.listStack.pop();
        this.append("\n");
    }

    private appendPrefix(): void {
        for (let i = 0; i < this.prefix.length; ++i) {
            this.curBlock += this.prefix[i];
        }
    }

    private append(text: string): void {
        this.curBlock += text;
    }

    private appendBlankLine(): void {
        this.appendPrefix();
        this.append("\n");
    }

    private appendLineBreak(): void {
        this.append("  ");
    }

    private appendHeading(text: string, level: number): void {
        this.appendBlankLine();
        this.append("#".repeat(level));
        this.curBlock += " ";
        this.append(text);
        this.append("\n");

        this.eventHandler?.onHeading(this, text, level);
    }

    private isTableHeader(element: cheerio.Element): boolean {
        for (let i = 0; i < element.children.length; ++i) {
            const child = element.children[i];
            if (child.type === "tag" && child.tagName !== "th") {
                return false;
            }
        }
        return true;
    }
}

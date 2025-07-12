// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import * as cheerio from "cheerio";
import {
    createMdElement,
    MdElement,
    MdImageElement,
    MdElementName,
    MdWriterEvents,
    mdToText,
} from "./markdown.js";

/**
 * Returns text from html. Only takes text from typically useful nodes, cleaning up
 * whitespace etc.
 * @param html Html to extract text from
 * @returns raw text
 */
export function htmlToText(html: string): string {
    const editor = new HtmlEditor(html);
    editor.simplify();
    return editor.getText().trim();
}

/**
 * Simplify the HTML in an HTML document. Returns the simplified HTML.
 *  - Removes nodes that are not typically needed for text processing, such as script, stylesheets etc.
 *  - Removes processing and other custom attributes on tags
 *  - Cleans up whitespace and flattens overly nested text nodes
 * @param html html text
 * @returns simplified html
 */
export function simplifyHtml(html: string): string {
    const editor = new HtmlEditor(html);
    editor.simplify();
    return editor.getHtml();
}

/**
 * Convert html to markdown
 * @param html html text
 * @param rootTag Root tag at which to start conversion. Can be a JQuery like expression
 * @returns MD text
 */
export function htmlToMd(
    html: string,
    eventHandler?: MdWriterEvents,
    rootTag: string = "body",
): string {
    const dom = htmlToMdDom(html, rootTag);
    return mdToText(dom, eventHandler);
}

export function htmlToMdDom(html: string, rootTag: string = "body"): MdElement {
    const convertor = new HtmlToMarkdownDom(html);
    return convertor.getMarkdown(rootTag);
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
        return this.$.root().html() ?? "";
    }

    public getText(): string {
        return this.$.root().text();
    }

    /**
     * Simplify the HTML in an HTML document. Returns the simplified HTML.
     *  - Removes nodes that are not typically needed for text processing, such as script, stylesheets etc.
     *  - (Optionall) Cleans up processing and other custom attributes on tags
     *  - Cleans up whitespace and flattens overly nested text nodes
     * @param simplifyAttr
     */
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

export class HtmlToMarkdownDom {
    private $: cheerio.CheerioAPI;
    private depth: number;
    private root: MdElement;
    public curElement: MdElement;

    public tagsToIgnore: string[];

    constructor(public html: string) {
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
        this.root = createMdElement("p");
        this.curElement = this.root;
        this.depth = 0;
    }

    public getMarkdown(rootPath: string = "body"): MdElement {
        this.start();
        const root: cheerio.AnyNode = this.$(rootPath)[0];
        if (root && root.type === "tag") {
            this.traverseChildren(root as cheerio.Element);
        }
        return this.root;
    }

    private start(): void {
        this.root = createMdElement("p");
        this.curElement = this.root;
        this.depth = 0;
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
                            this.beginElement(tagName);
                            this.append(this.$(childElement).text());
                            this.endElement();
                            break;
                        case "p":
                        case "blockquote":
                        case "code":
                        case "ul":
                        case "ol":
                            this.beginBlock(tagName);
                            this.traverseChildren(childElement);
                            this.endBlock();
                            break;
                        case "div":
                            this.traverseChildren(childElement);
                            this.appendLineBreak();
                            break;
                        case "span":
                            this.traverseChildren(childElement);
                            break;
                        case "article":
                        case "section":
                            this.traverseChildren(childElement);
                            break;
                        case "li":
                        case "table":
                        case "tr":
                        case "th":
                        case "td":
                            this.beginElement(tagName);
                            this.traverseChildren(childElement);
                            this.endElement();
                            break;
                        case "strong":
                        case "b":
                            this.beginElement("strong");
                            this.traverseChildren(childElement);
                            this.endElement();
                            break;
                        case "em":
                        case "i":
                            this.beginElement("em");
                            this.traverseChildren(childElement);
                            this.endElement();
                            break;
                        case "a":
                            const img: MdImageElement = {
                                name: "a",
                                text: "",
                                href: childElement.attribs["href"],
                                depth: this.depth,
                            };
                            if (childElement.children.length > 0) {
                                img.text =
                                    this.getInnerText(childElement) ?? "";
                            }
                            this.appendChild(img);
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

    private beginBlock(tag: MdElementName): void {
        this.depth++;
        this.beginElement(tag);
    }

    private endBlock(): void {
        this.endElement();
        this.depth--;
    }

    private beginElement(tag: MdElementName): void {
        const node = createMdElement(tag, "", this.depth);
        this.appendChild(node);
        this.curElement = node;
    }

    private endElement(): void {
        if (this.curElement.parent) {
            this.curElement = this.curElement.parent;
        } else {
            throw new Error(
                `DOM corrupt: ${this.curElement.name}; [${this.depth}]`,
            );
        }
    }

    private appendChild(node: MdElement): void {
        this.curElement.children ??= [];
        this.curElement.children.push(node);
        node.parent = this.curElement;
    }

    private append(text: string): void {
        this.curElement.text += text;
    }

    private appendLineBreak(): void {
        this.curElement.text += "  \n";
    }
}

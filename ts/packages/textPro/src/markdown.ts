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

export interface MdElement {
    name: MdElementName;
    text: string;
    depth: number;
    children?: MdElement[] | undefined;
    parent?: MdElement | undefined;
}

export interface MdImageElement extends MdElement {
    name: "a";
    href: string;
}

export function createMdElement(
    tag: MdElementName,
    text: string = "",
    depth: number = 1,
): MdElement {
    return { name: tag, text, depth };
}

export interface MdWriterEvents {
    onBlockStart(element: MdElement): void;
    onHeading(element: MdElement, level: number): void;
    onLink(element: MdImageElement): void;
    onBlockEnd(element: MdElement): void;
}

/**
 * Basic HTML to MD text convertor
 *
 * https://www.markdownguide.org/basic-syntax/
 * https://www.markdownguide.org/extended-syntax/#tables
 *
 */
export class MdWriter {
    private maxBlockDepth: number;
    private textBlocks: string[];
    private prefix: string[];

    private listStack: string[];
    public curBlock: string;

    constructor(public eventHandler?: MdWriterEvents) {
        this.textBlocks = [];
        this.curBlock = "";
        this.prefix = [];
        this.maxBlockDepth = 1;

        this.listStack = [];
    }

    public getMarkdown(element: MdElement): string {
        return this.getTextBlocks(element).join("");
    }

    public getTextBlocks(element: MdElement): string[] {
        this.start();
        this.traverseChildren(element);
        return this.textBlocks;
    }

    private start(): void {
        this.textBlocks = [];
        this.curBlock = "";
        this.prefix = [];
        this.listStack = [];
    }

    private collectText(element: MdElement): void {
        switch (element.name) {
            default:
                break;
            case "h1":
            case "h2":
            case "h3":
            case "h4":
            case "h5":
            case "h6":
                this.beginBlock(element);
                this.appendHeading(element);
                this.endBlock(element);
                break;
            case "p":
                this.beginBlock(element);
                this.appendPrefix();
                this.traverseChildren(element);
                this.append("\n");
                this.appendBlankLine();
                this.endBlock(element);
                break;
            case "blockquote":
                this.beginBlock(element);
                this.appendBlankLine();

                this.appendPrefix();
                this.append("> ");

                this.prefix.push(">");
                this.traverseChildren(element);
                this.prefix.pop();

                this.append("\n");
                this.appendBlankLine();
                this.endBlock(element);
                break;
            case "code":
                this.beginBlock(element);
                this.appendPrefix();
                this.append("\t");
                this.traverseChildren(element);
                this.append("\n");
                this.endBlock(element);
                break;
            case "ul":
            case "ol":
                this.beginBlock(element);
                this.beginList(element.name);
                this.traverseChildren(element);
                this.endList();
                this.endBlock(element);
                break;
            case "li":
                this.appendPrefix();
                const list = this.currentList();
                if (list !== undefined) {
                    if (list === "ul") {
                        this.append("- ");
                    } else {
                        this.append("1. ");
                    }
                }
                this.traverseChildren(element);
                this.append("\n");
                break;
            case "table":
                this.beginBlock(element);
                this.traverseChildren(element);
                this.append("\n");
                this.endBlock(element);
                break;
            case "tr":
                this.traverseChildren(element);
                this.append("|\n");
                if (this.isTableHeader(element)) {
                    this.append("| ---".repeat(element.children!.length));
                    this.append("|\n");
                }
                break;
            case "th":
            case "td":
                this.append("|");
                this.traverseChildren(element);
                break;
            case "strong":
                this.append("**");
                this.traverseChildren(element);
                this.append("**");
                break;
            case "em":
                this.append("__");
                this.traverseChildren(element);
                this.append("__");
                break;
            case "a":
                const img = element as MdImageElement;
                this.append(`[${img.text}](${img.href})`);
                break;
            case "br":
                this.appendLineBreak();
                break;
        }
    }

    private traverseChildren(element: MdElement): void {
        if (element.children !== undefined && element.children.length > 0) {
            for (const child of element.children) {
                this.collectText(child);
            }
        }
    }

    private beginBlock(element: MdElement): void {
        if (element.depth <= this.maxBlockDepth) {
            this.endBlock(element);
            this.eventHandler?.onBlockStart(element);
        }
    }

    private endBlock(element: MdElement): void {
        if (element.depth <= this.maxBlockDepth) {
            if (this.curBlock.length > 0) {
                this.textBlocks.push(this.curBlock);
                this.eventHandler?.onBlockEnd(element);
            }
            this.curBlock = "";
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

    private currentList(): string | undefined {
        return this.listStack !== undefined
            ? this.listStack[this.listStack.length - 1]
            : undefined;
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

    private appendHeading(element: MdElement): void {
        const level = Number.parseInt(element.name[element.name.length - 1]);
        this.appendBlankLine();
        this.append("#".repeat(level));
        this.curBlock += " ";
        this.append(element.text);
        this.append("\n");

        this.eventHandler?.onHeading(element, level);
    }

    private isTableHeader(element: MdElement): boolean {
        if (element.children === undefined) {
            return false;
        }
        for (let i = 0; i < element.children.length; ++i) {
            const child = element.children[i];
            if (child.name !== "th") {
                return false;
            }
        }
        return true;
    }
}

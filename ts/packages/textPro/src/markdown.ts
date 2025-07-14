// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as md from "marked";
import { htmlToMd } from "./htmlProcessing.js";

export function loadMarkdown(text: string): md.TokensList {
    return md.lexer(text);
}

export function loadMarkdownFromHtml(
    html: string,
    rootTag?: string,
): md.TokensList {
    const markdown = htmlToMd(html, rootTag);
    return loadMarkdown(markdown);
}

export interface MdChunkerEvents {
    onBlockStart(name: string): void;
    onHeading(level: number): void;
    onBlockEnd(): void;
}

/**
 * Markdown chunker
 *
 * https://www.markdownguide.org/basic-syntax/
 * https://www.markdownguide.org/extended-syntax/#tables
 *
 */
export class MdChunker {
    private tokenList: md.TokensList;
    private depth: number;
    private maxBlockDepth: number;
    private textBlocks: string[];

    public curBlock: string;

    constructor(
        public markdown: string | md.TokensList,
        public eventHandler?: MdChunkerEvents,
    ) {
        this.tokenList =
            typeof markdown === "string" ? loadMarkdown(markdown) : markdown;
        this.depth = 0;
        this.maxBlockDepth = 1;
        this.textBlocks = [];
        this.curBlock = "";
    }

    public getMarkdownBlocks(): string[] {
        this.start();
        this.traverseTokenList(this.tokenList);
        return this.textBlocks;
    }

    private start(): void {
        this.depth = 0;
        this.textBlocks = [];
        this.curBlock = "";
    }

    private traverseTokenList(tokens?: md.Token[]) {
        if (tokens !== undefined && tokens.length > 0) {
            for (let i = 0; i < tokens.length; ++i) {
                this.collectText(tokens[i]);
            }
        }
    }

    private collectText(token: md.Token): void {
        switch (token.type) {
            default:
                const text = (token as any).text;
                this.append(text !== undefined ? text : token.raw);
                break;
            case "paragraph":
                this.beginBlock(token.type);
                this.append(token.text);
                this.endBlock();
                break;
            case "heading":
                this.beginBlock(token.type);
                this.eventHandler?.onHeading(token.depth);
                this.append(token.raw);
                this.endBlock();
                break;
        }
    }

    private beginBlock(name: string): void {
        this.depth++;
        if (this.depth <= this.maxBlockDepth) {
            this.endBlock(false);
            this.eventHandler?.onBlockStart(name);
        }
    }

    private endBlock(reduceDepth: boolean = true): void {
        if (this.depth <= this.maxBlockDepth) {
            if (this.curBlock.length > 0) {
                this.textBlocks.push(this.curBlock);
                this.eventHandler?.onBlockEnd();
            }
            this.curBlock = "";
        }
        if (this.depth > 0 && reduceDepth) {
            this.depth--;
        }
    }

    private append(text: string): void {
        this.curBlock += text;
    }
}

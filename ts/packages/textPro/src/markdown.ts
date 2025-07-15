// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as md from "marked";
import { conversation as kpLib } from "knowledge-processor";
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

export interface MarkdownBlockVisitor {
    onBlockStart(name: string): void;
    onHeading(text: string, level: number): void;
    onLink(text: string, url: string): void;
    onToken(name: string, text: string): void;
    onBlockEnd(): void;
}

export class MarkdownBlockCollector {
    private tokenList: md.TokensList;
    private depth: number;
    private maxBlockDepth: number;
    private visitor?: MarkdownBlockVisitor | undefined;

    public textBlocks: string[];
    public curTextBlock: string;

    constructor(public markdown: string | md.TokensList) {
        this.tokenList =
            typeof markdown === "string" ? loadMarkdown(markdown) : markdown;
        this.depth = 0;
        this.maxBlockDepth = 1;
        this.textBlocks = [];
        this.curTextBlock = "";
    }

    public getMarkdownBlocks(visitor?: MarkdownBlockVisitor): string[] {
        this.visitor = visitor;
        this.start();
        this.traverseTokenList(this.tokenList);
        return this.textBlocks;
    }

    private start(): void {
        this.depth = 0;
        this.textBlocks = [];
        this.curTextBlock = "";
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
                /*
                const text = (token as any).text;
                this.append(text !== undefined ? text : token.raw);
                */
                this.append(token.raw);
                if (token.type !== "space") {
                    let text = (token as any).text;
                    this.visitor?.onToken(text, text ?? token.raw);
                }
                break;
            case "paragraph":
            case "blockquote":
            case "codespan":
            case "list":
            case "table":
                this.beginBlock(token.type);
                this.append(token.raw);
                this.endBlock();
                break;
            case "heading":
                this.beginBlock(token.type);
                this.append(token.raw);
                this.visitor?.onHeading(token.raw, token.depth);
                this.endBlock();
                break;
            case "link":
                this.append(token.raw);
                this.visitor?.onLink(token.text, token.href);
                break;
        }
        let children: md.Token[] = (token as any).tokens;
        if (children !== undefined && children.length > 0) {
            this.traverseTokenList(children);
        }
    }

    private beginBlock(name: string): void {
        this.depth++;
        if (this.depth <= this.maxBlockDepth) {
            this.endBlock(false);
            this.visitor?.onBlockStart(name);
        }
    }

    private endBlock(reduceDepth: boolean = true): void {
        if (this.depth <= this.maxBlockDepth) {
            if (this.curTextBlock.length > 0) {
                this.textBlocks.push(this.curTextBlock);
                this.visitor?.onBlockEnd();
            }
            this.curTextBlock = "";
        }
        if (this.depth > 0 && reduceDepth) {
            this.depth--;
        }
    }

    private append(text: string): void {
        this.curTextBlock += text;
    }
}

export type MarkdownKnowledgeBlock = {
    tags: string[];
    knowledge: kpLib.KnowledgeResponse;
};

export class MarkdownKnowledgeCollector implements MarkdownBlockVisitor {
    public knowledgeBlocks: MarkdownKnowledgeBlock[];

    private headingsInScope: Map<number, string>;
    private linksInScope: Map<string, string>;
    private knowledgeBlock: MarkdownKnowledgeBlock;

    private lastTokenName: string = "";
    private lastTokenText: string = "";

    constructor() {
        this.knowledgeBlocks = [];
        this.headingsInScope = new Map<number, string>();
        this.linksInScope = new Map<string, string>();
        this.knowledgeBlock = createMarkdownKnowledgeBlock();
    }

    onToken(name: string, text: string): void {
        if (name !== "space") {
            this.lastTokenText = name;
        }
    }

    onBlockStart(blockName: string): void {
        switch (blockName) {
            default:
                this.knowledgeBlock.tags.push(blockName);
                break;
            case "codespan":
                this.knowledgeBlock.tags.push("code");
                break;
            case "list":
                this.knowledgeBlock.tags.push(blockName);
                if (this.lastTokenName === "heading") {
                    this.knowledgeBlock.knowledge.entities.push({
                        name: this.lastTokenText,
                        type: ["list"],
                    });
                }
                break;
            case "table":
                this.knowledgeBlock.tags.push(blockName);
                if (this.lastTokenName === "heading") {
                    this.knowledgeBlock.knowledge.entities.push({
                        name: this.lastTokenText,
                        type: ["table"],
                    });
                }
                break;
        }
    }

    onHeading(headingText: string, level: number): void {
        // Any heading level > level is no longer in scope
        const curLevels = [...this.headingsInScope.keys()];
        for (const hLevel of curLevels) {
            if (hLevel > level) {
                this.headingsInScope.delete(hLevel);
            }
        }
        this.headingsInScope.set(level, headingText);
        this.lastTokenText = headingText;
    }

    onLink(text: string, url: string): void {
        this.linksInScope.set(text, url);
    }

    onBlockEnd(): void {
        // Include top K headings in scope.. as topics and entities
        const topK = 2;
        let headingLevelsInScope = [...this.headingsInScope.keys()].sort(
            (x, y) => y - x, // Descending
        );

        headingLevelsInScope = headingLevelsInScope.slice(0, topK);
        for (const headerLevel of headingLevelsInScope) {
            const headerText = this.headingsInScope.get(headerLevel)!;
            this.knowledgeBlock.knowledge.topics.push(headerText);
            this.knowledgeBlock.knowledge.entities.push(
                headingToEntity(headerText, headerLevel),
            );
            // Also make he header text a tag
            this.knowledgeBlock.tags.push(headerText);
        }
        //
        // Also include all links
        //
        for (const linkText of this.linksInScope.keys()) {
            this.knowledgeBlock.knowledge.entities.push(
                linkToEntity(linkText, this.linksInScope.get(linkText)!),
            );
        }
        this.knowledgeBlocks.push(this.knowledgeBlock);
        //
        // Start next block
        // Note: do not clear headingsInScope as they stay active for the duration of the conversion pass
        // Links are only active for the current block
        //
        this.knowledgeBlock = createMarkdownKnowledgeBlock();
        this.linksInScope.clear();
    }
}

export function headingToEntity(
    headingText: string,
    level: number,
): kpLib.ConcreteEntity {
    return {
        name: headingText,
        type: ["heading", "section"],
        facets: [{ name: "level", value: level }],
    };
}

export function linkToEntity(
    linkText: string,
    url: string,
): kpLib.ConcreteEntity {
    return {
        name: linkText,
        type: ["link", "url"],
        facets: [{ name: "url", value: url }],
    };
}

function createKnowledgeResponse(): kpLib.KnowledgeResponse {
    return {
        entities: [],
        actions: [],
        inverseActions: [],
        topics: [],
    };
}

function createMarkdownKnowledgeBlock(): MarkdownKnowledgeBlock {
    return {
        tags: [],
        knowledge: createKnowledgeResponse(),
    };
}

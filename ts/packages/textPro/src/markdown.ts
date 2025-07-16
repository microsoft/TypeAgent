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

/**
 * Recursively traverse the given markdown
 * @param markdown
 * @param tokenHandler
 */
export function traverseMarkdownTokens(
    tokens: md.Token[],
    tokenHandler: (token: md.Token, parentToken: md.Token | undefined) => void,
    parentToken?: md.Token,
): void {
    if (tokens !== undefined && tokens.length > 0) {
        for (let i = 0; i < tokens.length; ++i) {
            const token = tokens[i];
            tokenHandler(token, parentToken);
            const children = getChildTokens(token);
            if (children !== undefined && children.length > 0) {
                traverseMarkdownTokens(children, tokenHandler, token);
            }
        }
    }
}

function getChildTokens(token: md.Token): md.Token[] | undefined {
    const parent = token as any;
    return parent.tokens || parent.items;
}

export interface MarkdownBlockHandler {
    onBlockStart(token: md.Token, parentToken?: md.Token | undefined): void;
    onBlockEnd(curTextBlock: string): void;
    onToken(
        curTextBlock: string,
        token: md.Token,
        parentToken?: md.Token | undefined,
    ): void;
}

export function getTextBlocksFromMarkdown(
    markdown: string | md.TokensList,
    handler?: MarkdownBlockHandler,
): string[] {
    const markdownTokens =
        typeof markdown === "string" ? loadMarkdown(markdown) : markdown;
    let textBlocks: string[] = [];
    let curTextBlock = "";
    traverseTokens(markdownTokens);

    return textBlocks;

    function traverseTokens(
        tokens: md.Token[] | undefined,
        parentToken?: md.Token | undefined,
    ) {
        if (tokens !== undefined && tokens.length > 0) {
            for (let i = 0; i < tokens.length; ++i) {
                const token = tokens[i];
                collectText(token, parentToken);
            }
        }
    }

    function collectText(
        token: md.Token,
        parentToken: md.Token | undefined,
    ): void {
        switch (token.type) {
            default:
                curTextBlock += token.raw;
                handler?.onToken(curTextBlock, token, parentToken);
                visitInnerMarkup(token);
                break;
            case "space":
                curTextBlock += token.raw;
                break;
            case "text":
                curTextBlock += token.raw;
                break;
            case "paragraph":
            case "blockquote":
            case "codespan":
            case "list":
            case "table":
            case "heading":
                beginBlock(token, parentToken);
                curTextBlock += token.raw;
                visitInnerMarkup(token);
                endBlock();
                break;
        }
    }

    function visitInnerMarkup(token: md.Token): void {
        const children = getChildTokens(token);
        if (children !== undefined && children.length > 0) {
            visitMarkup(children);
        }
    }

    function visitMarkup(tokens: md.Token[]): void {
        for (let i = 0; i < tokens.length; ++i) {
            const token = tokens[i];
            switch (token.type) {
                default:
                    handler?.onToken(curTextBlock, token);
                    visitInnerMarkup(token);
                    break;
                case "text":
                case "space":
                    break;
            }
        }
    }

    function beginBlock(
        token: md.Token,
        parentToken?: md.Token | undefined,
    ): void {
        endBlock(false);
        handler?.onBlockStart(token, parentToken);
    }

    function endBlock(reduceDepth: boolean = true): void {
        if (curTextBlock.length > 0) {
            textBlocks.push(curTextBlock);
            handler?.onBlockEnd(curTextBlock);
        }
        curTextBlock = "";
    }
}

export type MarkdownKnowledgeBlock = {
    tags: string[];
    knowledge: kpLib.KnowledgeResponse;
};

export function getTextAndKnowledgeBlocksFromMarkdown(
    markdown: string | md.TokensList,
): [string[], MarkdownKnowledgeBlock[]] {
    const knowledgeCollector = new MarkdownKnowledgeCollector();
    const textBlocks = getTextBlocksFromMarkdown(markdown, knowledgeCollector);
    const knowledgeBlocks = knowledgeCollector.knowledgeBlocks;
    if (textBlocks.length !== knowledgeBlocks.length) {
        throw new Error(
            `TextBlocks length ${textBlocks.length} !== KnowledgeBlock ${knowledgeBlocks.length} length`,
        );
    }
    return [textBlocks, knowledgeBlocks];
}

class MarkdownKnowledgeCollector implements MarkdownBlockHandler {
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

    onToken(curTextBlock: string, token: md.Token): void {
        if (token.type === "space") {
            return;
        }
        this.lastTokenText = token.type;
        switch (token.type) {
            default:
                break;
            case "link":
                const link = token as md.Tokens.Link;
                this.onLink(link.text, link.href);
                break;
        }
    }

    onBlockStart(token: md.Token): void {
        const blockName = token.type;
        switch (blockName) {
            default:
                this.knowledgeBlock.tags.push(blockName);
                break;
            case "heading":
                const heading = token as md.Tokens.Heading;
                this.onHeading(heading.text, heading.depth);
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

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as md from "marked";
import { conversation as kpLib } from "knowledge-processor";

/**
 * Parses markdown into a token DOM using the "marked" library
 * @param markdown
 * @returns
 */
export function tokenizeMarkdown(markdown: string): md.TokensList {
    return md.lexer(markdown);
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
    onBlockStart(): void;
    onBlockEnd(curTextBlock: string): void;
    onToken(
        curTextBlock: string,
        token: md.Token,
        parentToken?: md.Token | undefined,
    ): void;
}

/**
 * Splits markdown text into text blocks
 * @param markdown
 * @param handler
 * @param maxChunkLength
 * @returns
 */
export function textBlocksFromMarkdown(
    markdown: string | md.Token[],
    handler?: MarkdownBlockHandler,
    maxChunkLength?: number,
): string[] {
    const markdownTokens =
        typeof markdown === "string" ? tokenizeMarkdown(markdown) : markdown;
    let textBlocks: string[] = [];
    let curTextBlock = "";
    let prevBlockName: string = "";
    let prevTokenName: string = "";
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
                prevTokenName = token.type;
            }
            endBlock();
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
                visitInnerNodes(token);
                break;
            case "space":
            case "br":
                curTextBlock += "\n";
                break;
            case "text":
                curTextBlock += token.raw;
                break;
            case "paragraph":
                beginBlock(
                    token,
                    prevBlockName === "paragraph" ||
                        prevBlockName === "heading" ||
                        prevTokenName === "space",
                    parentToken,
                );
                curTextBlock += token.raw;
                visitInnerNodes(token);
                break;
            case "list":
            case "table":
                beginBlock(
                    token,
                    prevBlockName === "heading" ||
                        prevBlockName === "paragraph",
                    parentToken,
                );
                curTextBlock += token.raw;
                visitInnerNodes(token);
                break;
            case "blockquote":
            case "codespan":
            case "heading":
                beginBlock(token, false, parentToken);
                curTextBlock += token.raw;
                visitInnerNodes(token);
                break;
        }
    }

    function visitInnerNodes(token: md.Token): void {
        const children = getChildTokens(token);
        if (children !== undefined && children.length > 0) {
            visitNodes(children);
        }
    }

    function visitNodes(tokens: md.Token[]): void {
        for (let i = 0; i < tokens.length; ++i) {
            const token = tokens[i];
            switch (token.type) {
                default:
                    handler?.onToken(curTextBlock, token);
                    visitInnerNodes(token);
                    break;
                case "text":
                case "space":
                    break;
            }
        }
    }

    function beginBlock(
        token: md.Token,
        shouldMerge: boolean,
        parentToken?: md.Token | undefined,
    ): void {
        // If we just saw a heading, just keep collecting the text block associated with it
        if (
            !prevBlockName ||
            !shouldMerge ||
            (maxChunkLength !== undefined &&
                curTextBlock.length > maxChunkLength)
        ) {
            endBlock(false);
            curTextBlock = "";
            handler?.onBlockStart();
        }
        handler?.onToken(curTextBlock, token, parentToken);
        prevBlockName = token.type;
    }

    function endBlock(reduceDepth: boolean = true): void {
        if (curTextBlock.length > 0) {
            textBlocks.push(curTextBlock);
            handler?.onBlockEnd(curTextBlock);
        }
    }
}

export type MarkdownKnowledgeBlock = {
    tags: Set<string>;
    sTags: kpLib.ConcreteEntity[];
    knowledge: kpLib.KnowledgeResponse;
};

/**
 * Parses the given markdown text and chunks it at logical boundaries.
 * @param markdown markdown string
 * @param maxChunkLength
 * @returns
 */
export function textAndKnowledgeBlocksFromMarkdown(
    markdown: string | md.TokensList,
    maxChunkLength?: number,
): [string[], MarkdownKnowledgeBlock[]] {
    const knowledgeCollector = new MarkdownKnowledgeCollector();
    const textBlocks = textBlocksFromMarkdown(
        markdown,
        knowledgeCollector,
        maxChunkLength,
    );
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

    private lastToken: md.Token | undefined;

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
        switch (token.type) {
            default:
                break;
            case "heading":
                const heading = token as md.Tokens.Heading;
                this.onHeading(heading.text, heading.depth);
                break;
            case "codespan":
            case "code":
                this.knowledgeBlock.tags.add("code");
                break;
            case "list":
                this.knowledgeBlock.tags.add("list");
                const listName = this.getPrecedingHeading();
                if (listName) {
                    this.knowledgeBlock.knowledge.entities.push({
                        name: listName,
                        type: ["list"],
                    });
                }
                break;
            case "table":
                this.knowledgeBlock.tags.add("table");
                const tableName = this.getPrecedingHeading();
                if (tableName) {
                    this.knowledgeBlock.knowledge.entities.push({
                        name: tableName,
                        type: ["table"],
                    });
                }
                break;
            case "link":
                const link = token as md.Tokens.Link;
                this.onLink(link.text, link.href);
                break;
            case "strong":
            case "em":
                let text: string = token.text;
                if (!(text.startsWith("__") || text.startsWith("**"))) {
                    // Auto promote to topics
                    this.knowledgeBlock.knowledge.topics.push(text);
                    this.knowledgeBlock.knowledge.entities.push(
                        emphasisToEntity(text),
                    );
                }
                break;
        }
        this.lastToken = token;
    }

    onBlockStart(): void {
        //
        // Start next block
        // Note: do not clear headingsInScope as they stay active for the duration of the conversion pass
        // Links are only active for the current block
        //
        this.knowledgeBlock = createMarkdownKnowledgeBlock();
        this.linksInScope.clear();
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
    }

    onLink(text: string, url: string): void {
        this.linksInScope.set(text, url);
    }

    onBlockEnd(): void {
        //
        // Any headings and links we have collected or are in scope...
        // We will add those into the current knowledge block
        //
        this.addHeadingsToKnowledgeBlock();
        this.addLinksToKnowledgeBlock();
        this.knowledgeBlocks.push(this.knowledgeBlock);
    }

    private addHeadingsToKnowledgeBlock() {
        // Include top K headings in scope.. as topics and entities
        const topK = 2;
        let headingLevelsInScope = [...this.headingsInScope.keys()].sort(
            (x, y) => y - x, // Descending
        );

        headingLevelsInScope = headingLevelsInScope.slice(0, topK);
        for (const headerLevel of headingLevelsInScope) {
            const headerText = this.headingsInScope.get(headerLevel)!;
            this.knowledgeBlock.knowledge.topics.push(headerText);

            const headingEntity = headingToEntity(headerText, headerLevel);
            this.knowledgeBlock.knowledge.entities.push(headingEntity);
            // Also make header text a tag
            this.knowledgeBlock.tags.add("heading");
            this.knowledgeBlock.tags.add("section");
            this.knowledgeBlock.tags.add(headerText);

            this.knowledgeBlock.sTags.push(headingEntity);
        }
    }

    private addLinksToKnowledgeBlock() {
        //
        // Also include all links
        //
        for (const linkText of this.linksInScope.keys()) {
            this.knowledgeBlock.knowledge.entities.push(
                linkToEntity(linkText, this.linksInScope.get(linkText)!),
            );
        }
    }

    private getPrecedingHeading(): string | undefined {
        return this.lastToken !== undefined && this.lastToken.type === "heading"
            ? this.lastToken.text
            : undefined;
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

export function emphasisToEntity(text: string): kpLib.ConcreteEntity {
    return {
        name: text,
        type: ["emphasis"],
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
        tags: new Set<string>(),
        sTags: [],
        knowledge: createKnowledgeResponse(),
    };
}

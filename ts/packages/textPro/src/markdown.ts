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
        const trimmedBlock = curTextBlock.trim();
        if (trimmedBlock.length > 0) {
            // Use original block to retain original white space
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

export type KnowledgeMarkdownTypes =
    | "blockquote"
    | "code"
    | "codespan"
    | "em"
    | "heading"
    | "image"
    | "link"
    | "list"
    | "strong"
    | "table";

export type KnowledgeCollectionOptions = {
    tagTokens: Set<KnowledgeMarkdownTypes>; // Extract tags for these token types
};

export function createKnowledgeCollectionOptions(): KnowledgeCollectionOptions {
    return {
        tagTokens: new Set([
            "blockquote",
            "code",
            "codespan",
            "em",
            "heading",
            "image",
            "link",
            "list",
            "strong",
            "table",
        ]),
    };
}

/**
 * Parses the given markdown text and chunks it at logical boundaries.
 * @param markdown markdown string
 * @param maxChunkLength
 * @returns
 */
export function textAndKnowledgeBlocksFromMarkdown(
    markdown: string | md.TokensList,
    maxChunkLength?: number,
    knowledgeOptions?: KnowledgeCollectionOptions,
): [string[], MarkdownKnowledgeBlock[]] {
    const knowledgeCollector = new MarkdownKnowledgeCollector(
        knowledgeOptions ?? createKnowledgeCollectionOptions(),
    );
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

export class MarkdownKnowledgeCollector implements MarkdownBlockHandler {
    public knowledgeBlocks: MarkdownKnowledgeBlock[];

    private headingsInScope: Map<number, string>;
    private linksInScope: Map<string, string>;
    private knowledgeBlock: MarkdownKnowledgeBlock;

    private lastToken: md.Token | undefined;

    constructor(public options: KnowledgeCollectionOptions) {
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
            case "codespan":
                this.onCodeSpan(token as md.Tokens.Codespan);
                break;
            case "code":
                this.onCode(token as md.Tokens.Code);
                break;
            case "em":
                this.onEmphasis(token.text);
                break;
            case "image":
                this.onImage(token as md.Tokens.Image);
                break;
            case "heading":
                this.onHeading(token as md.Tokens.Heading);
                break;
            case "image":
                this.onImage(token as md.Tokens.Image);
                break;
            case "link":
                this.onLink(token as md.Tokens.Link);
                break;
            case "list":
                this.onList(token as md.Tokens.List);
                break;
            case "table":
                this.onTable(token as md.Tokens.Table);
                break;
            case "strong":
                this.onEmphasis(token.text);
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

    onHeading(heading: md.Tokens.Heading): void {
        const headingText = heading.text;
        const level = heading.depth;
        // Any heading level > level is no longer in scope
        const curLevels = [...this.headingsInScope.keys()];
        for (const hLevel of curLevels) {
            if (hLevel > level) {
                this.headingsInScope.delete(hLevel);
            }
        }
        this.headingsInScope.set(level, headingText);
    }

    onBlockQuote(block: md.Tokens.Blockquote): void {
        const blockName = this.getPrecedingHeading();
        if (blockName) {
            this.addEntityAndTag(blockQuoteToEntity(blockName), block.type);
        } else {
            this.addTag("block", block.type);
        }
    }

    onCode(code: md.Tokens.Code): void {
        const blockName = this.getPrecedingHeading();
        if (blockName) {
            this.addEntityAndTag(
                codeBlockToEntity(blockName, code.lang),
                code.type,
            );
        } else {
            this.addTag("code", code.type);
        }
    }

    onCodeSpan(code: md.Tokens.Codespan): void {
        const blockName = this.getPrecedingHeading();
        if (blockName) {
            this.addEntityAndTag(codeBlockToEntity(blockName), code.type);
        } else {
            this.addTag("code", code.type);
        }
    }

    onLink(link: md.Tokens.Link): void {
        this.linksInScope.set(link.text, link.href);
    }

    onImage(image: md.Tokens.Image): void {
        this.addEntityAndTag(
            imageToEntity(image.title, image.href),
            image.type,
        );
    }

    onList(list: md.Tokens.List): void {
        const listName = this.getPrecedingHeading();
        if (listName) {
            this.addEntityAndTag(listToEntity(listName), list.type);
        } else {
            this.addTag("list", list.type);
        }
    }

    onTable(table: md.Tokens.Table): void {
        const tableName = this.getPrecedingHeading();
        if (tableName) {
            this.addEntityAndTag(tableToEntity(tableName), table.type);
        } else {
            this.addTag("table", table.type);
        }
    }

    onEmphasis(text: string): void {
        if (!(text.startsWith("__") || text.startsWith("**"))) {
            // Automatically make any emphasized text into to topics
            this.knowledgeBlock.knowledge.topics.push(text);
            this.addEntity(emphasisToEntity(text));
        }
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

    protected addHeadingsToKnowledgeBlock() {
        // Include top K headings in scope.. as topics, entities
        const topK = 2;
        let headingLevelsInScope = [...this.headingsInScope.keys()].sort(
            (x, y) => y - x, // Descending
        );

        headingLevelsInScope = headingLevelsInScope.slice(0, topK);
        for (let i = 0; i < headingLevelsInScope.length; ++i) {
            const headerLevel = headingLevelsInScope[i];
            const headingText = this.headingsInScope.get(headerLevel)!;
            this.knowledgeBlock.knowledge.topics.push(headingText);
            this.addEntityAndTag(
                headingToEntity(headingText, headerLevel),
                "heading",
            );
        }
    }

    protected addLinksToKnowledgeBlock(): void {
        for (const linkText of this.linksInScope.keys()) {
            this.addEntityAndTag(
                linkToEntity(linkText, this.linksInScope.get(linkText)!),
                "link",
            );
        }
    }

    protected addEntityAndTag(
        entity: kpLib.ConcreteEntity,
        tokenType: string,
    ): void {
        this.addEntity(entity);
        if (this.options.tagTokens.has(tokenType as KnowledgeMarkdownTypes)) {
            this.addTag({ ...entity });
        }
    }

    protected addEntity(entity: kpLib.ConcreteEntity): void {
        this.knowledgeBlock.knowledge.entities.push(entity);
    }

    protected addTag(
        tag: kpLib.ConcreteEntity | string,
        tokenType?: KnowledgeMarkdownTypes,
    ): void {
        if (tokenType === undefined || this.options.tagTokens.has(tokenType)) {
            if (typeof tag === "string") {
                this.knowledgeBlock.tags.add(tag);
            } else {
                this.knowledgeBlock.sTags.push(tag);
            }
        }
    }

    private getPrecedingHeading(): string | undefined {
        return this.lastToken !== undefined && this.lastToken.type === "heading"
            ? this.lastToken.text
            : undefined;
    }
}

export function blockQuoteToEntity(name: string): kpLib.ConcreteEntity {
    return {
        name,
        type: ["block"],
    };
}

export function codeBlockToEntity(
    name: string,
    lang?: string,
): kpLib.ConcreteEntity {
    const entity: kpLib.ConcreteEntity = {
        name,
        type: ["code"],
    };
    if (lang) {
        entity.facets = [{ name: "lang", value: lang }];
    }
    return entity;
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

export function imageToEntity(
    name: string | undefined | null,
    url: string,
): kpLib.ConcreteEntity {
    name ??= url;
    return {
        name,
        type: ["image"],
        facets: [{ name: "url", value: url }],
    };
}

export function listToEntity(listName: string): kpLib.ConcreteEntity {
    return {
        name: listName,
        type: ["list"],
    };
}

export function tableToEntity(tableName: string): kpLib.ConcreteEntity {
    return {
        name: tableName,
        type: ["table"],
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

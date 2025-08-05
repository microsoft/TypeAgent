// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as md from "marked";
import {
    conversation as kpLib,
    splitIntoParagraphs,
} from "knowledge-processor";

/**
 * Parses markdown into a token DOM using the "marked" library
 * @param markdown
 * @returns
 */
export function markdownTokenize(markdown: string): md.TokensList {
    return md.lexer(markdown);
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
 * - Collects raw inner markup (text with formatting hits) from the first level of the markdown DOM
 * - For each block or text block, traverses child nodes to visit any embedded markdown (em, links etc) in the text and
 *   calls the handler. This markup then be used to associate knowledge like entities etc. with the text block.
 *   @see {markdownToTextAndKnowledgeBlocks}, @see {MarkdownKnowledgeCollector}
 * - To further split individual markdown blocks, you can either call this method OR splitter for paragraph, tables, lists
 * @param markdown
 * @param {MarkdownBlockHandler} handler
 * @param maxCharsPerChunk Approx max size of chunk. Uses as a best effort limit. Text blocks will be split only when it makes sense.
 * @returns
 */
export function markdownToTextBlocks(
    markdown: string | md.Token[],
    handler?: MarkdownBlockHandler,
    maxCharsPerChunk: number = Number.MAX_SAFE_INTEGER,
): string[] {
    const markdownTokens =
        typeof markdown === "string" ? markdownTokenize(markdown) : markdown;
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
                if (curTextBlock.length + token.raw.length > maxCharsPerChunk) {
                    const paraToken = textToParagraphs(token.raw);
                    traverseTokens(paraToken, token);
                } else {
                    curTextBlock += token.raw;
                }
                break;
            case "paragraph":
                beginBlock(
                    token,
                    prevBlockName === "paragraph" ||
                        prevBlockName === "heading" ||
                        prevTokenName === "space",
                    token.raw.length,
                    parentToken,
                );
                curTextBlock += token.raw;
                visitInnerNodes(token);
                break;
            case "list":
            case "table":
                // TODO: split very large lists and tables into smaller lists and tables with custom splitters
                beginBlock(
                    token,
                    prevBlockName === "heading" ||
                        prevBlockName === "paragraph",
                    token.raw.length,
                    parentToken,
                );
                curTextBlock += token.raw;
                visitInnerNodes(token);
                break;
            case "blockquote":
            case "codespan":
            case "heading":
                beginBlock(token, false, token.raw.length, parentToken);
                curTextBlock += token.raw;
                visitInnerNodes(token);
                break;
        }
    }

    function visitInnerNodes(parentToken: md.Token): void {
        const tokens = getChildTokens(parentToken);
        if (tokens !== undefined) {
            // Each markdown block node provides pertinent inner raw text + markup
            // nodes in the "raw" property. But it also adds the text elements as children
            // We only want to visit any nodes that contain useful markup information (like em, image, link etc)
            // but do not append to the block's text
            for (let i = 0; i < tokens.length; ++i) {
                const token = tokens[i];
                switch (token.type) {
                    default:
                        handler?.onToken(curTextBlock, token);
                        visitInnerNodes(token);
                        break;
                    case "space":
                    case "br":
                        break;
                    case "text":
                        break;
                    case "paragraph":
                        break;
                    case "list":
                    case "table":
                        break;
                    case "blockquote":
                    case "codespan":
                    case "heading":
                        break;
                }
            }
        }
    }

    function beginBlock(
        token: md.Token,
        shouldMerge: boolean,
        newTextLength: number,
        parentToken?: md.Token | undefined,
    ): void {
        // Keep adding to the current block unless asked. E.g. merge small paragraph unless
        // we hit some chunk size limits
        if (
            !prevBlockName ||
            !shouldMerge ||
            curTextBlock.length + newTextLength > maxCharsPerChunk
        ) {
            endBlock();
            curTextBlock = "";
            handler?.onBlockStart();
        }
        handler?.onToken(curTextBlock, token, parentToken);
        prevBlockName = token.type;
    }

    function endBlock(): void {
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
 * @param maxCharsPerChunk
 * @returns
 */
export function markdownToTextAndKnowledgeBlocks(
    markdown: string | md.TokensList,
    maxCharsPerChunk: number,
    knowledgeOptions?: KnowledgeCollectionOptions,
): [string[], MarkdownKnowledgeBlock[]] {
    const knowledgeCollector = new MarkdownKnowledgeCollector(
        knowledgeOptions ?? createKnowledgeCollectionOptions(),
    );
    const textBlocks = markdownToTextBlocks(
        markdown,
        knowledgeCollector,
        maxCharsPerChunk,
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

function textToParagraphs(text: string): md.Tokens.Paragraph[] {
    const paras = splitIntoParagraphs(text);
    return paras.map((p) => {
        return {
            type: "paragraph",
            raw: text,
            text,
            tokens: [],
        };
    });
}

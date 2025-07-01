// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    getFileName,
    HtmlToMdConvertor,
    HtmlToMdConvertorEvents,
    htmlToText,
    readAllText,
} from "typeagent";
import {
    DocMemory,
    DocMemorySettings,
    DocPart,
    DocPartMeta,
} from "./docMemory.js";
import {
    conversation as kpLib,
    splitLargeTextIntoChunks,
} from "knowledge-processor";
import * as kp from "knowpro";
import { parseVttTranscript } from "./transcript.js";
import { filePathToUrlString } from "memory-storage";
import path from "path";
import { getHtml } from "aiclient";
import { Result, success } from "typechat";

/**
 * Import a text document as DocMemory
 * You must call buildIndex before you can query the memory
 *
 * Uses file extensions to determine how to import.
 *  default: treat as text
 *  .html => parse html
 *  .vtt => parse vtt transcript
 * @param docFilePath
 * @param maxCharsPerChunk
 * @param docName
 * @param settings
 * @returns
 */
export async function importTextFile(
    docFilePath: string,
    maxCharsPerChunk: number,
    docName?: string,
    settings?: DocMemorySettings,
): Promise<DocMemory> {
    const docText = await readAllText(docFilePath);
    docName ??= getFileName(docFilePath);
    const ext = path.extname(docFilePath);

    const sourceUrl = filePathToUrlString(docFilePath);
    let parts: DocPart[];
    switch (ext) {
        default:
            parts = docPartsFromText(docText, maxCharsPerChunk, sourceUrl);
            break;
        case ".html":
        case ".htm":
            parts = docPartsFromHtml(docText, maxCharsPerChunk, sourceUrl);
            break;
        case ".vtt":
            parts = docPartsFromVtt(docText, sourceUrl);
            if (parts.length > 0) {
                parts = mergeDocParts(
                    parts,
                    parts[0].metadata,
                    maxCharsPerChunk,
                );
            }
            break;
    }
    return new DocMemory(docName, parts, settings);
}

/**
 * Import a web page as DocMemory
 * You must call buildIndex before you can query the memory
 * @param url
 * @param maxCharsPerChunk
 * @param settings
 * @returns
 */
export async function importWebPage(
    url: string,
    maxCharsPerChunk: number,
    settings?: DocMemorySettings,
): Promise<Result<DocMemory>> {
    const htmlResult = await getHtml(url);
    if (!htmlResult.success) {
        return htmlResult;
    }
    const parts = docPartsFromHtml(htmlResult.data, maxCharsPerChunk, url);
    const docMemory = new DocMemory(url, parts, settings);
    return success(docMemory);
}
/**
 * Import the given text as separate blocks
 * @param documentText
 * @param maxCharsPerChunk
 * @param sourceUrl
 * @returns
 */
export function docPartsFromText(
    documentText: string,
    maxCharsPerChunk: number,
    sourceUrl?: string,
): DocPart[] {
    const blocks: DocPart[] = [];
    for (const chunk of splitLargeTextIntoChunks(
        documentText,
        maxCharsPerChunk,
        false,
    )) {
        const block = new DocPart(chunk, new DocPartMeta(sourceUrl));
        blocks.push(block);
    }
    return blocks;
}

/**
 * Import the text as a single DocBlock with multiple chunks
 * @param documentText
 * @param maxCharsPerChunk
 * @param sourceUrl
 * @returns
 */
export function docPartFromText(
    documentText: string,
    maxCharsPerChunk: number,
    sourceUrl?: string,
): DocPart {
    const textChunks = [
        ...splitLargeTextIntoChunks(documentText, maxCharsPerChunk, false),
    ];
    return new DocPart(textChunks, new DocPartMeta(sourceUrl));
}

/**
 * Just grab text from the given html.
 * You can write a more complex parser that also annotates blocks as headings etc.
 * @param html
 * @param maxCharsPerChunk
 * @param sourceUrl
 * @returns
 */
export function docPartsFromHtml(
    html: string,
    maxCharsPerChunk: number,
    sourceUrl?: string,
): DocPart[] {
    const htmlText = htmlToText(html);
    return docPartsFromText(htmlText, maxCharsPerChunk, sourceUrl);
}

/**
 * Parse a VTT document as a set of document parts
 * @param transcriptText
 * @returns
 */
export function docPartsFromVtt(
    transcriptText: string,
    sourceUrl?: string,
): DocPart[] {
    const [parts, _] = parseVttTranscript<DocPart>(
        transcriptText,
        new Date(),
        (speaker: string) => new DocPart([], new DocPartMeta(sourceUrl)),
    );
    return parts;
}

/**
 * Combine small DocParts into larger ones
 * @param parts
 * @param metadata
 * @param maxCharsPerChunk
 * @returns
 */
export function mergeDocParts(
    parts: DocPart[],
    metadata: DocPartMeta,
    maxCharsPerChunk: number,
): DocPart[] {
    const allChunks = parts.flatMap((p) => p.textChunks);
    const mergedChunks: DocPart[] = [];
    // This will merge all small chunks into larger chunks as needed.. but not exceed
    // maxCharsPerChunk
    for (const chunk of splitLargeTextIntoChunks(
        allChunks,
        maxCharsPerChunk,
        true,
    )) {
        mergedChunks.push(new DocPart(chunk, metadata));
    }
    return mergedChunks;
}

/**
 * Experimental; work in progress, don't use yet
 */
export function docPartsFromHtmlEx(
    html: string,
    rootPath: string = "body",
    sourceUrl?: string,
) {
    const htmlImporter = new HtmlImporter(html, sourceUrl);
    return htmlImporter.getParts(rootPath);
}

class HtmlImporter implements HtmlToMdConvertorEvents {
    private htmlToMd: HtmlToMdConvertor;
    private knowledgeBlocks: kpLib.KnowledgeResponse[];
    private headingsInScope: Map<number, string>;
    private linksInScope: Map<string, string>;
    private curKnowledge: kpLib.KnowledgeResponse;

    constructor(
        html: string,
        private sourceUrl?: string,
    ) {
        this.htmlToMd = new HtmlToMdConvertor(html, this);
        this.knowledgeBlocks = [];
        this.curKnowledge = kp.createKnowledgeResponse();
        this.headingsInScope = new Map<number, string>();
        this.linksInScope = new Map<string, string>();
    }

    public getParts(rootPath: string = "body") {
        this.start();
        const textBlocks = this.htmlToMd.getMarkdownBlocks(rootPath);
        if (textBlocks.length !== this.knowledgeBlocks.length) {
            throw new Error(
                `textBlocks.length ${textBlocks.length} !== knowledgeBlocks.length ${this.knowledgeBlocks.length}`,
            );
        }
        const docParts: DocPart[] = [];
        for (let i = 0; i < textBlocks.length; ++i) {
            const meta = this.sourceUrl
                ? new DocPartMeta(this.sourceUrl)
                : undefined;
            const docPart = new DocPart(
                textBlocks[i].trim(),
                meta,
                undefined,
                undefined,
                this.knowledgeBlocks[i],
            );
            docParts.push(docPart);
        }
        return docParts;
    }

    private start(): void {
        this.knowledgeBlocks = [];
        this.headingsInScope.clear();
        this.linksInScope.clear();
        this.curKnowledge = kp.createKnowledgeResponse();
    }

    onBlockStart(convertor: HtmlToMdConvertor, tagName: string): void {}

    onHeading(
        convertor: HtmlToMdConvertor,
        headingText: string,
        level: number,
    ): void {
        // Any heading level > level is no longer in scope
        const curLevels = [...this.headingsInScope.keys()];
        for (const hLevel of curLevels) {
            if (hLevel > level) {
                this.headingsInScope.delete(hLevel);
            }
        }
        this.headingsInScope.set(level, headingText);
    }

    onLink(convertor: HtmlToMdConvertor, text: string, url: string): void {
        this.linksInScope.set(text, url);
    }

    onBlockEnd(convertor: HtmlToMdConvertor): void {
        // Include top K headings in scope.. as topics and entities
        const topK = 2;
        let headingLevelsInscope = [...this.headingsInScope.keys()].sort(
            (x, y) => y - x, // Descending
        );
        headingLevelsInscope = headingLevelsInscope.slice(0, topK);
        for (const hLevel of headingLevelsInscope) {
            const hText = this.headingsInScope.get(hLevel)!;
            this.curKnowledge.topics.push(hText);
            this.curKnowledge.entities.push(headingToEntity(hText, hLevel));
        }
        //
        // Also include all links
        //
        for (const linkText of this.linksInScope.keys()) {
            this.curKnowledge.entities.push(
                linkToEntity(linkText, this.linksInScope.get(linkText)!),
            );
        }
        this.knowledgeBlocks.push(this.curKnowledge);
        //
        // Start next block
        // Note: do not clear headingsInScope as they stay active for the duration of the conversion pass
        // Links are only active for the current block
        //
        this.curKnowledge = kp.createKnowledgeResponse();
        this.linksInScope.clear();
    }
}

function headingToEntity(text: string, level: number): kpLib.ConcreteEntity {
    return {
        name: text,
        type: ["heading"],
        facets: [{ name: "level", value: level }],
    };
}

function linkToEntity(text: string, url: string): kpLib.ConcreteEntity {
    return {
        name: text,
        type: ["link", "url"],
        facets: [{ name: "url", value: url }],
    };
}

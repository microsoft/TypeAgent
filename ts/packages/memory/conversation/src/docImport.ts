// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getFileName, readAllText } from "typeagent";
import {
    DocMemory,
    DocMemorySettings,
    DocPart,
    DocPartMeta,
} from "./docMemory.js";
import { splitLargeTextIntoChunks } from "knowledge-processor";
import * as tp from "textpro";
import { parseVttTranscript } from "./transcript.js";
import { filePathToUrlString } from "memory-storage";
import path from "path";
import { getHtml } from "aiclient";
import { Result, success } from "typechat";
import * as kp from "knowpro";

/**
 * Import a text document as DocMemory
 * Uses file extensions to determine how to import the text files.
 *  default: treat as text
 *  .html, .htm => parse html
 *  .vtt => parse vtt transcript
 *
 * You must call {@link DocMemory.buildIndex} before you can search or get answers from the memory
 
 * @param docFilePath file path to file to import
 * @param maxCharsPerChunk Chunks document into DocParts
 * @param docName (Optional) Document name
 * @param {DocMemorySettings} settings (Optional) memory settings
 * @returns {DocMemory} new document memory
 */
export async function importDocMemoryFromTextFile(
    docFilePath: string,
    maxCharsPerChunk: number,
    docName?: string,
    settings?: DocMemorySettings,
): Promise<DocMemory> {
    const docText = await readAllText(docFilePath);
    docName ??= getFileName(docFilePath);
    const ext = path.extname(docFilePath);

    const sourceUrl = filePathToUrlString(docFilePath);
    let type: DocType;
    switch (ext) {
        default:
            type = "txt";
            break;
        case ".html":
        case ".htm":
            type = "html";
            break;
        case ".vtt":
            type = "vtt";
            break;
        case ".md":
            type = "md";
            break;
    }
    let memory = await importDocMemoryFromText(
        docText,
        type,
        maxCharsPerChunk,
        sourceUrl,
    );
    return memory;
}

export type DocType = "vtt" | "md" | "html" | "txt";

/**
 * Import a text as DocMemory
 * You must call buildIndex before you can query the memory
 *
 * @param docFilePath file path to file to import
 * @param type Type of text content
 * @param maxCharsPerChunk Chunks document into DocParts
 * @param docName (Optional) Document name
 * @param {DocMemorySettings} settings (Optional) memory settings
 * @returns {DocMemory} new document memory
 */
export async function importDocMemoryFromText(
    docText: string,
    type: DocType,
    maxCharsPerChunk: number,
    sourceUrl?: string,
    docName?: string,
    settings?: DocMemorySettings,
): Promise<DocMemory> {
    let parts: DocPart[];
    switch (type) {
        default:
            parts = docPartsFromText(docText, maxCharsPerChunk, sourceUrl);
            break;
        case "html":
            parts = docPartsFromHtml(
                docText,
                false,
                maxCharsPerChunk,
                sourceUrl,
            );
            break;
        case "vtt":
            parts = docPartsFromVtt(docText, sourceUrl);
            if (parts.length > 0) {
                parts = mergeDocParts(
                    parts,
                    parts[0].metadata,
                    maxCharsPerChunk,
                );
            }
            break;
        case "md":
            parts = docPartsFromMarkdown(docText, maxCharsPerChunk, sourceUrl);
            break;
    }
    return new DocMemory(docName, parts, settings);
}

/**
 * Import a web page as a {@link DocMemory}
 * @param url Url for web page to download
 * @param maxCharsPerChunk Best effort chunk size
 * @param {DocMemorySettings} settings (Optional) memory settings
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
    const parts = docPartsFromHtml(
        htmlResult.data,
        false,
        maxCharsPerChunk,
        url,
    );
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
 * Chunk the given html into an array of {@link DocPart | DocParts}.
 * DocParts will contain:
 *  - Text chunks.
 *  - textOnly true: simplifies html to raw text before chunking.
 *  - textOnly false: Converts html to compact markdown and then creates DocParts using {@link docPartsFromMarkdown}. The resulting DocParts retain
 *  structural and other knowledge implied by markup.
 *
 * @param html html text
 * @param textOnly if true, use only text, ignoring all formatting etc. Else analyzes structure and formatting
 * @param maxCharsPerChunk Best effort maximum size of each chunk.
 * @param sourceUrl
 * @param rootTag Root html tag to start extracted doc parts from. Default is "body"
 * @returns
 */
export function docPartsFromHtml(
    html: string,
    textOnly: boolean,
    maxCharsPerChunk: number,
    sourceUrl?: string,
    rootTag?: string,
): DocPart[] {
    if (textOnly) {
        const htmlText = tp.htmlToText(html);
        return docPartsFromText(htmlText, maxCharsPerChunk, sourceUrl);
    } else {
        const markdown = tp.htmlToMarkdown(html, rootTag);
        return docPartsFromMarkdown(markdown, maxCharsPerChunk, sourceUrl);
    }
}

/**
 * Chunk the given markdown text into {@link DocPart | DocParts}.
 * DocParts will contain:
 *  - Text chunks. Chunking will obey logical "blocks" such as tables, lists, paragraphs. Large blocks are split appropriately.
 *  - Chunking respects "blocks" such as tables, lists, paragraphs etc, splitting them appropriately.
 *  - Structured information inside a chunk (headings, lists, images, links etc), are captured as entities, structured tags and topics.
 *    These are indexed when the DocPart is added to DocMemory
 *
 *  When a DocPart is added to a DocMemory and the {@link DocMemory} is indexed, detailed contextual knowledge is automatically extracted using an LLM.
 *  You can also extract knowledge using other means, or using knowpro APIs.
 * @param markdown markdown text
 * @param maxCharsPerChunk Best effort maximum size of a chunk
 * @param sourceUrl sourceUrl for this markdown
 * @returns Array of {@link DocPart}
 */
export function docPartsFromMarkdown(
    markdown: string,
    maxCharsPerChunk: number,
    sourceUrl?: string,
): DocPart[] {
    const [textBlocks, knowledgeBlocks] = tp.markdownToTextAndKnowledgeBlocks(
        markdown,
        maxCharsPerChunk,
    );
    if (textBlocks.length !== knowledgeBlocks.length) {
        throw new Error(
            `textBlocks.length ${textBlocks.length} !== knowledgeBlocks.length ${knowledgeBlocks.length}`,
        );
    }
    const parts: DocPart[] = [];
    for (let i = 0; i < textBlocks.length; ++i) {
        const kBlock = knowledgeBlocks[i];
        let textBlock = textBlocks[i];
        if (textBlock.length === 0) {
            // Empty text block
            continue;
        }
        const tags: kp.MessageTag[] = [];
        if (kBlock.tags.size > 0) {
            tags.push(...kBlock.tags.values());
        }
        if (kBlock.sTags && kBlock.sTags.length > 0) {
            tags.push(...kBlock.sTags);
        }
        const part = new DocPart(
            textBlock,
            new DocPartMeta(sourceUrl),
            tags.length > 0 ? tags : undefined,
            undefined,
            kBlock.knowledge,
        );
        parts.push(part);
    }
    return parts;
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

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getFileName, readAllText } from "@typeagent/agent-runtime";
import {
    DocMemory,
    DocMemorySettings,
    DocPart,
    DocPartMeta,
} from "./docMemory.js";
import * as tp from "@typeagent/textpro";
import { parseVttTranscript } from "./transcript.js";
import { filePathToUrlString } from "@typeagent/memory-storage";
import path from "path";
import {
    countEmbeddingTokens,
    getHtml,
    maxEmbeddingInputTokens,
} from "@typeagent/aiclient";
import { Result, success } from "typechat";
import * as kp from "@typeagent/knowpro";
import { encode } from "gpt-tokenizer/encoding/o200k_base";

export const defaultDocPartTokenLimit = 7_500;

export interface DocPartOptions {
    collectLinkKnowledge?: boolean;
    collectStructuralKnowledge?: boolean;
    maxTokensPerPart?: number;
}

export function countDocTokens(text: string): number {
    return encode(text, {
        allowedSpecial: new Set(),
        disallowedSpecial: new Set(),
    }).length;
}

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
    const memory = await importDocMemoryFromText(
        docText,
        type,
        maxCharsPerChunk,
        sourceUrl,
        docName,
        settings,
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
    options?: DocPartOptions,
): DocPart[] {
    return chunkDocParts(
        documentText.length === 0
            ? []
            : [new DocPart(documentText, new DocPartMeta(sourceUrl))],
        options,
        maxCharsPerChunk,
    );
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
    options?: DocPartOptions,
): DocPart[] {
    if (textOnly) {
        const htmlText = tp.htmlToText(html);
        return docPartsFromText(htmlText, maxCharsPerChunk, sourceUrl, options);
    } else {
        const markdown = tp.htmlToMarkdown(html, rootTag);
        return docPartsFromMarkdown(
            markdown,
            maxCharsPerChunk,
            sourceUrl,
            options,
        );
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
    options?: DocPartOptions,
): DocPart[] {
    const knowledgeOptions = tp.createKnowledgeCollectionOptions();
    knowledgeOptions.collectLinks = options?.collectLinkKnowledge ?? true;
    knowledgeOptions.collectStructuralKnowledge =
        options?.collectStructuralKnowledge ?? true;
    const [textBlocks, knowledgeBlocks] = tp.markdownToTextAndKnowledgeBlocks(
        markdown,
        maxCharsPerChunk,
        knowledgeOptions,
    );
    if (textBlocks.length !== knowledgeBlocks.length) {
        throw new Error(
            `textBlocks.length ${textBlocks.length} !== knowledgeBlocks.length ${knowledgeBlocks.length}`,
        );
    }
    const parts: DocPart[] = [];
    for (let i = 0; i < textBlocks.length; ++i) {
        const kBlock = knowledgeBlocks[i];
        const textBlock = textBlocks[i];
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
    return chunkDocParts(parts, options);
}

export function aggregateDocParts(
    parts: DocPart[],
    maxTokensPerPart: number,
): DocPart[] {
    return chunkDocParts(parts, { maxTokensPerPart });
}

/**
 * Apply both extraction and embedding budgets after format parsing.
 * An explicit extraction budget also packs adjacent, compatible source parts.
 */
export function chunkDocParts(
    parts: DocPart[],
    options?: DocPartOptions,
    maxCharacters = Number.MAX_SAFE_INTEGER,
): DocPart[] {
    const maxTokens = options?.maxTokensPerPart ?? defaultDocPartTokenLimit;
    if (!Number.isSafeInteger(maxTokens) || maxTokens < 1) {
        throw new Error("maxTokensPerPart must be a positive safe integer");
    }
    if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1) {
        throw new Error("maxCharacters must be a positive safe integer");
    }
    const bounded = parts.flatMap((part) =>
        splitDocText(
            part.textChunks.join("\n\n"),
            maxTokens,
            maxCharacters,
        ).map((text, index) => ({
            part: copyDocPart(part, text, index === 0),
            separator: index === 0 ? "\n\n" : "",
        })),
    );
    if (options?.maxTokensPerPart === undefined) {
        return bounded.map(({ part }) => part);
    }
    const aggregated: DocPart[] = [];
    let current: DocPart | undefined;
    for (const { part, separator } of bounded) {
        const text = part.textChunks[0];
        const combinedText =
            current === undefined
                ? text
                : current.textChunks[0] + separator + text;
        if (
            current !== undefined &&
            (!canMergeDocParts(current, part) ||
                !fitsDocTokenBudget(combinedText, maxTokens))
        ) {
            aggregated.push(current);
            current = undefined;
        }
        if (current === undefined) {
            current = part;
        } else {
            current.textChunks[0] = combinedText;
            current.tags.push(...part.tags);
            if (part.knowledge !== undefined) {
                current.addKnowledge(part.knowledge);
            }
        }
    }
    if (current !== undefined) {
        aggregated.push(current);
    }
    return aggregated;
}

function fitsDocTokenBudget(text: string, maxTokens: number): boolean {
    return (
        countDocTokens(text) <= maxTokens &&
        countEmbeddingTokens(text) <= maxEmbeddingInputTokens
    );
}

function splitDocText(
    text: string,
    maxTokens: number,
    maxCharacters: number,
): string[] {
    if (text.length <= maxCharacters && fitsDocTokenBudget(text, maxTokens)) {
        return [text];
    }
    // Slice original Unicode code points, not decoded token bytes or UTF-16 halves.
    const characters = Array.from(text);
    const chunks: string[] = [];
    for (let start = 0; start < characters.length; ) {
        let low = 0;
        let high = Math.min(characters.length - start, maxCharacters);
        while (low < high) {
            const middle = Math.ceil((low + high) / 2);
            if (
                fitsDocTokenBudget(
                    characters.slice(start, start + middle).join(""),
                    maxTokens,
                )
            ) {
                low = middle;
            } else {
                high = middle - 1;
            }
        }
        let chunk = characters.slice(start, start + low).join("");
        if (low === 0 || !fitsDocTokenBudget(chunk, maxTokens)) {
            throw new Error(
                "Cannot fit a Unicode code point within the document token budget",
            );
        }
        for (let boundary = low - 1; boundary > low * 0.75; boundary--) {
            if (/\s/u.test(characters[start + boundary])) {
                const prefix = characters
                    .slice(start, start + boundary + 1)
                    .join("");
                if (fitsDocTokenBudget(prefix, maxTokens)) {
                    chunk = prefix;
                    low = boundary + 1;
                    break;
                }
            }
        }
        chunks.push(chunk);
        start += low;
    }
    return chunks;
}

function copyDocPart(
    part: DocPart,
    text: string,
    includeKnowledge: boolean,
): DocPart {
    return new DocPart(
        text,
        part.metadata,
        [...part.tags],
        part.timestamp,
        includeKnowledge && part.knowledge !== undefined
            ? structuredClone(part.knowledge)
            : undefined,
        part.deletionInfo === undefined
            ? undefined
            : structuredClone(part.deletionInfo),
    );
}

function canMergeDocParts(left: DocPart, right: DocPart): boolean {
    return (
        left.timestamp === undefined &&
        right.timestamp === undefined &&
        left.deletionInfo === undefined &&
        right.deletionInfo === undefined &&
        (left.metadata === right.metadata ||
            (left.metadata.constructor === DocPartMeta &&
                right.metadata.constructor === DocPartMeta &&
                left.metadata.sourceUrl === right.metadata.sourceUrl))
    );
}

/**
 * Parse a VTT document as a set of document parts
 * @param transcriptText
 * @returns
 */
export function docPartsFromVtt(
    transcriptText: string,
    sourceUrl?: string,
    options?: DocPartOptions,
): DocPart[] {
    const [parts, _] = parseVttTranscript<DocPart>(
        transcriptText,
        new Date(),
        (speaker: string) => new DocPart([], new DocPartMeta(sourceUrl)),
    );
    return chunkDocParts(parts, options);
}

/**
 * Combine small DocParts into larger ones
 * @param parts
 * @param metadata
 * @param maxCharsPerChunk
 * @returns
 * @deprecated Use aggregateDocParts. Per-part metadata is retained instead of replaced.
 */
export function mergeDocParts(
    parts: DocPart[],
    _metadata: DocPartMeta,
    maxCharsPerChunk: number,
): DocPart[] {
    return chunkDocParts(
        aggregateDocParts(parts, defaultDocPartTokenLimit),
        undefined,
        maxCharsPerChunk,
    );
}

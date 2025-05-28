// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { htmlToText } from "typeagent";
import { DocPart, DocPartMeta } from "./docMemory.js";
import * as kpLib from "knowledge-processor";
import { parseVttTranscript } from "./transcript.js";

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
    for (const chunk of kpLib.splitLargeTextIntoChunks(
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
        ...kpLib.splitLargeTextIntoChunks(
            documentText,
            maxCharsPerChunk,
            false,
        ),
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
    sourceUrl: string,
): DocPart[] {
    const htmlText = htmlToText(html);
    return docPartsFromText(htmlText, maxCharsPerChunk, sourceUrl);
}

/**
 * Parse a VTT document as a set of document parts
 * @param transcriptText
 * @returns
 */
export function docPartsFromVtt(transcriptText: string): DocPart[] {
    const [parts, _] = parseVttTranscript<DocPart>(
        transcriptText,
        new Date(),
        (speaker: string) => new DocPart([]),
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
    for (const chunk of kpLib.splitLargeTextIntoChunks(
        allChunks,
        maxCharsPerChunk,
        true,
    )) {
        mergedChunks.push(new DocPart(chunk, metadata));
    }
    return mergedChunks;
}

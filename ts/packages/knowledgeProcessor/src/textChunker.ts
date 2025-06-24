// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextBlock, TextBlockType, appendTextBlock } from "./text.js";

export type SplitOptions = {
    removeEmpty: boolean;
    trim: boolean;
};

/**
 * Split text and then perform additional tidying up
 * @param text
 * @param pattern
 * @param options
 * @returns
 */
export function split(
    text: string,
    pattern: string | RegExp,
    options?: SplitOptions,
): string[] {
    let parts = text.split(pattern);
    parts = parts.filter((p) => p !== undefined);
    if (parts.length > 0 && options) {
        if (options.trim) {
            for (let i = 0; i < parts.length; ++i) {
                parts[i] = parts[i].trim();
            }
        }
        if (options.removeEmpty) {
            parts = parts.filter((v) => v.length > 0);
        }
    }
    return parts;
}

export function splitIntoLines(text: string, options?: SplitOptions): string[] {
    return split(text, /\r?\n/, options);
}

export function splitIntoWords(text: string, options?: SplitOptions): string[] {
    return split(text, /(\b\S+\b)/, options);
}

export function splitIntoSentences(
    text: string,
    options?: SplitOptions,
): string[] {
    return split(text, /(?<=[.!?;\r\n])\s+/, options);
}

/**
 * Assumes that paragraphs end with 2+ LF or 2+ CRLF
 * @param text
 * @returns paragraphs
 */
export function splitIntoParagraphs(
    text: string,
    options?: SplitOptions,
): string[] {
    return split(text, /\r?\n\r?\n+/, options);
}

export function splitSentenceIntoPhrases(
    text: string,
    options?: SplitOptions,
): string[] {
    return split(text, /(?<=[,:\-])\s+/, options);
}

/**
 * Split the given text into blocks.
 * Block types include paragraph, sentences, words..
 * @param text
 * @param blockType The type of blocks to produce
 * @param options
 * @returns
 */
export function splitIntoBlocks(
    text: string,
    blockType: TextBlockType,
    options?: SplitOptions | undefined,
): TextBlock[] {
    let values: string[];
    switch (blockType) {
        default:
            return [
                {
                    type: blockType,
                    value: text,
                },
            ];
        case TextBlockType.Paragraph:
            values = splitIntoParagraphs(text, options);
            break;
        case TextBlockType.Sentence:
            values = splitIntoSentences(text, options);
            break;
        case TextBlockType.Word:
            values = splitIntoWords(text, options);
            break;
    }
    return values.map((value) => {
        return {
            type: blockType,
            value,
        };
    });
}

export function* joinIntoChunks(
    strings: Iterable<string>,
    maxCharsPerChunk: number,
    separator?: string,
    autoTruncate: boolean = true,
): IterableIterator<string> {
    separator ??= " ";
    let chunk = "";
    for (let str of strings) {
        if (chunk.length + (str.length + separator.length) > maxCharsPerChunk) {
            yield chunk;
            chunk = "";
        }
        if (str.length > maxCharsPerChunk && autoTruncate) {
            str = str.slice(0, maxCharsPerChunk);
        }
        if (chunk) {
            chunk += separator;
            chunk += str;
        } else {
            chunk = str;
        }
    }
    if (chunk) {
        yield chunk;
    }
}

export function splitLargeTextIntoChunks(
    text: string | string[],
    maxCharsPerChunk: number,
    autoTruncate: boolean = true,
): IterableIterator<string> {
    let textBlocks: TextBlock[];
    if (typeof text === "string") {
        textBlocks = [];
        textBlocks.push({ type: TextBlockType.Raw, value: text });
    } else {
        textBlocks = text.map((value) => {
            return {
                type: TextBlockType.Raw,
                value,
            };
        });
    }
    return blocksToChunks(textBlocks, maxCharsPerChunk, autoTruncate);
}

/**
 * Will join text across text blocks, splitting blocks as needed to include as much
 * as possible into a chunk
 * @param text
 * @param maxCharsPerChunk
 * @param autoTruncate
 */
function* blocksToChunks(
    text: TextBlock[],
    maxCharsPerChunk: number,
    autoTruncate: boolean = true,
): IterableIterator<string> {
    const separator = " ";
    let blockQueue: TextBlock[] = [];
    blockQueue.push(...text);

    let i = 0;
    let chunk = "";
    while (i < blockQueue.length) {
        const block = blockQueue[i];
        if (chunk.length + block.value.length > maxCharsPerChunk) {
            if (block.type !== TextBlockType.Word) {
                const splitBlocks = splitTextBlock(block);
                if (splitBlocks) {
                    blockQueue.splice(i, 1, ...splitBlocks);
                    continue;
                }
            }
            yield chunk;
            chunk = "";
        }
        if (block.value.length > maxCharsPerChunk && autoTruncate) {
            block.value = block.value.slice(0, maxCharsPerChunk);
        }
        if (chunk) {
            chunk += separator;
            chunk += block.value;
        } else {
            chunk = block.value;
        }
        ++i;
    }
    if (chunk) {
        yield chunk;
    }
}

function emptyTextChunk(): TextBlock {
    return { type: TextBlockType.Raw, value: "", sourceIds: [] };
}

export function* joinTextBlocks(
    chunks: Iterable<TextBlock>,
    maxCharsPerChunk: number,
    separator?: string,
    autoTruncate: boolean = true,
): IterableIterator<TextBlock> {
    separator ??= " ";
    let chunk = emptyTextChunk();
    for (let chunkPart of chunks) {
        if (
            chunk.value.length + (chunkPart.value.length + separator.length) >
            maxCharsPerChunk
        ) {
            yield chunk;
            chunk = emptyTextChunk();
        }
        if (chunkPart.value.length > maxCharsPerChunk && autoTruncate) {
            chunkPart.value = chunkPart.value.slice(0, maxCharsPerChunk);
        }
        if (chunk) {
            chunk.value += separator;
            appendTextBlock(chunk, chunkPart);
        } else {
            chunk = chunkPart;
        }
    }
    if (chunk) {
        yield chunk;
    }
}

const defaultSplitOptions: SplitOptions = {
    removeEmpty: true,
    trim: true,
};
/**
 * Progressively splits text blocks to maximize the odds that a chunk contains coherent text
 * Raw --> Paragraphs
 * Paragraph --> Sentence
 * Sentence --> Words
 * @param block
 * @returns
 */
export function splitTextBlock(
    block: TextBlock,
    blockId?: any,
    options?: SplitOptions,
): TextBlock[] {
    options ??= defaultSplitOptions;
    let newBlockType: TextBlockType;
    let values: string[];
    switch (block.type) {
        default:
            return [block];
        case TextBlockType.Raw:
            newBlockType = TextBlockType.Paragraph;
            values = splitIntoParagraphs(block.value, options);
            break;
        case TextBlockType.Paragraph:
            newBlockType = TextBlockType.Sentence;
            values = splitIntoSentences(block.value, options);
            break;
        case TextBlockType.Sentence:
            newBlockType = TextBlockType.Word;
            values = splitIntoWords(block.value, options);
            break;
    }

    const sourceIds = blockId ? [blockId] : undefined;
    return values.map((value) => {
        return {
            type: newBlockType,
            value,
            sourceIds,
        };
    });
}

export function isValidChunkSize(maxCharsPerChunk: number | undefined) {
    return (
        maxCharsPerChunk &&
        maxCharsPerChunk > 0 &&
        maxCharsPerChunk < Number.MAX_SAFE_INTEGER
    );
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { dateTime } from "typeagent";
import { unionArrays, uniqueFrom } from "./setOperations.js";
import { TextStore } from "./textStore.js";

export function valueToString(
    value: any,
    stringify?: (value: any) => string,
): string {
    if (stringify) {
        return stringify(value);
    }
    if (typeof value === "string") {
        return value;
    }
    return JSON.stringify(value);
}

export enum TextBlockType {
    Raw,
    Paragraph,
    Sentence,
    Word,
}

/**
 * A block of text
 * TextBlock includes an optional set of sourceIds: Ids for the artifact(doc, message, web page)
 * from where this text block was taken
 */
export interface TextBlock<TId = any> {
    type: TextBlockType;
    /**
     * The text for this text block
     */
    value: string;
    sourceIds?: TId[] | undefined;
}

export interface SourceTextBlock<TId = any, TBlockId = any>
    extends TextBlock<TId> {
    blockId: TBlockId;
    timestamp?: Date;
}

export type TimestampedTextBlock<TSourceId> = dateTime.Timestamped<
    TextBlock<TSourceId>
>;

export function collectBlockIds(
    blocks: Iterable<SourceTextBlock>,
): any[] | undefined {
    return uniqueFrom(blocks, (b) => b.blockId);
}

export function collectSourceIds(
    blocks?: Iterable<TextBlock>,
): any[] | undefined {
    return blocks ? uniqueFrom(blocks, (b) => b.sourceIds) : undefined;
}

export function collectBlockText(
    blocks: Iterable<TextBlock>,
    sep: string,
): string {
    let allText = "";
    for (const block of blocks) {
        if (allText.length > 0) {
            allText += sep;
        }
        allText += block.value;
    }
    return allText;
}

export function appendTextBlock(dest: TextBlock, newBlock: TextBlock): void {
    dest.value += newBlock.value;
    dest.sourceIds = unionArrays(dest.sourceIds, newBlock.sourceIds);
}

export async function getTextBlockSources(
    store: TextStore,
    blocks: TextBlock[],
): Promise<TextBlock[] | undefined> {
    const ids = collectSourceIds(blocks);
    if (ids && ids.length > 0) {
        return await store.getMultipleText(ids);
    }
    return undefined;
}

export function* flattenTimestampedBlocks<TSourceId>(
    entries: Iterable<dateTime.Timestamped<TextBlock<TSourceId>[]> | undefined>,
): IterableIterator<TimestampedTextBlock<TSourceId>> {
    for (const entry of entries) {
        if (entry) {
            for (const topic of entry.value) {
                yield {
                    timestamp: entry.timestamp,
                    value: topic,
                };
            }
        }
    }
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { TextEmbeddingIndexSettings } from "./fuzzyIndex.js";
import {
    IMessage,
    MessageIndex,
    IndexingEventHandlers,
    TextLocation,
    ListIndexingResult,
} from "./interfaces.js";
import { TextToTextLocationIndexFuzzy } from "./textLocationIndex.js";

export interface MessageTextIndexFuzzy {
    addMessages(
        messages: IMessage[],
        baseMessageIndex: MessageIndex,
        eventHandler?: IndexingEventHandlers,
    ): Promise<ListIndexingResult>;
}

export class MessageTextIndexFuzzy implements MessageTextIndexFuzzy {
    private textLocationIndex: TextToTextLocationIndexFuzzy;

    constructor(settings: TextEmbeddingIndexSettings) {
        this.textLocationIndex = new TextToTextLocationIndexFuzzy(settings);
    }

    public addMessages(
        messages: IMessage[],
        baseMessageIndex: MessageIndex,
        eventHandler?: IndexingEventHandlers,
    ): Promise<ListIndexingResult> {
        const allChunks: [string, TextLocation][] = [];
        // Collect everything so we can batch efficiently
        for (let i = 0; i < messages.length; ++i) {
            const message = messages[i];
            let messageIndex = baseMessageIndex + i;
            for (
                let chunkIndex = 0;
                chunkIndex < message.textChunks.length;
                ++chunkIndex
            ) {
                allChunks.push([
                    message.textChunks[chunkIndex],
                    { messageIndex, chunkIndex },
                ]);
            }
        }
        return this.textLocationIndex.addTextLocations(allChunks, eventHandler);
    }
}

export async function addMessagesToIndex(
    textLocationIndex: TextToTextLocationIndexFuzzy,
    messages: IMessage[],
    baseMessageIndex: MessageIndex,
    eventHandler?: IndexingEventHandlers,
    batchSize?: number,
): Promise<void> {
    const allChunks: [string, TextLocation][] = [];
    // Collect everything so we can batch efficiently
    for (let i = 0; i < messages.length; ++i) {
        const message = messages[i];
        let messageIndex = baseMessageIndex + i;
        for (
            let chunkIndex = 0;
            chunkIndex < message.textChunks.length;
            ++chunkIndex
        ) {
            allChunks.push([
                message.textChunks[chunkIndex],
                { messageIndex, chunkIndex },
            ]);
        }
    }
    // Todo: return an IndexingResult
    await textLocationIndex.addTextLocations(
        allChunks,
        eventHandler,
        batchSize,
    );
}

export async function buildMessageIndex(
    messages: IMessage[],
    settings: TextEmbeddingIndexSettings,
    eventHandler?: IndexingEventHandlers,
    batchSize?: number,
) {
    const textLocationIndex = new TextToTextLocationIndexFuzzy(settings);
    await addMessagesToIndex(
        textLocationIndex,
        messages,
        0,
        eventHandler,
        batchSize,
    );
    return textLocationIndex;
}

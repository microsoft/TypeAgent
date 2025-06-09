// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kpLib from "knowledge-processor";
import {
    AnswerContext,
    RelevantKnowledge,
    RelevantMessage,
} from "./answerContextSchema.js";
import { jsonStringifyForPrompt } from "./common.js";

export function answerContextToString(
    context: AnswerContext,
    spaces?: number,
): string {
    let json = "{\n";
    let propertyCount = 0;
    if (context.entities && context.entities.length > 0) {
        json += add("entities", context.entities);
    }
    if (context.topics && context.topics.length > 0) {
        json += add("topics", context.topics);
    }
    if (context.messages && context.messages.length > 0) {
        json += add("messages", context.messages);
    }
    json += "\n}";
    return json;

    function add(name: string, value: any): string {
        let text = "";
        if (propertyCount > 0) {
            text += ",\n";
        }
        const json = jsonStringifyForPrompt(value, spaces);
        text += `"${name}": ${json}`;
        propertyCount++;
        return text;
    }
}

export class AnswerContextChunkBuilder {
    public currentChunk: AnswerContext = {};
    public currentChunkCharCount = 0;

    constructor(
        public context: AnswerContext,
        public maxCharsPerChunk: number,
    ) {}

    public *getChunks(
        includeKnowledge: boolean = true,
        includeMessages: boolean = true,
    ): IterableIterator<AnswerContext> {
        this.newChunk();
        if (includeKnowledge) {
            // Note: Chunks can *span* entities, topics, messages... simultaneously
            // Each child loop will build up the current chunk... but if the current chunk still has capacity, will
            // continue building it in the subsequent loop
            for (const chunk of this.chunkKnowledge(
                this.context.entities,
                "entities",
            )) {
                yield chunk;
            }
            for (const chunk of this.chunkKnowledge(
                this.context.topics,
                "topics",
            )) {
                yield chunk;
            }
            // Any pending chunks?
            if (this.currentChunkCharCount > 0) {
                yield this.currentChunk;
                this.newChunk();
            }
        }
        if (includeMessages) {
            for (const chunk of this.chunkMessages()) {
                yield chunk;
            }
        }
        // Any pending chunks?
        if (this.currentChunkCharCount > 0) {
            yield this.currentChunk;
        }
    }

    private *chunkKnowledge(
        knowledge: RelevantKnowledge[] | undefined,
        type: keyof AnswerContext,
    ): IterableIterator<AnswerContext> {
        if (knowledge && knowledge.length > 0) {
            for (const item of knowledge) {
                const completedChunk = this.addToCurrentChunk(item, type);
                if (completedChunk) {
                    yield completedChunk;
                }
            }
        }
    }

    private *chunkMessages() {
        if (this.context.messages && this.context.messages.length > 0) {
            for (const message of this.context.messages) {
                if (!message.messageText) {
                    continue;
                }
                const messageChunks = kpLib.splitLargeTextIntoChunks(
                    message.messageText,
                    this.maxCharsPerChunk,
                );
                for (const msgChunk of messageChunks) {
                    const chunkMessage: RelevantMessage = {
                        ...message,
                        messageText: msgChunk,
                    };
                    const completedChunk = this.addToCurrentChunk(
                        chunkMessage,
                        "messages",
                    );
                    if (completedChunk) {
                        yield completedChunk;
                    }
                }
            }
        }
    }

    private addToCurrentChunk(
        item: any,
        type: keyof AnswerContext,
    ): AnswerContext | undefined {
        const itemString = jsonStringifyForPrompt(item);
        const itemSize = itemString.length;
        if (this.currentChunkCharCount + itemSize > this.maxCharsPerChunk) {
            const completedChunk = this.currentChunk;
            this.newChunk();
            return completedChunk;
        }
        if (this.currentChunk[type] === undefined) {
            this.currentChunk[type] = [];
        }
        this.currentChunk[type]!.push(item);
        this.currentChunkCharCount += itemSize;
        return undefined;
    }

    private newChunk() {
        this.currentChunk = {};
        this.currentChunkCharCount = 0;
    }
}

export type AnswerContextOptions = {
    entitiesTopK?: number | undefined;
    topicsTopK?: number | undefined;
    messagesTopK?: number | undefined;
    chunking?: boolean | undefined;
};

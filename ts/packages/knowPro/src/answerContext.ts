// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

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
    ) {
        if (!Number.isSafeInteger(maxCharsPerChunk) || maxCharsPerChunk < 4) {
            throw new RangeError(
                "Answer context budget must be an integer of at least four characters",
            );
        }
    }

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
                const texts =
                    typeof message.messageText === "string"
                        ? [message.messageText]
                        : message.messageText;
                for (const text of texts) {
                    for (const chunkMessage of this.splitMessage(
                        message,
                        text,
                    )) {
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
    }

    private addToCurrentChunk(
        item: RelevantKnowledge | RelevantMessage,
        type: keyof AnswerContext,
    ): AnswerContext | undefined {
        const singleton = { [type]: [item] };
        if (answerContextToString(singleton).length > this.maxCharsPerChunk) {
            throw new RangeError(
                `Answer context ${type} item exceeds the serialized character budget`,
            );
        }
        const candidate = {
            ...this.currentChunk,
            [type]: [...(this.currentChunk[type] ?? []), item],
        };
        let completedChunk: AnswerContext | undefined;
        if (answerContextToString(candidate).length > this.maxCharsPerChunk) {
            completedChunk = this.currentChunk;
            this.currentChunk = singleton;
        } else {
            this.currentChunk = candidate;
        }
        this.currentChunkCharCount = answerContextToString(
            this.currentChunk,
        ).length;
        return completedChunk;
    }

    private *splitMessage(
        message: RelevantMessage,
        text: string,
    ): IterableIterator<RelevantMessage> {
        let offset = 0;
        while (offset < text.length) {
            let low = 0;
            let high = text.length - offset;
            while (low < high) {
                const length = Math.ceil((low + high) / 2);
                const part = {
                    ...message,
                    messageText: text.slice(offset, offset + length),
                };
                if (
                    answerContextToString({ messages: [part] }).length <=
                    this.maxCharsPerChunk
                ) {
                    low = length;
                } else {
                    high = length - 1;
                }
            }
            const last = text.charCodeAt(offset + low - 1);
            if (
                offset + low < text.length &&
                last >= 0xd800 &&
                last <= 0xdbff
            ) {
                low--;
            }
            if (low === 0) {
                throw new RangeError(
                    "Answer context message metadata or text cannot fit the serialized character budget",
                );
            }
            yield { ...message, messageText: text.slice(offset, offset + low) };
            offset += low;
        }
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

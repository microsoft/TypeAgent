// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kpLib from "knowledge-processor";
import {
    AnswerContext,
    RelevantKnowledge,
    RelevantMessage,
} from "./answerContextSchema.js";
import { jsonStringifyForPrompt } from "./common.js";

export class AnswerContextChunkBuilder {
    public currentChunk: AnswerContext = {};
    public currentChunkCharCount = 0;

    constructor(
        public context: AnswerContext,
        public maxCharsPerChunk: number,
    ) {}

    public *getChunks(): IterableIterator<AnswerContext> {
        this.newChunk();
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
            this.context.entities,
            "topics",
        )) {
            yield chunk;
        }
        for (const chunk of this.chunkMessages()) {
            yield chunk;
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
                if (message.message.length === 0) {
                    continue;
                }

                const messageChunks = kpLib.splitLargeTextIntoChunks(
                    message.message,
                    this.maxCharsPerChunk,
                );
                for (const msgChunk of messageChunks) {
                    const chunkMessage: RelevantMessage = {
                        ...message,
                        message: msgChunk,
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

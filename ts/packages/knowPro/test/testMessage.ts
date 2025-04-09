// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readTestJsonFile } from "test-lib";
import { IMessage, DeletionInfo } from "../src/interfaces.js";
import { createTimestamp } from "./testCommon.js";

export class TestMessage implements IMessage {
    public textChunks: string[];
    public tags: string[] = [];
    public timestamp?: string;
    public deletionInfo?: DeletionInfo;
    public ordinal?: number | undefined;

    constructor(message?: string | string[] | undefined, ordinal?: number) {
        if (message !== undefined) {
            if (Array.isArray(message)) {
                this.textChunks = message;
            } else {
                this.textChunks = [message];
            }
        } else {
            this.textChunks = [];
        }
        this.ordinal = ordinal;
        this.timestamp = createTimestamp();
    }

    public getKnowledge() {
        return undefined;
    }
}

export function createTestMessages(
    messageCount: number,
    chunkCount: number = 1,
): TestMessage[] {
    const messages: TestMessage[] = [];
    if (chunkCount > 1) {
        for (
            let messageOrdinal = 0;
            messageOrdinal < messageCount;
            ++messageOrdinal
        ) {
            const chunks: string[] = [];
            for (
                let chunkOrdinal = 0;
                chunkOrdinal < chunkCount;
                ++chunkOrdinal
            ) {
                chunks.push(`Message_${messageOrdinal}_Chunk_${chunkOrdinal}`);
            }
            messages.push(new TestMessage(chunks, messageOrdinal));
        }
    } else {
        for (let i = 0; i < messageCount; ++i) {
            messages.push(new TestMessage(`Message_${i + 1}`, i));
        }
    }
    return messages;
}

export type TestTurn = {
    source: string;
    text: string;
};

export function loadTunsFromFile(filePath: string): TestTurn[] {
    return readTestJsonFile(filePath);
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextEmbeddingModel } from "@typeagent/aiclient";
import { success } from "typechat";
import { createTextEmbeddingIndexSettings } from "../src/fuzzyIndex.js";
import { MessageOrdinal } from "../src/interfaces.js";
import {
    getCharCountOfMessages,
    getCountOfMessagesInCharBudget,
    getMessageChunkBatch,
} from "../src/message.js";
import { MessageTextIndex } from "../src/messageIndex.js";
import { createTestMessages, TestMessage } from "./testMessage.js";

describe("message", () => {
    test("messageBatch.singleChunk", () => {
        const messageCount = 14;
        const batchSize = 3;
        const numFullBatches = Math.floor(messageCount / batchSize);
        const numBatches = numFullBatches + 1;

        const messages = createTestMessages(messageCount);
        let startAt = 0;
        const batches = [...getMessageChunkBatch(messages, startAt, batchSize)];
        expect(batches).toHaveLength(numBatches);
        let batchOrdinal = 0;
        for (; batchOrdinal < numFullBatches; ++batchOrdinal) {
            expect(batches[batchOrdinal]).toHaveLength(batchSize);
        }
        expect(batches[batchOrdinal]).toHaveLength(messageCount % batchSize);

        const flatBatch = batches.flat();
        expect(flatBatch).toHaveLength(messages.length);
        for (let i = 0; i < flatBatch.length; ++i) {
            expect(flatBatch[i].messageOrdinal === messages.get(i).ordinal);
        }
    });
    test("messageBatch", () => {
        const messageCount = 4;
        const chunkCountPerMessage = 4;
        const totalChunkCount = messageCount * chunkCountPerMessage;
        // Use a batch size that will cause chunks from a single message to span 2 batches
        const batchSize = 3;
        const numFullBatches = Math.floor(totalChunkCount / batchSize);
        const numBatches = numFullBatches + 1;

        const messages = createTestMessages(messageCount, chunkCountPerMessage);
        let startAt = 0;
        const batches = [...getMessageChunkBatch(messages, startAt, batchSize)];
        expect(batches).toHaveLength(numBatches);
        let batchOrdinal = 0;
        for (; batchOrdinal < numFullBatches; ++batchOrdinal) {
            expect(batches[batchOrdinal]).toHaveLength(batchSize);
        }
        expect(batches[batchOrdinal]).toHaveLength(totalChunkCount % batchSize);
    });
    test("messageBatch.count", () => {
        const messageCount = 5;
        const chunkCountPerMessage = 4;
        // Use a batch size that will cause chunks from a single message to span 2 batches
        const batchSize = 3;

        const messages = createTestMessages(messageCount, chunkCountPerMessage);
        let messageOrdinalStartAt = 1;
        let messageCountToIndex = 3;
        let expectedBatchCount = Math.ceil(
            (messageCountToIndex * chunkCountPerMessage) / batchSize,
        );
        let batches = [
            ...getMessageChunkBatch(
                messages,
                messageOrdinalStartAt,
                batchSize,
                messageCountToIndex,
            ),
        ];
        expect(batches).toHaveLength(expectedBatchCount);
        let batchOrdinal = 0;
        for (; batchOrdinal < messageCountToIndex; ++batchOrdinal) {
            expect(batches[batchOrdinal]).toHaveLength(batchSize);
        }

        // Now send in a count that exceeds max ordinal...
        expectedBatchCount = Math.ceil(
            ((messageCount - messageOrdinalStartAt) * chunkCountPerMessage) /
                batchSize,
        );
        for (let i = 0; i < 3; ++i) {
            messageCountToIndex = messageCount + i;
            let batches = [
                ...getMessageChunkBatch(
                    messages,
                    messageOrdinalStartAt,
                    batchSize,
                    messageCountToIndex,
                ),
            ];
            expect(batches).toHaveLength(expectedBatchCount);
        }
    });
    test("message.budget", () => {
        const messages = createTestMessages(16);
        let ordinals: MessageOrdinal[] = [];
        for (let i = 0; i < messages.length; ++i) {
            ordinals.push(i);
        }
        const expectedCount = 8;
        const partialMessages = messages.getSlice(0, expectedCount);
        let charBudget = getCharCountOfMessages(partialMessages);
        let messageCount = getCountOfMessagesInCharBudget(
            messages,
            ordinals,
            charBudget,
        );
        expect(messageCount).toEqual(expectedCount);
    });
    test("messageIndex.ordinals", async () => {
        const embeddingModel = {
            maxBatchSize: 8,
            generateEmbedding: async () => success([1, 0]),
            generateEmbeddingBatch: async (inputs: string[]) =>
                success(inputs.map(() => [1, 0])),
        } satisfies TextEmbeddingModel;
        const createIndex = () =>
            new MessageTextIndex({
                embeddingIndexSettings: createTextEmbeddingIndexSettings(
                    embeddingModel,
                    2,
                    0,
                ),
            });
        const index = createIndex();

        const cancelled = await index.addMessages([new TestMessage("retry")], {
            onEmbeddingsCreated: () => false,
        });
        expect(cancelled.numberCompleted).toEqual(0);
        expect(index.size).toEqual(0);

        const added = await index.addMessages([
            new TestMessage(["m0-c0", "m0-c1", "m0-c2"]),
            new TestMessage("m1"),
            new TestMessage("m2"),
        ]);
        expect(added.numberCompleted).toEqual(5);
        expect(index.size).toEqual(3);
        expect(
            index
                .serialize()
                .indexData?.textLocations.map((loc) => loc.messageOrdinal),
        ).toEqual([0, 0, 0, 1, 2]);

        const legacyIndex = createIndex();
        legacyIndex.deserialize({
            indexData: {
                textLocations: [{ messageOrdinal: 1, chunkOrdinal: 0 }],
                embeddings: [new Float32Array([1, 0])],
            },
        });
        expect(legacyIndex.size).toEqual(2);
        expect(
            legacyIndex.serialize().indexData?.textLocations[0].messageOrdinal,
        ).toEqual(1);
        expect(legacyIndex.lookupByEmbedding(new Float32Array([1, 0]))).toEqual(
            [{ messageOrdinal: 1, score: 1 }],
        );
    });
});

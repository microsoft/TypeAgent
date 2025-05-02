// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getMessageChunkBatch } from "../src/message.js";
import { createTestMessages } from "./testMessage.js";

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
});

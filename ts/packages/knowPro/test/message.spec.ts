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
        const chunkCount = 4;
        const messageCount = 4;
        const totalChunkCount = messageCount * chunkCount;
        const batchSize = 3;
        const numFullBatches = Math.floor(totalChunkCount / batchSize);
        const numBatches = numFullBatches + 1;

        const messages = createTestMessages(messageCount, chunkCount);
        let startAt = 0;
        const batches = [...getMessageChunkBatch(messages, startAt, batchSize)];
        expect(batches).toHaveLength(numBatches);
        let batchOrdinal = 0;
        for (; batchOrdinal < numFullBatches; ++batchOrdinal) {
            expect(batches[batchOrdinal]).toHaveLength(batchSize);
        }
        expect(batches[batchOrdinal]).toHaveLength(totalChunkCount % batchSize);
    });
});

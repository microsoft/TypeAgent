// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getBatchesFromCollection, MessageCollection } from "../src/storage.js";
import {
    createTestMessages,
    createTestMessagesArray,
    TestMessage,
} from "./testMessage.js";

describe("messageCollection", () => {
    test("addMessage", () => {
        const messageCollection = new MessageCollection();
        messageCollection.append(new TestMessage("One"));
        expect(messageCollection).toHaveLength(1);
        const m = messageCollection.get(0);
        expect(m).toBeDefined();
    });
    test("addMessages", () => {
        const messageCollection = new MessageCollection();
        messageCollection.append(
            new TestMessage("One"),
            new TestMessage("Two"),
        );
        expect(messageCollection).toHaveLength(2);

        let ordinals = [0, 1];
        let messages = messageCollection.getMultiple(ordinals);
        expect(messages).toHaveLength(ordinals.length);
        messages.forEach((m) => expect(m).toBeDefined());

        ordinals = [1, 2];
        messages = messageCollection.getMultiple(ordinals);
        expect(messages).toHaveLength(ordinals.length);
        expect(messages[0]).toBeDefined();
        expect(messages[1]).toBeUndefined();
    });
    test("constructor", () => {
        const messageCount = 10;
        const testMessages = createTestMessagesArray(messageCount);
        const messageCollection = new MessageCollection(testMessages);
        expect(messageCollection.length).toEqual(messageCount);
    });
    test("enumeration", () => {
        const messageCount = 10;
        const messageCollection = createTestMessages(messageCount);
        expect(messageCollection.length).toEqual(messageCount);
        // Enumeration
        let messagesCopy = [...messageCollection];
        expect(messagesCopy).toHaveLength(messageCollection.length);
    });
    test("batching", () => {
        const messageCount = 10;
        const messageCollection = createTestMessages(messageCount);
        expect(messageCollection.length).toEqual(messageCount);

        const messagesCopy = messageCollection.getAll();
        expect(messagesCopy).toHaveLength(messageCount);
        let completed = 0;
        let batchSize = 4;
        for (const batch of getBatchesFromCollection(
            messageCollection,
            0,
            batchSize,
        )) {
            expect(batch.startAt).toEqual(completed);
            const slice = messagesCopy.slice(
                batch.startAt,
                batch.startAt + batchSize,
            );
            expect(batch.value).toHaveLength(slice.length);
            completed += batch.value.length;
        }
    });
});

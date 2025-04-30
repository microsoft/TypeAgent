// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sqlite from "better-sqlite3";
import { createDatabase } from "../src/sqlite/sqliteCommon.js";
import {
    createMessages,
    ensureTestDir,
    messageText,
    testFilePath,
} from "./testCommon.js";
import { SqlMessageCollection } from "../src/sqlite/sqliteProvider.js";
import { IMessage } from "knowpro";

describe("memory.sqlite.messageCollection", () => {
    const testTimeout = 1000 * 60 * 5;
    let db: sqlite.Database | undefined;

    beforeAll(async () => {
        await ensureTestDir();
        db = createDatabase(testFilePath("collections.db"), true);
    });
    afterAll(() => {
        if (db) {
            db.close();
        }
    });
    test(
        "addMessage",
        () => {
            const messageCollection = new SqlMessageCollection(
                db!,
                undefined,
                "messages_single",
            );
            const messages = createMessages(4);
            messages.forEach((m) => testPush(messageCollection, m));
        },
        testTimeout,
    );
    test("addMessages", () => {
        const collectionName = "messages_multi";
        const messageCollection = new SqlMessageCollection(
            db!,
            undefined,
            collectionName,
        );
        const messages = createMessages(4);

        let prevLength = messageCollection.length;
        messageCollection.append(...messages);
        let newLength = messageCollection.length;
        expect(newLength).toEqual(prevLength + messages.length);

        let ordinals = [0, 1, 2]; // Deliberately out of order
        let gotMessages = messageCollection.getMultiple(ordinals);
        verifyMessages(messages, gotMessages, 0, ordinals.length);

        let collection2 = new SqlMessageCollection(
            db!,
            undefined,
            collectionName,
            false,
        );
        expect(collection2).toHaveLength(messageCollection.length);
        let gotMessage = collection2.get(2);
        expect(messageText(gotMessage)).toEqual(messageText(messages[2]));
    });
    test("sliceMessages", () => {
        const collectionName = "messages_slice";
        const messageCollection = new SqlMessageCollection(
            db!,
            undefined,
            collectionName,
        );
        const messages = createMessages(10);
        messageCollection.append(...messages);

        let sliceLength = 5;
        let startAt = 0;
        let gotMessages = messageCollection.getSlice(
            startAt,
            startAt + sliceLength,
        );
        verifyMessages(messages, gotMessages, startAt, sliceLength);
        startAt = 4;
        gotMessages = messageCollection.getSlice(
            startAt,
            startAt + sliceLength,
        );
        verifyMessages(messages, gotMessages, startAt, sliceLength);
        startAt = 5;
        gotMessages = messageCollection.getSlice(
            startAt,
            startAt + sliceLength,
        );
        verifyMessages(messages, gotMessages, startAt, sliceLength);
        startAt = 6;
        gotMessages = messageCollection.getSlice(
            startAt,
            startAt + sliceLength,
        );
        verifyMessages(messages, gotMessages, startAt, sliceLength - 1);
    });

    function testPush(collection: SqlMessageCollection, message: IMessage) {
        const prevLength = collection.length;
        collection.append(message);
        const newLength = collection.length;
        expect(newLength).toEqual(prevLength + 1);
        const messageAdded = collection.get(newLength - 1);
        expect(messageText(messageAdded)).toBe(messageText(message));
    }

    function verifyMessages(
        messages: IMessage[],
        gotMessages: IMessage[],
        startAt: number,
        expectedLength: number,
    ) {
        expect(gotMessages).toHaveLength(expectedLength);
        for (let i = 0; i < expectedLength; ++i) {
            expect(messageText(gotMessages[i])).toEqual(
                messageText(messages[i + startAt]),
            );
        }
    }
});

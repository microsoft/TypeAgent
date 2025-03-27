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
import { SqlMessageCollection } from "../src/sqlite/sqliteCollection.js";
import { IMessage } from "knowpro";

describe("memory.sqlite.messageCollection", () => {
    const testTimeout = 1000 * 60 * 5;
    let db: sqlite.Database | undefined;

    beforeAll(async () => {
        await ensureTestDir();
        db = await createDatabase(testFilePath("collections.db"), true);
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
                "messages_single",
            );
            const messages = createMessages(4);
            messages.forEach((m) => testPush(messageCollection, m));
        },
        testTimeout,
    );
    test("addMessages", () => {
        const collectionName = "messages_multi";
        const messageCollection = new SqlMessageCollection(db!, collectionName);
        const messages = createMessages(4);

        let prevLength = messageCollection.length;
        messageCollection.push(...messages);
        let newLength = messageCollection.length;
        expect(newLength).toEqual(prevLength + messages.length);

        let ordinals = [0, 2, 1]; // Deliberately out of order
        let gotMessages = messageCollection.getMultiple(ordinals);
        expect(gotMessages).toHaveLength(ordinals.length);
        for (let i = 0; i < ordinals.length; ++i) {
            expect(messageText(gotMessages[i])).toEqual(messages[ordinals[i]]);
        }

        let collection2 = new SqlMessageCollection(db!, collectionName, false);
        expect(collection2).toHaveLength(messageCollection.length);
        let gotMessage = collection2.get(2);
        expect(messageText(gotMessage)).toEqual(messageText(messages[2]));
    });

    function testPush(collection: SqlMessageCollection, message: IMessage) {
        const prevLength = collection.length;
        collection.push(message);
        const newLength = collection.length;
        expect(newLength).toEqual(prevLength + 1);
        const messageAdded = collection.get(newLength - 1);
        expect(messageText(messageAdded)).toBe(messageText(message));
    }
});

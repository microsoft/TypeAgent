// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sqlite from "better-sqlite3";
import { createDatabase } from "../src/sqlite/sqliteCommon.js";
import { createMessage, ensureTestDir, testFilePath } from "./testCommon.js";
import { SqlMessageCollection } from "../src/sqlite/sqliteCollection.js";

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
            messageCollection.push(createMessage("One"));
            expect(messageCollection).toHaveLength(1);
            const m = messageCollection.get(0);
            expect(m).toBeDefined();
        },
        testTimeout,
    );
    test("addMessages", () => {
        const collectionName = "messages_multi";
        const messageCollection = new SqlMessageCollection(db!, collectionName);
        const messages = [
            createMessage("One"),
            createMessage("Two"),
            createMessage("Three"),
        ];
        messageCollection.push(...messages);
        expect(messageCollection).toHaveLength(messages.length);

        let ordinals = [0, 1];
        let gotMessages = messageCollection.getMultiple(ordinals);
        expect(gotMessages).toHaveLength(ordinals.length);
        messages.forEach((m) => expect(m).toBeDefined());

        let collection2 = new SqlMessageCollection(db!, collectionName, false);
        expect(collection2).toHaveLength(messageCollection.length);
        let message = collection2.get(2);
        expect(message).toBeDefined();
        expect(message?.textChunks[0]).toEqual("Three");
    });
});

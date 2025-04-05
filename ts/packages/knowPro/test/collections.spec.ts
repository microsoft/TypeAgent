// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { MessageCollection } from "../src/storage.js";
import { TestMessage } from "./testMessage.js";

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
});

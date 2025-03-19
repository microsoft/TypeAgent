// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { MessageCollection } from "../src/collections.js";
import { createMessage } from "./common.js";

describe("MessageCollection", () => {
    test("addMessage", () => {
        const messageCollection = new MessageCollection();
        messageCollection.push(createMessage("One"));
        expect(messageCollection).toHaveLength(1);
        const m = messageCollection.get(0);
        expect(m).toBeDefined();
    });
    test("addMessages", () => {
        const messageCollection = new MessageCollection();
        messageCollection.push(createMessage("One"), createMessage("Two"));
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

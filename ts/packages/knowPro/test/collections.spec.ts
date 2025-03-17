// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { MessageCollection } from "../src/collections.js";
import { createMessage } from "./common.js";

describe("MessageCollection", () => {
    test("addMessage", () => {
        const messageCollection = new MessageCollection();
        const ordinal = messageCollection.addMessage(createMessage("One"));
        expect(messageCollection).toHaveLength(1);
        expect(ordinal).toEqual(0);

        const m = messageCollection.getMessage(0);
        expect(m).toBeDefined();
    });
    test("addMessages", () => {
        const messageCollection = new MessageCollection();
        const ordinals = messageCollection.addMessages([
            createMessage("One"),
            createMessage("Two"),
        ]);
        expect(messageCollection).toHaveLength(2);
        expect(ordinals).toHaveLength(2);

        const messages = messageCollection.getMessages(ordinals);
        expect(messages).toHaveLength(ordinals.length);
        messages.forEach((m) => expect(m).toBeDefined());
    });
});

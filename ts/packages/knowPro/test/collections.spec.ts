// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { MessageCollection } from "../src/message.js";
import { createMessage } from "./common.js";

describe("MessageCollection", () => {
    test("endToEnd", () => {
        const messages = new MessageCollection();
        const message1 = createMessage("One");
        messages.addMessage(message1);
        expect(messages).toHaveLength(1);

        const m = messages.getMessage(0);
        expect(m).toBeDefined();
    });
});

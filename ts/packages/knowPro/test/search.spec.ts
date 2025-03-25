// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createConversationSettings } from "../src/conversation.js";
import { IConversation } from "../src/interfaces.js";
import { createConversationFromFile, getRelativePath } from "./common.js";

describe("Search Tests", () => {
    let conversation: IConversation;
    beforeAll(async () => {
        let settings = createConversationSettings();
        conversation = await createConversationFromFile(
            getRelativePath("./test/data"),
            "Episode_53_AdrianTchaikovsky_index",
            settings,
        );
    });
    test("lookup", () => {
        const books = conversation.semanticRefIndex?.lookupTerm("book");
        expect(books).toBeDefined();
        expect(books!.length).toBeGreaterThan(0);
    });
});

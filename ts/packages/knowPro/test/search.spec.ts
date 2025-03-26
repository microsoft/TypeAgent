// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createConversationSettings } from "../src/conversation.js";
import { IConversation } from "../src/interfaces.js";
import {
    createConversationFromFile,
    getRelativePath,
    hasTestKeys,
    testIf,
} from "./testCommon.js";

describe("search", () => {
    let conversation: IConversation | undefined;
    beforeAll(async () => {
        if (hasTestKeys()) {
            let settings = createConversationSettings();
            conversation = await createConversationFromFile(
                getRelativePath("./test/data"),
                "Episode_53_AdrianTchaikovsky_index",
                settings,
            );
        }
    });
    testIf(
        "lookup",
        () => hasTestKeys(),
        () => {
            const books = conversation!.semanticRefIndex?.lookupTerm("book");
            expect(books).toBeDefined();
            expect(books!.length).toBeGreaterThan(0);
        },
    );
});

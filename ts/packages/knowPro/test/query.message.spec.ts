// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IConversation } from "../src/interfaces.js";
import { ConversationSecondaryIndexes } from "../src/secondaryIndexes.js";
import {
    createOfflineConversationSettings,
    createQueryContext,
    emptyConversation,
    loadTestConversation,
} from "./testCommon.js";
import * as q from "../src/query.js";
import { verifyTextRanges } from "./verify.js";
import {
    compileMatchObjectOrEntity,
    compileMatchSubjectAndVerb,
} from "../src/compileLib.js";

/**
 * Designed to run offline
 */
describe("query.message.offline", () => {
    const testTimeout = 1000 * 60 * 5;
    let conversation: IConversation = emptyConversation();
    let secondaryIndex: ConversationSecondaryIndexes | undefined;
    beforeAll(async () => {
        let settings = createOfflineConversationSettings(() => {
            return secondaryIndex?.termToRelatedTermsIndex.fuzzyIndex;
        });
        conversation = await loadTestConversation(settings);
        secondaryIndex =
            conversation.secondaryIndexes as ConversationSecondaryIndexes;
    });
    test(
        "messages.terms.or",
        () => {
            const targetEntityName = "Children of Memory";
            const query = compileMatchObjectOrEntity(targetEntityName);
            const messageOrdinals = query.eval(createContext());
            expect(messageOrdinals.size).toBeGreaterThan(0);
        },
        testTimeout,
    );
    test(
        "messages.terms.and",
        () => {
            let query = compileMatchSubjectAndVerb("Adrian", "say");
            let messageOrdinals = query.eval(createContext());
            expect(messageOrdinals.size).toBeGreaterThan(0);

            query = compileMatchSubjectAndVerb("Jane", "say");
            messageOrdinals = query.eval(createContext());
            expect(messageOrdinals.size).toEqual(0);
        },
        testTimeout,
    );
    test("messages.terms.ranges", () => {
        const targetEntityName = "Children of Time";
        const query = compileMatchObjectOrEntity(targetEntityName);
        const scopeExpr = new q.TextRangesFromMessagesSelector(query);
        const ranges = scopeExpr.eval(createContext());
        expect(ranges).toBeDefined();
        if (ranges) {
            verifyTextRanges(ranges);
        }
    });

    function createContext() {
        return createQueryContext(conversation);
    }
});

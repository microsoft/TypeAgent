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
import { createPropertySearchTerm } from "../src/searchCommon.js";
import { PropertyNames } from "../src/propertyIndex.js";
import { verifyTextRanges } from "./verify.js";

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
            const query = createMatchObjectOrEntity(targetEntityName);
            const messageOrdinals = query.eval(createContext());
            expect(messageOrdinals.size).toBeGreaterThan(0);
        },
        testTimeout,
    );
    test(
        "messages.terms.and",
        () => {
            let query = createMatchSubjectAndVerb("Adrian", "say");
            let messageOrdinals = query.eval(createContext());
            expect(messageOrdinals.size).toBeGreaterThan(0);

            query = createMatchSubjectAndVerb("Jane", "say");
            messageOrdinals = query.eval(createContext());
            expect(messageOrdinals.size).toEqual(0);
        },
        testTimeout,
    );
    test("messages.terms.ranges", () => {
        const targetEntityName = "Children of Time";
        const query = createMatchObjectOrEntity(targetEntityName);
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

    function createMatchObjectOrEntity(targetEntityName: string) {
        const expr = new q.MatchMessagesOrExpr([
            new q.MatchPropertySearchTermExpr(
                createPropertySearchTerm(
                    PropertyNames.Object,
                    targetEntityName,
                ),
            ),
            new q.MatchPropertySearchTermExpr(
                createPropertySearchTerm(
                    PropertyNames.EntityName,
                    targetEntityName,
                ),
            ),
        ]);
        return expr;
    }

    function createMatchSubjectAndVerb(subject: string, verb: string) {
        let expr = new q.MatchMessagesAndExpr([
            new q.MatchPropertySearchTermExpr(
                createPropertySearchTerm(PropertyNames.Subject, subject),
            ),
            new q.MatchPropertySearchTermExpr(
                createPropertySearchTerm(PropertyNames.Verb, verb),
            ),
        ]);
        return expr;
    }
});

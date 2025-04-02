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
import { PropertyNames } from "../src/propertyIndex.js";
import { createPropertySearchTerm } from "../src/searchLib.js";
import { SemanticRefAccumulator } from "../src/collections.js";

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
            const query = compileActionTarget(targetEntityName);
            const messageOrdinals = query.eval(createContext());
            expect(messageOrdinals.size).toBeGreaterThan(0);
        },
        testTimeout,
    );
    test(
        "messages.terms.and",
        () => {
            let query = compileActionQuery("Adrian", "say");
            let messageOrdinals = query.eval(createContext());
            expect(messageOrdinals.size).toBeGreaterThan(0);

            query = compileActionQuery("Jane", "say");
            messageOrdinals = query.eval(createContext());
            expect(messageOrdinals.size).toEqual(0);
        },
        testTimeout,
    );
    test("messages.terms.ranges", () => {
        const targetEntityName = "Children of Time";
        const query = compileActionTarget(targetEntityName);
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

function compileActionQuery(
    actorEntityName: string,
    verbs: string | string[],
    targetEntityName?: string,
) {
    let expr = new q.MatchMessagesAndExpr([
        new q.MatchPropertySearchTermExpr(
            createPropertySearchTerm(PropertyNames.Subject, actorEntityName),
        ),
        compileActionVerbs(verbs),
    ]);
    if (targetEntityName) {
        expr.termExpressions.push(compileActionTarget(targetEntityName));
    }
    return expr;
}

function compileActionVerbs(
    verbs: string | string[],
): q.IQueryOpExpr<SemanticRefAccumulator | undefined> {
    if (Array.isArray(verbs)) {
        const verbTerms = verbs.map(
            (v) =>
                new q.MatchPropertySearchTermExpr(
                    createPropertySearchTerm(PropertyNames.Verb, v),
                ),
        );
        return new q.MatchTermsAndExpr(verbTerms);
    } else {
        return new q.MatchPropertySearchTermExpr(
            createPropertySearchTerm(PropertyNames.Verb, verbs),
        );
    }
}

function compileActionTarget(targetEntityName: string) {
    const expr = new q.MatchMessagesOrExpr([
        new q.MatchPropertySearchTermExpr(
            createPropertySearchTerm(PropertyNames.Object, targetEntityName),
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

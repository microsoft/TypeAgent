// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IConversation } from "../src/interfaces.js";
import { ConversationSecondaryIndexes } from "../src/secondaryIndexes.js";
import {
    createOfflineConversationSettings,
    emptyConversation,
    loadTestConversation,
} from "./testCommon.js";
import * as q from "../src/query.js";
import { createPropertySearchTerm } from "../src/search.js";
import { PropertyNames } from "../src/propertyIndex.js";

describe("query", () => {
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
            const objectMatches = new q.MatchTermsToMessagesBooleanExpr(
                [
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
                ],
                "or",
            );
            const messageOrdinals = objectMatches.eval(createContext());
            expect(messageOrdinals.size).toBeGreaterThan(0);
        },
        testTimeout,
    );

    function createContext() {
        const secondaryIndexes = conversation.secondaryIndexes!;
        return new q.QueryEvalContext(
            conversation,
            secondaryIndexes.propertyToSemanticRefIndex,
            secondaryIndexes.timestampIndex,
        );
    }
});

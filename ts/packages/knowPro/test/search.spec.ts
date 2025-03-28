// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createAndTermGroup, createOrTermGroup } from "../src/common.js";
import { createConversationSettings } from "../src/conversation.js";
import {
    IConversation,
    KnowledgeType,
    ScoredMessageOrdinal,
} from "../src/interfaces.js";
import {
    createSearchTerm,
    searchConversation,
    searchConversationKnowledge,
    SearchTermGroup,
} from "../src/search.js";
import {
    createConversationFromFile,
    getRelativePath,
    hasTestKeys,
    testIf,
} from "./testCommon.js";

describe("knowpro.search", () => {
    const testTimeout = 1000 * 60 * 5;
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
    testIf(
        "searchKnowledge",
        () => hasTestKeys(),
        async () => {
            const termGroup = createOrTermGroup();
            termGroup.terms.push(createSearchTerm("book"));
            termGroup.terms.push(createSearchTerm("movie"));
            await testSearchKnowledge(termGroup, "entity");
        },
        testTimeout,
    );
    testIf(
        "searchMessages",
        () => hasTestKeys(),
        async () => {
            const termGroup = createAndTermGroup();
            termGroup.terms.push(createSearchTerm("book"));
            termGroup.terms.push(createSearchTerm("movie"));
            await testSearchMessages(termGroup);
        },
        testTimeout,
    );

    async function testSearchKnowledge(
        termGroup: SearchTermGroup,
        knowledgeType: KnowledgeType,
    ) {
        const matches = await searchConversationKnowledge(
            conversation!,
            termGroup,
            { knowledgeType },
        );
        expect(matches).toBeDefined();
        if (matches) {
            expect(matches.size).toEqual(1);
            const entities = matches.get(knowledgeType);
            expect(entities).toBeDefined();
            expect(entities?.semanticRefMatches.length).toBeGreaterThan(0);
        }
        return matches;
    }

    async function testSearchMessages(termGroup: SearchTermGroup) {
        const matches = await searchConversation(conversation!, termGroup);
        expect(matches).toBeDefined();
        if (matches) {
            expect(matches.messageMatches.length).toBeGreaterThan(0);
            verifyMessageOrdinals(matches.messageMatches);
        }
        return matches;
    }

    function verifyMessageOrdinals(scoredOrdinals: ScoredMessageOrdinal[]) {
        for (const ordinal of scoredOrdinals) {
            const message = conversation?.messages[ordinal.messageOrdinal];
            expect(message).toBeDefined();
        }
    }
});

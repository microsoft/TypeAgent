// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createAndTermGroup, createOrTermGroup } from "../src/common.js";
import {
    IConversation,
    KnowledgeType,
    ScoredMessageOrdinal,
    SemanticRef,
} from "../src/interfaces.js";
import {
    createSearchTerm,
    searchConversation,
    searchConversationKnowledge,
    SearchTermGroup,
    SemanticRefSearchResult,
} from "../src/search.js";
import {
    createOfflineConversationSettings,
    emptyConversation,
    findEntityWithName,
    getSemanticRefsForSearchResult,
    loadTestConversation,
} from "./testCommon.js";
import { ConversationSecondaryIndexes } from "../src/secondaryIndexes.js";

/**
 * These tests are designed to run offline.
 * They ONLY use terms for which we already have embeddings in the test data conversation index
 * This allows us to run fuzzy matching entirely offline
 */
describe("search.offline", () => {
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
        "lookup",
        () => {
            const books = conversation.semanticRefIndex?.lookupTerm("book");
            expect(books).toBeDefined();
            expect(books!.length).toBeGreaterThan(0);
        },
        testTimeout,
    );
    test(
        "searchKnowledge.and",
        async () => {
            let termGroup = createAndTermGroup(
                createSearchTerm("book"),
                createSearchTerm("movie"),
            );
            let matches = await runSearchKnowledge(termGroup, "entity");
            if (matches) {
                const semanticRefs = resolveAndVerifySemanticRefs(matches);
                expectHasEntities(semanticRefs, "Starship Troopers");
                expectDoesNotHaveEntities(semanticRefs, "Children of Time");
            }
            termGroup = createAndTermGroup(
                createSearchTerm("book"),
                createSearchTerm("spider"),
            );
            matches = await runSearchKnowledge(termGroup, "entity", false);
        },
        testTimeout,
    );
    test(
        "searchKnowledge.or",
        async () => {
            const termGroup = createOrTermGroup(
                createSearchTerm("book"),
                createSearchTerm("movie"),
                createSearchTerm("spider"),
            );
            let matches = await runSearchKnowledge(termGroup, "entity");
            if (matches) {
                const semanticRefs = resolveAndVerifySemanticRefs(matches);
                expectHasEntities(
                    semanticRefs,
                    "Starship Troopers",
                    "Children of Time",
                    "spider",
                    "spiders",
                    "Portids",
                );
            }
        },
        testTimeout,
    );
    test(
        "searchConversation.and",
        async () => {
            const termGroup = createAndTermGroup(
                createSearchTerm("book"),
                createSearchTerm("movie"),
            );
            await runSearchConversation(termGroup);
        },
        testTimeout,
    );

    async function runSearchKnowledge(
        termGroup: SearchTermGroup,
        knowledgeType: KnowledgeType,
        expectMatches: boolean = true,
    ): Promise<SemanticRefSearchResult | undefined> {
        const matches = await searchConversationKnowledge(
            conversation,
            termGroup,
            { knowledgeType },
        );
        if (expectMatches) {
            expect(matches).toBeDefined();
            if (matches) {
                expect(matches.size).toEqual(1);
                const entities = matches.get(knowledgeType);
                expect(entities).toBeDefined();
                expect(entities?.semanticRefMatches.length).toBeGreaterThan(0);
                return matches.get(knowledgeType);
            }
        } else {
            if (matches) {
                expect(matches.size).toEqual(0);
            }
        }
        return undefined;
    }

    async function runSearchConversation(termGroup: SearchTermGroup) {
        const matches = await searchConversation(conversation, termGroup);
        expect(matches).toBeDefined();
        if (matches) {
            expect(matches.messageMatches.length).toBeGreaterThan(0);
            verifyMessageOrdinals(matches.messageMatches);
        }
        return matches;
    }

    function verifyMessageOrdinals(scoredOrdinals: ScoredMessageOrdinal[]) {
        for (const ordinal of scoredOrdinals) {
            const message = conversation.messages[ordinal.messageOrdinal];
            expect(message).toBeDefined();
        }
    }

    function resolveAndVerifySemanticRefs(matches: SemanticRefSearchResult) {
        const semanticRefs = getSemanticRefsForSearchResult(
            conversation,
            matches,
        );
        expect(semanticRefs).toHaveLength(matches.semanticRefMatches.length);
        expect(semanticRefs).not.toContain(undefined);
        return semanticRefs;
    }

    function expectHasEntities(
        semanticRefs: SemanticRef[],
        ...entityNames: string[]
    ) {
        for (const entityName of entityNames) {
            const entity = findEntityWithName(semanticRefs, entityName);
            expect(entity).toBeDefined();
        }
    }

    function expectDoesNotHaveEntities(
        semanticRefs: SemanticRef[],
        ...entityNames: string[]
    ) {
        for (const entityName of entityNames) {
            const entity = findEntityWithName(semanticRefs, entityName);
            expect(entity).toBeUndefined();
        }
    }
});

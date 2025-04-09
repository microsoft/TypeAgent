// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    IConversation,
    KnowledgeType,
    SearchTermGroup,
} from "../src/interfaces.js";
import {
    searchConversationKnowledge,
    SemanticRefSearchResult,
} from "../src/search.js";
import {
    createSearchTerm,
    createAndTermGroup,
    createOrTermGroup,
} from "../src/searchLib.js";
import {
    emptyConversation,
    loadTestConversationForOffline,
    loadTestConversationForOnline,
    loadTestQueries,
    parseTestQuery,
} from "./testCommon.js";
import { createTestSearchOptions } from "../src/search.js";
import { runSearchConversation } from "./testCommon.js";
import {
    expectDoesNotHaveEntities,
    expectHasEntities,
    resolveAndVerifyKnowledgeMatches,
    resolveAndVerifySemanticRefs,
    verifyDidMatchSearchGroup,
    verifySemanticRefResult,
} from "./verify.js";
import { hasTestKeys, describeIf } from "test-lib";

/**
 * These tests are designed to run offline.
 * They ONLY use terms for which we already have embeddings in the test data conversation index
 * This allows us to run fuzzy matching entirely offline
 */
describe("search.offline", () => {
    const testTimeout = 5 * 60 * 1000;
    let conversation: IConversation = emptyConversation();

    beforeAll(async () => {
        conversation = await loadTestConversationForOffline();
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
                const semanticRefs = resolveAndVerifySemanticRefs(
                    conversation,
                    matches,
                );
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
        "searchKnowledge.andOr",
        async () => {
            let termGroup = createAndTermGroup(
                createOrTermGroup(
                    createSearchTerm("Children of Time"),
                    createSearchTerm("Starship Troopers"),
                ),
                createSearchTerm("movie", undefined, true), // Exact match movies
            );
            let matches = await runSearchKnowledge(termGroup, "entity");
            if (matches) {
                const semanticRefs = resolveAndVerifySemanticRefs(
                    conversation,
                    matches,
                );
                expectHasEntities(semanticRefs, "Starship Troopers");
                expectDoesNotHaveEntities(semanticRefs, "Children of Time");
            }
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
                const semanticRefs = resolveAndVerifySemanticRefs(
                    conversation,
                    matches,
                );
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
            const results = await runSearchConversation(
                conversation,
                termGroup,
            );
            resolveAndVerifyKnowledgeMatches(conversation, results);
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
            createTestSearchOptions(),
        );
        if (expectMatches) {
            expect(matches).toBeDefined();
            if (matches) {
                expect(matches.size).toEqual(1);
                const entities = matches.get(knowledgeType);
                verifySemanticRefResult(entities);
                return entities;
            }
        } else {
            if (matches) {
                expect(matches.size).toEqual(0);
            }
        }
        return undefined;
    }
});

/**
 * Online set of tests. Will run only if keys are available
 */
describeIf(
    "search.online",
    () => hasTestKeys(),
    () => {
        const testTimeout = 5 * 60 * 1000;
        let conversation: IConversation = emptyConversation();

        beforeAll(async () => {
            conversation = await loadTestConversationForOnline();
        });

        test(
            "search.queries",
            async () => {
                let queries = loadTestQueries(
                    "./test/data/Episode_53_query.txt",
                    100,
                );
                for (const query of queries) {
                    const searchExpr = parseTestQuery(conversation, query);
                    const results = await runSearchConversation(
                        conversation,
                        searchExpr.searchTermGroup,
                        searchExpr.when,
                    );
                    const kType = searchExpr.when?.knowledgeType;
                    if (kType !== undefined) {
                        const knowledgeMatches =
                            results.knowledgeMatches.get(kType);
                        expect(knowledgeMatches).toBeDefined();
                        const semanticRefs = resolveAndVerifySemanticRefs(
                            conversation,
                            knowledgeMatches!,
                        );
                        for (const semanticRef of semanticRefs) {
                            verifyDidMatchSearchGroup(
                                searchExpr.searchTermGroup,
                                semanticRef,
                                kType,
                            );
                        }
                    } else {
                        resolveAndVerifyKnowledgeMatches(conversation, results);
                    }
                }
            },
            testTimeout,
        );
    },
);

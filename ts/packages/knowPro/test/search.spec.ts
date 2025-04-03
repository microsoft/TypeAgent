// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    IConversation,
    KnowledgeType,
    SearchTermGroup,
} from "../src/interfaces.js";
import {
    searchConversation,
    searchConversationKnowledge,
    SemanticRefSearchResult,
    WhenFilter,
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
import {
    expectDoesNotHaveEntities,
    expectHasEntities,
    resolveAndVerifySemanticRefs,
    verifyMessageOrdinals,
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
            await runSearchConversation(conversation, termGroup);
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
                const maxQueries = 100;
                const testFile = "./test/data/Episode_53_query.txt";
                let queries = loadTestQueries(testFile);
                queries = queries.slice(0, maxQueries);
                for (const query of queries) {
                    const searchExpr = parseTestQuery(conversation, query);
                    await runSearchConversation(
                        conversation,
                        searchExpr.searchTermGroup,
                        searchExpr.when,
                    );
                }
            },
            testTimeout,
        );
    },
);

async function runSearchConversation(
    conversation: IConversation,
    termGroup: SearchTermGroup,
    when?: WhenFilter,
) {
    const matches = await searchConversation(conversation, termGroup, when);
    expect(matches).toBeDefined();
    if (matches) {
        expect(matches.messageMatches.length).toBeGreaterThan(0);
        verifyMessageOrdinals(conversation, matches.messageMatches);
    }
    return matches;
}

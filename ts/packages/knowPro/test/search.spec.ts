// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    IConversation,
    KnowledgeType,
    SearchTermGroup,
    SemanticRefSearchResult,
} from "../src/interfaces.js";
import { searchConversationKnowledge } from "../src/search.js";
import {
    createSearchTerm,
    createAndTermGroup,
    createOrTermGroup,
    createPropertySearchTerm,
    createOrMaxTermGroup,
} from "../src/searchLib.js";
import {
    emptyConversation,
    loadTestConversationForOffline,
    loadTestConversationForOnline,
    loadTestQueries,
    parseTestQuery,
} from "./testCommon.js";
import { createSearchOptions } from "../src/search.js";
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
import { validateSearchTermGroup } from "../src/compileLib.js";

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
                expectHasEntities(semanticRefs, "The Circle");
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
                    createSearchTerm("The Circle"),
                ),
                createSearchTerm("movie", undefined, true), // Exact match movies
            );
            let matches = await runSearchKnowledge(termGroup, "entity");
            if (matches) {
                const semanticRefs = resolveAndVerifySemanticRefs(
                    conversation,
                    matches,
                );
                expectHasEntities(semanticRefs, "The Circle");
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
                    "The Circle",
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
    test(
        "searchTermGroup.validate",
        () => {
            let stg = createAndTermGroup();

            let term = createSearchTerm("book");
            term.relatedTerms = [{ text: "novel" }, { text: "fiction" }];
            stg.terms.push(term);
            term = createSearchTerm("movie");
            stg.terms.push(term);
            let propertyTerm = createPropertySearchTerm("type", "book");
            stg.terms.push(propertyTerm);

            let nestedGroup = createOrMaxTermGroup();
            term = createSearchTerm("bicycle");
            term.relatedTerms = [{ text: "bike" }, { text: "cycle" }];
            nestedGroup.terms.push(term);
            propertyTerm = createPropertySearchTerm("type", "album");
            nestedGroup.terms.push(term);

            stg.terms.push(nestedGroup);

            let error = validateSearchTermGroup(stg);
            expect(error).toBeUndefined();

            stg = createOrTermGroup();
            (stg as any).booleanOp = "";
            error = validateSearchTermGroup(stg);
            expect(error).toBeDefined();

            stg = createOrTermGroup();
            error = validateSearchTermGroup(stg);
            expect(error).toBeDefined();

            term = createSearchTerm("");
            stg.terms.push(term);
            error = validateSearchTermGroup(stg);
            expect(error).toBeDefined();
            stg.terms.pop();

            term = createSearchTerm("book");
            stg.terms.push(term);
            term.relatedTerms = [];
            term.relatedTerms.push({ text: "novel" });
            term.relatedTerms.push({ text: "" });
            error = validateSearchTermGroup(stg);
            expect(error).toBeDefined();
            stg.terms.pop();

            term = createSearchTerm("book");
            stg.terms.push(term);
            term.relatedTerms = [];
            term.relatedTerms.push({ text: "novel" });
            term.relatedTerms.push({ text: "fiction" });
            error = validateSearchTermGroup(stg);
            expect(error).toBeUndefined();

            propertyTerm = createPropertySearchTerm("", "value");
            stg.terms.push(propertyTerm);
            error = validateSearchTermGroup(stg);
            expect(error).toBeDefined();
            stg.terms.pop();

            propertyTerm = createPropertySearchTerm("name", "");
            stg.terms.push(propertyTerm);
            error = validateSearchTermGroup(stg);
            expect(error).toBeDefined();
            stg.terms.pop();

            propertyTerm = createPropertySearchTerm("name", "value");
            stg.terms.push(propertyTerm);
            error = validateSearchTermGroup(stg);
            expect(error).toBeUndefined();

            nestedGroup = createOrTermGroup();
            propertyTerm = createPropertySearchTerm("", "value");
            nestedGroup.terms.push(propertyTerm);
            stg.terms.push(nestedGroup);
            error = validateSearchTermGroup(stg);
            expect(error).toBeDefined();
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
            createSearchOptions(),
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

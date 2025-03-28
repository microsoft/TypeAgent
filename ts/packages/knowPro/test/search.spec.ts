// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createAndTermGroup, createOrTermGroup } from "../src/common.js";
import { createConversationSettings } from "../src/conversation.js";
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
    createConversationFromFile,
    getRelativePath,
    hasTestKeys,
    testIf,
    emptyConversation,
    getSemanticRefsForSearchResult,
    findEntityWithName,
} from "./testCommon.js";

describe("knowpro.search.offline", () => {
    const testTimeout = 1000 * 60 * 5;
    let conversation: IConversation = emptyConversation();

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
            const books = conversation.semanticRefIndex?.lookupTerm("book");
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
            const matches = await runSearchKnowledge(termGroup, "entity");
            if (matches) {
                const semanticRefs = resolveAndVerifySemanticRefs(matches);
                verifyHasEntity(semanticRefs, "Starship Troopers");
            }
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
            await runSearchMessages(termGroup);
        },
        testTimeout,
    );

    async function runSearchKnowledge(
        termGroup: SearchTermGroup,
        knowledgeType: KnowledgeType,
    ): Promise<SemanticRefSearchResult | undefined> {
        const matches = await searchConversationKnowledge(
            conversation,
            termGroup,
            { knowledgeType },
        );
        expect(matches).toBeDefined();
        if (matches) {
            expect(matches.size).toEqual(1);
            const entities = matches.get(knowledgeType);
            expect(entities).toBeDefined();
            expect(entities?.semanticRefMatches.length).toBeGreaterThan(0);
            return matches.get(knowledgeType);
        }
        return undefined;
    }

    async function runSearchMessages(termGroup: SearchTermGroup) {
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

    function verifyHasEntity(semanticRefs: SemanticRef[], entityName: string) {
        const entity = findEntityWithName(semanticRefs, entityName);
        expect(entity).toBeDefined();
    }
});

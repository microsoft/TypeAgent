// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    normalizeSearchTerm,
    migrateSearchTermPostings,
} from "../src/termNormalization.js";
import { TermToSemanticRefIndex } from "../src/conversationIndex.js";
import { PropertyIndex } from "../src/propertyIndex.js";
import { TermToRelatedTermsMap } from "../src/relatedTermsIndex.js";
import { searchConversationKnowledge } from "../src/search.js";
import { TestConversation } from "./testCommon.js";
import { TestMessage } from "./testMessage.js";

describe("versioned search-term normalization", () => {
    test.each([
        [" \tCAFE\u0301\n", "caf\u00e9"],
        ["A\u00a0 \t B", "a b"],
        ["\u0130", "i\u0307"],
        ["\u1e9b\u0323", "\u1e9b\u0323".toLowerCase().normalize("NFC")],
        ["\u0085A\u2003B\u0085", "a b"],
        ["\ufeffA\ufeff", "\ufeffa\ufeff"],
    ])(
        "normalizes %j idempotently without compatibility folding",
        (input, expected) => {
            expect(normalizeSearchTerm(input)).toBe(expected);
            expect(normalizeSearchTerm(normalizeSearchTerm(input))).toBe(
                expected,
            );
        },
    );

    test("writes, reads, removals, properties and related aliases share keys", () => {
        const index = new TermToSemanticRefIndex();
        index.addTerm(" CAF\u00c9 ", 0);
        index.addTerm("cafe\u0301", 1);
        expect(
            index
                .lookupTerm("\tcafe\u0301\n")
                .map((posting) => posting.semanticRefOrdinal),
        ).toEqual([0, 1]);
        index.removeTerm("cafe\u0301", 0);
        expect(index.lookupTerm("caf\u00e9")).toEqual([
            { semanticRefOrdinal: 1, score: 1 },
        ]);
        const reloaded = new TermToSemanticRefIndex(index.serialize());
        expect(reloaded.lookupTerm(" CAF\u00c9 ")).toEqual(
            index.lookupTerm("caf\u00e9"),
        );
        const properties = new PropertyIndex();
        properties.addProperty("name", " CAF\u00c9 ", 1);
        expect(
            properties.lookupProperty("name", "\tcafe\u0301\n"),
        ).toHaveLength(1);
        const related = new TermToRelatedTermsMap();
        related.addRelatedTerm(" CAF\u00c9 ", { text: " \tCOFFEE\n" });
        expect(related.lookupTerm("cafe\u0301")).toEqual([{ text: "coffee" }]);
        related.removeTerm("cafe\u0301");
        expect(related.lookupTerm("caf\u00e9")).toBeUndefined();
    });

    test("collision migration takes maximum scores without losing distinct postings; old keys remain usable", () => {
        const legacy = {
            items: [
                {
                    term: "cafe\u0301",
                    semanticRefOrdinals: [
                        { semanticRefOrdinal: 0, score: 2 },
                        { semanticRefOrdinal: 1, score: 1 },
                    ],
                },
                {
                    term: "caf\u00e9",
                    semanticRefOrdinals: [{ semanticRefOrdinal: 0, score: 5 }],
                },
            ],
        };
        const original = structuredClone(legacy);
        const oldIndex = new TermToSemanticRefIndex(legacy);
        expect(oldIndex.normalizationVersion).toBe(1);
        expect(oldIndex.lookupTerm("cafe\u0301")).toHaveLength(2);
        expect(oldIndex.lookupTerm("caf\u00e9")).toHaveLength(1);
        const upgraded = new TermToSemanticRefIndex(
            migrateSearchTermPostings(legacy),
        );
        expect(upgraded.lookupTerm(" CAF\u00c9 ")).toEqual([
            { semanticRefOrdinal: 0, score: 5 },
            { semanticRefOrdinal: 1, score: 1 },
        ]);
        expect(legacy).toEqual(original);
        expect(() => normalizeSearchTerm("term", 3 as 2)).toThrow(
            "Unsupported",
        );
    });

    test("real query preparation uses the committed normalizer while display labels stay unchanged", async () => {
        const conversation = new TestConversation(
            "fixture",
            [],
            [new TestMessage("fixture")],
        );
        conversation.semanticRefIndex = new TermToSemanticRefIndex();
        const label = " CAF\u00c9 ";
        conversation.semanticRefs.append({
            semanticRefOrdinal: 0,
            knowledgeType: "entity",
            range: { start: { messageOrdinal: 0 } },
            knowledge: { name: label, type: ["fixture"] },
        });
        conversation.semanticRefIndex.addTerm(label, 0);
        const result = await searchConversationKnowledge(
            conversation,
            {
                booleanOp: "or",
                terms: [
                    {
                        propertyName: "name",
                        propertyValue: { term: { text: "\tcafe\u0301\n" } },
                    },
                ],
            },
            undefined,
            { exactMatch: true },
        );
        expect(
            result
                ?.get("entity")
                ?.semanticRefMatches.map(
                    (posting) => posting.semanticRefOrdinal,
                ),
        ).toEqual([0]);
        expect(conversation.semanticRefs.get(0).knowledge).toEqual({
            name: label,
            type: ["fixture"],
        });
    });
});

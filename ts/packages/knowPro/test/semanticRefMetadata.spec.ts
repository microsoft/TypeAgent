// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    SemanticRefCollection,
    getSemanticRefMetadata,
} from "../src/storage.js";
import {
    SemanticRefAccumulator,
    TextRangesInScope,
    TextRangeCollection,
} from "../src/collections.js";
import {
    KnowledgeTypePredicate,
    QueryEvalContext,
    WhereSemanticRefExpr,
    lookupKnowledgeType,
    lookupTerm,
} from "../src/query.js";
import { TermToSemanticRefIndex } from "../src/conversationIndex.js";
import { TestConversation } from "./testCommon.js";
import { TestMessage } from "./testMessage.js";
import type { ISemanticRefCollection } from "../src/interfaces.js";

describe("metadata-only query filtering", () => {
    test("scope, kinds and score grouping avoid hydration and preserve match statistics", () => {
        const conversation = new TestConversation(
            "synthetic",
            [],
            [new TestMessage("first"), new TestMessage("second")],
        );
        conversation.semanticRefIndex = new TermToSemanticRefIndex();
        for (let ordinal = 0; ordinal < 4; ordinal++) {
            conversation.semanticRefs.append({
                semanticRefOrdinal: ordinal,
                range: { start: { messageOrdinal: ordinal % 2 } },
                knowledgeType: ordinal < 2 ? "topic" : "entity",
                knowledge:
                    ordinal < 2
                        ? { text: "synthetic" }
                        : { name: "synthetic", type: ["fixture"] },
            });
            conversation.semanticRefIndex.addTerm("synthetic", {
                semanticRefOrdinal: ordinal,
                score: ordinal + 1,
            });
        }
        conversation.semanticRefs.get = () => {
            throw new Error("unnecessary hydration");
        };
        const accumulator = new SemanticRefAccumulator(new Set(["synthetic"]));
        for (let ordinal = 3; ordinal >= 0; ordinal--)
            accumulator.addExact(ordinal, ordinal + 1);
        const scope = new TextRangesInScope();
        scope.addTextRanges(
            new TextRangeCollection([
                { start: { messageOrdinal: 0 }, end: { messageOrdinal: 1 } },
            ]),
        );
        const scoped = accumulator.getMatchesInScope(
            conversation.semanticRefs,
            scope,
        );
        expect(
            [...scoped.getMatches()].map((match) => [
                match.value,
                match.score,
                match.hitCount,
            ]),
        ).toEqual([
            [2, 3, 1],
            [0, 1, 1],
        ]);
        expect(scoped.searchTermMatches).toEqual(new Set(["synthetic"]));
        expect([
            ...accumulator.groupMatchesByType(conversation.semanticRefs).keys(),
        ]).toEqual(["entity", "topic"]);
        expect([
            ...lookupKnowledgeType(conversation.semanticRefs, "topic", scope),
        ]).toEqual([{ semanticRefOrdinal: 0, score: 1 }]);
        expect(
            lookupTerm(
                conversation.semanticRefIndex,
                { text: "synthetic" },
                conversation.semanticRefs,
                scope,
                "entity",
            ),
        ).toEqual([{ semanticRefOrdinal: 2, score: 3 }]);
        const filtered = new WhereSemanticRefExpr({ eval: () => accumulator }, [
            new KnowledgeTypePredicate("topic"),
        ]).eval(new QueryEvalContext(conversation));
        expect([...filtered.getMatches()].map((match) => match.value)).toEqual([
            1, 0,
        ]);
    });

    test("legacy capability absence is supported, but capability errors are not retried", () => {
        const refs = new SemanticRefCollection([
            {
                semanticRefOrdinal: 0,
                knowledgeType: "topic",
                range: { start: { messageOrdinal: 0 } },
                knowledge: { text: "synthetic" },
            },
        ]);
        const legacy: ISemanticRefCollection = {
            isPersistent: false,
            length: 1,
            get: refs.get.bind(refs),
            getMultiple: refs.getMultiple.bind(refs),
            getAll: refs.getAll.bind(refs),
            getSlice: refs.getSlice.bind(refs),
            append: refs.append.bind(refs),
            [Symbol.iterator]: refs[Symbol.iterator].bind(refs),
        };
        expect([...getSemanticRefMetadata(legacy, [0, 0])]).toHaveLength(2);
        legacy.getMetadataMultiple = () => {
            throw new Error("storage failure");
        };
        expect(() => [...getSemanticRefMetadata(legacy, [0])]).toThrow(
            "storage failure",
        );
    });
});

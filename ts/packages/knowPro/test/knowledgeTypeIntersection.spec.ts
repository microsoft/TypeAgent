// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TermToSemanticRefIndex } from "../src/conversationIndex.js";
import type {
    KnowledgeType,
    SemanticRefSearchResult,
} from "../src/interfaces.js";
import { MessagesFromKnowledgeExpr, QueryEvalContext } from "../src/query.js";
import { TestConversation } from "./testCommon.js";
import { TestMessage } from "./testMessage.js";

describe("message intersection counts distinct knowledge types, not increasing scores", () => {
    test("equal-score entity/topic matches beat duplicate same-type matches", () => {
        const conversation = new TestConversation(
            "synthetic",
            [],
            [new TestMessage("Both types"), new TestMessage("Entity only")],
        );
        conversation.semanticRefIndex = new TermToSemanticRefIndex();
        for (const [ordinal, messageOrdinal] of [0, 1, 1, 0].entries()) {
            conversation.semanticRefs.append({
                semanticRefOrdinal: ordinal,
                range: { start: { messageOrdinal, chunkOrdinal: 0 } },
                knowledgeType: ordinal === 3 ? "topic" : "entity",
                knowledge:
                    ordinal === 3
                        ? { text: "A synthetic observation" }
                        : { name: `Pebble-${ordinal}`, type: ["synthetic"] },
            });
        }
        const matches = new Map<KnowledgeType, SemanticRefSearchResult>([
            [
                "entity",
                {
                    termMatches: new Set(),
                    semanticRefMatches: [
                        { semanticRefOrdinal: 0, score: 10 },
                        { semanticRefOrdinal: 1, score: 10 },
                        { semanticRefOrdinal: 2, score: 20 },
                    ],
                },
            ],
            [
                "topic",
                {
                    termMatches: new Set(),
                    semanticRefMatches: [{ semanticRefOrdinal: 3, score: 10 }],
                },
            ],
        ]);
        const result = new MessagesFromKnowledgeExpr(matches).eval(
            new QueryEvalContext(conversation),
        );
        expect([...result.getMatches()].map((match) => match.value)).toEqual([
            0,
        ]);
        const oneType = new MessagesFromKnowledgeExpr(
            new Map([["entity", matches.get("entity")!]]),
        ).eval(new QueryEvalContext(conversation));
        expect([...oneType.getMatches()].map((match) => match.value)).toEqual([
            0, 1,
        ]);
        conversation.messages.append(new TestMessage("Topic only"));
        conversation.semanticRefs.get(3).range.start.messageOrdinal = 2;
        const disjoint = new MessagesFromKnowledgeExpr(matches).eval(
            new QueryEvalContext(conversation),
        );
        expect([...disjoint.getMatches()].map((match) => match.value)).toEqual([
            0, 1, 2,
        ]);
    });
});

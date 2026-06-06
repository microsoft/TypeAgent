// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    knowledgeToObservation,
    KnowledgeLike,
} from "../src/feeders/knowledgeExtractionFeeder.js";
import { TrustTier } from "../src/model.js";

describe("knowledgeToObservation", () => {
    const ts = 1_700_000_000_000;

    test("maps entities, types and facets (coercing Quantity to scalar)", () => {
        const knowledge: KnowledgeLike = {
            entities: [
                {
                    name: "Adrian Tchaikovsky",
                    type: ["author", "person"],
                    facets: [
                        { name: "nationality", value: "British" },
                        { name: "weight", value: { amount: 4, units: "kg" } },
                    ],
                },
            ],
            actions: [],
            topics: ["science fiction"],
        };

        const obs = knowledgeToObservation(knowledge, {
            timestamp: ts,
            source: "doc:1",
        });

        expect(obs.feeder).toBe("knowledge-extraction");
        expect(obs.tier).toBe(TrustTier.ExtractorInferred);
        expect(obs.timestamp).toBe(ts);
        expect(obs.source).toBe("doc:1");
        expect(obs.entities).toHaveLength(1);
        const e = obs.entities[0];
        expect(e.types).toEqual(["author", "person"]);
        expect(e.facets).toEqual([
            { name: "nationality", value: "British" },
            { name: "weight", value: "4 kg" },
        ]);
    });

    test("maps actions to relations and joins verbs into a predicate", () => {
        const knowledge: KnowledgeLike = {
            entities: [
                { name: "Adrian Tchaikovsky", type: ["author"] },
                { name: "Children of Time", type: ["book"] },
            ],
            actions: [
                {
                    verbs: ["wrote"],
                    subjectEntityName: "Adrian Tchaikovsky",
                    objectEntityName: "Children of Time",
                },
            ],
        };

        const obs = knowledgeToObservation(knowledge, { timestamp: ts });
        expect(obs.relations).toEqual([
            {
                subject: "Adrian Tchaikovsky",
                predicate: "wrote",
                object: "Children of Time",
            },
        ]);
    });

    test("drops relations referencing 'none' or unknown entities", () => {
        const knowledge: KnowledgeLike = {
            entities: [{ name: "Alice", type: ["person"] }],
            actions: [
                {
                    verbs: ["met"],
                    subjectEntityName: "Alice",
                    objectEntityName: "none",
                },
                {
                    verbs: ["met"],
                    subjectEntityName: "Alice",
                    objectEntityName: "Ghost",
                },
            ],
        };

        const obs = knowledgeToObservation(knowledge, { timestamp: ts });
        expect(obs.relations).toHaveLength(0);
    });
});

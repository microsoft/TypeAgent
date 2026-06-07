// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    knowledgeToObservation,
    KnowledgeLike,
    newExtractionStats,
    observationsFromExtraction,
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

    test("captures an action's subjectEntityFacet onto its subject entity", () => {
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
                    subjectEntityFacet: {
                        name: "unsuccessful writing",
                        value: { amount: 7, units: "years" },
                    },
                },
            ],
        };

        const obs = knowledgeToObservation(knowledge, { timestamp: ts });
        const adrian = obs.entities.find(
            (e) => e.name === "Adrian Tchaikovsky",
        );
        // The Quantity value is coerced to a scalar, like other facets.
        expect(adrian?.facets).toEqual([
            { name: "unsuccessful writing", value: "7 years" },
        ]);
    });

    test("ignores a subjectEntityFacet whose subject is not a known entity", () => {
        const knowledge: KnowledgeLike = {
            entities: [{ name: "Alice", type: ["person"] }],
            actions: [
                {
                    verbs: ["likes"],
                    subjectEntityName: "Ghost",
                    objectEntityName: "none",
                    subjectEntityFacet: { name: "hobby", value: "chess" },
                },
            ],
        };

        const obs = knowledgeToObservation(knowledge, { timestamp: ts });
        const alice = obs.entities.find((e) => e.name === "Alice");
        expect(alice?.facets).toBeUndefined();
    });

    test("does not duplicate a facet already present on the entity", () => {
        const knowledge: KnowledgeLike = {
            entities: [
                {
                    name: "Adrian Tchaikovsky",
                    type: ["author"],
                    facets: [{ name: "Nationality", value: "British" }],
                },
            ],
            actions: [
                {
                    verbs: ["is"],
                    subjectEntityName: "Adrian Tchaikovsky",
                    objectEntityName: "none",
                    // Same facet name (different case) must not be added twice.
                    subjectEntityFacet: {
                        name: "nationality",
                        value: "English",
                    },
                },
            ],
        };

        const obs = knowledgeToObservation(knowledge, { timestamp: ts });
        const adrian = obs.entities[0];
        expect(adrian.facets).toEqual([
            { name: "Nationality", value: "British" },
        ]);
    });
});

describe("observationsFromExtraction", () => {
    const ts = 1_700_000_000_000;

    test("records a failure and surfaces nothing when extraction fails", () => {
        const stats = newExtractionStats();
        const out = observationsFromExtraction(
            { success: false, message: "400 BadRequest" },
            { source: "doc:1" },
            ts,
            stats,
        );
        expect(out).toEqual([]);
        expect(stats).toEqual({ attempts: 1, failures: 1, empty: 0 });
    });

    test("records an empty extraction that yields no entities", () => {
        const stats = newExtractionStats();
        const out = observationsFromExtraction(
            { success: true, data: { entities: [], actions: [] } },
            { source: "doc:1" },
            ts,
            stats,
        );
        expect(out).toHaveLength(1);
        expect(out[0].entities).toHaveLength(0);
        expect(stats).toEqual({ attempts: 1, failures: 0, empty: 1 });
    });

    test("counts a successful extraction with entities as a clean ingest", () => {
        const stats = newExtractionStats();
        const out = observationsFromExtraction(
            {
                success: true,
                data: {
                    entities: [
                        { name: "Adrian Tchaikovsky", type: ["author"] },
                    ],
                    actions: [],
                },
            },
            { source: "doc:1" },
            ts,
            stats,
        );
        expect(out).toHaveLength(1);
        expect(out[0].entities).toHaveLength(1);
        expect(stats).toEqual({ attempts: 1, failures: 0, empty: 0 });
    });
});

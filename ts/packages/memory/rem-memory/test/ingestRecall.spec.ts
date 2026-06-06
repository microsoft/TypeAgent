// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { OxigraphStore } from "../src/oxigraphStore.js";
import { SignalStore } from "../src/signalStore.js";
import { EntityResolver } from "../src/resolver.js";
import { RemMemory } from "../src/ingest.js";
import { Observation, RecallResult, TrustTier } from "../src/model.js";
import {
    editSimilarity,
    fuzzyLexicalScore,
    levenshtein,
    splitOrClauses,
} from "../src/recall.js";

function makeMemory(): {
    memory: RemMemory;
    rdf: OxigraphStore;
    signals: SignalStore;
    resolver: EntityResolver;
} {
    const rdf = new OxigraphStore();
    const signals = new SignalStore(":memory:");
    const resolver = new EntityResolver();
    const memory = new RemMemory(rdf, signals, resolver);
    return { memory, rdf, signals, resolver };
}

function observation(
    timestamp: number,
    tier = TrustTier.ExtractorInferred,
): Observation {
    return {
        feeder: "test",
        tier,
        timestamp,
        source: "doc:1",
        entities: [
            { name: "Adrian Tchaikovsky", types: ["author", "person"] },
            { name: "Children of Time", types: ["book"] },
            { name: "Cherryh", types: ["author"] },
        ],
        relations: [
            {
                subject: "Adrian Tchaikovsky",
                predicate: "wrote",
                object: "Children of Time",
            },
        ],
    };
}

describe("RemMemory ingest + recall", () => {
    const t0 = 1_700_000_000_000;

    test("ingest persists entities and relations and recall finds them", async () => {
        const { memory } = makeMemory();
        const result = await memory.ingestObservation(observation(t0));

        expect(result.entities).toHaveLength(3);
        expect(result.relations).toHaveLength(1);

        const hits = memory.recall("what did Tchaikovsky write?", {
            now: t0,
        });
        expect(hits.length).toBeGreaterThan(0);
        const top = hits[0];
        expect(top.relation.predicate).toBe("wrote");
        expect(top.subject.name).toBe("Adrian Tchaikovsky");
        expect(top.object.name).toBe("Children of Time");
        expect(top.tier).toBe(TrustTier.ExtractorInferred);
        expect(top.weight).toBeGreaterThan(0);
    });

    test("recall with no matching keywords returns nothing", async () => {
        const { memory } = makeMemory();
        await memory.ingestObservation(observation(t0));
        const hits = memory.recall("quantum chromodynamics", { now: t0 });
        expect(hits).toHaveLength(0);
    });

    test("repeated ingest reinforces the same relation (no duplicates)", async () => {
        const { memory } = makeMemory();
        await memory.ingestObservation(observation(t0));
        const first = memory.recall("Tchaikovsky wrote", { now: t0 })[0];

        await memory.ingestObservation(observation(t0 + 1000));
        const hits = memory.recall("Tchaikovsky wrote", { now: t0 + 1000 });

        // Still a single relation, but stronger after reinforcement.
        expect(hits).toHaveLength(1);
        expect(hits[0].weight).toBeGreaterThan(first.weight);
    });

    test("higher trust tier yields a stronger relation", async () => {
        const a = makeMemory();
        await a.memory.ingestObservation(
            observation(t0, TrustTier.ExtractorInferred),
        );
        const extractorWeight = a.memory.recall("Tchaikovsky wrote", {
            now: t0,
        })[0].weight;

        const b = makeMemory();
        await b.memory.ingestObservation(
            observation(t0, TrustTier.UserAsserted),
        );
        const userWeight = b.memory.recall("Tchaikovsky wrote", {
            now: t0,
        })[0].weight;

        expect(userWeight).toBeGreaterThan(extractorWeight);
    });

    test("weight decays so stale relations rank below fresh ones", async () => {
        const { memory } = makeMemory();
        // Old fact.
        await memory.ingestObservation({
            ...observation(t0),
            relations: [
                {
                    subject: "Adrian Tchaikovsky",
                    predicate: "wrote",
                    object: "Children of Time",
                },
            ],
        });
        // Fresh, competing fact 60 days later.
        const later = t0 + 60 * 86400 * 1000;
        await memory.ingestObservation({
            feeder: "test",
            tier: TrustTier.ExtractorInferred,
            timestamp: later,
            entities: [
                { name: "Adrian Tchaikovsky", types: ["author"] },
                { name: "Cherryh", types: ["author"] },
            ],
            relations: [
                {
                    subject: "Adrian Tchaikovsky",
                    predicate: "admires",
                    object: "Cherryh",
                },
            ],
        });

        const hits = memory.recall("Tchaikovsky", { now: later });
        const wrote = hits.find((h) => h.relation.predicate === "wrote");
        const admires = hits.find((h) => h.relation.predicate === "admires");
        expect(wrote).toBeDefined();
        expect(admires).toBeDefined();
        expect(admires!.weight).toBeGreaterThan(wrote!.weight);
    });

    test("type-aggregation recall lists all entities of a type", async () => {
        const { memory } = makeMemory();
        await memory.ingestObservation({
            feeder: "test",
            tier: TrustTier.ExtractorInferred,
            timestamp: t0,
            entities: [
                { name: "Adrian Tchaikovsky", types: ["author", "person"] },
                { name: "Children of Time", types: ["book"] },
                { name: "Children of Ruin", types: ["book", "novel"] },
                { name: "Dune", types: ["movie"] },
            ],
            relations: [],
        });

        // A plural query keyword ("books") should match the singular type
        // "book" and surface every book entity as an "is_a" fact.
        const hits = memory.recall("list all books", { now: t0 });
        const books = hits
            .filter((h) => h.relation.predicate === "is_a")
            .map((h) => h.subject.name)
            .sort();
        expect(books).toEqual(["Children of Ruin", "Children of Time"]);

        // A different type keyword returns its own entities only.
        const movieHits = memory.recall("list all movies", { now: t0 });
        const movies = movieHits
            .filter((h) => h.relation.predicate === "is_a")
            .map((h) => h.subject.name);
        expect(movies).toEqual(["Dune"]);
    });

    test("intersection recall lists entities matching all named types", async () => {
        const { memory } = makeMemory();
        await memory.ingestObservation({
            feeder: "test",
            tier: TrustTier.ExtractorInferred,
            timestamp: t0,
            entities: [
                { name: "Children of Time", types: ["book"] },
                { name: "Dune", types: ["book", "movie"] },
                { name: "Blade Runner", types: ["movie"] },
            ],
            relations: [],
        });

        const isaNames = (hits: RecallResult[]) => [
            ...new Set(
                hits
                    .filter((h) => h.relation.predicate === "is_a")
                    .map((h) => h.subject.name),
            ),
        ];

        // Explicit cue ("also") -> only entities that are BOTH book and movie.
        const both = memory.recall("list all books that are also movies", {
            now: t0,
        });
        expect(isaNames(both)).toEqual(["Dune"]);

        // No cue -> "books and movies" unions both types.
        const union = memory.recall("list all books and movies", { now: t0 });
        expect(isaNames(union).sort()).toEqual([
            "Blade Runner",
            "Children of Time",
            "Dune",
        ]);
    });

    test("fuzzy recall tolerates a misspelled entity name", async () => {
        const { memory } = makeMemory();
        await memory.ingestObservation(observation(t0));

        // "Tchaikovski" misspells the stored "Tchaikovsky" (one substitution);
        // it is not a substring, so only fuzzy matching can recover the fact.
        const hits = memory.recall("what did Tchaikovski write?", { now: t0 });
        expect(hits.length).toBeGreaterThan(0);
        const top = hits[0];
        expect(top.relation.predicate).toBe("wrote");
        expect(top.subject.name).toBe("Adrian Tchaikovsky");
        expect(top.object.name).toBe("Children of Time");
    });

    test("a strict fuzzyThreshold of 1 rejects misspellings", async () => {
        const { memory } = makeMemory();
        await memory.ingestObservation(observation(t0));

        // Pinning the threshold to exact matches drops the typo'd query.
        const hits = memory.recall("what did Tchaikovski write?", {
            now: t0,
            fuzzyThreshold: 1,
        });
        const wrote = hits.find((h) => h.relation.predicate === "wrote");
        expect(wrote).toBeUndefined();
    });

    test("multi-entity OR query surfaces facts about each named entity", async () => {
        const { memory } = makeMemory();
        await memory.ingestObservation({
            feeder: "test",
            tier: TrustTier.ExtractorInferred,
            timestamp: t0,
            entities: [
                { name: "Adrian Tchaikovsky", types: ["author"] },
                { name: "Empire in Black and Gold", types: ["book"] },
                { name: "Children of Ruin", types: ["book"] },
                { name: "Frank Herbert", types: ["author"] },
                { name: "Dune", types: ["book"] },
            ],
            relations: [
                {
                    subject: "Adrian Tchaikovsky",
                    predicate: "wrote",
                    object: "Empire in Black and Gold",
                },
                {
                    subject: "Adrian Tchaikovsky",
                    predicate: "wrote",
                    object: "Children of Ruin",
                },
                {
                    subject: "Frank Herbert",
                    predicate: "wrote",
                    object: "Dune",
                },
            ],
        });

        // A flat keyword bag can't match both titles against one relation; OR
        // splitting scores each clause independently and unions the hits.
        const hits = memory.recall(
            "anything on Empire in Black and Gold or Children of Ruin?",
            { now: t0 },
        );
        const objects = hits
            .filter((h) => h.relation.predicate === "wrote")
            .map((h) => h.object.name);
        expect(objects).toContain("Empire in Black and Gold");
        expect(objects).toContain("Children of Ruin");
        // The unrelated book is not pulled in by the OR query.
        expect(objects).not.toContain("Dune");
    });
});

describe("fuzzy matching helpers", () => {
    test("levenshtein counts single edits", () => {
        expect(levenshtein("gold", "gold")).toBe(0);
        expect(levenshtein("gold", "golds")).toBe(1);
        expect(levenshtein("tchaikovski", "tchaikovsky")).toBe(1);
        expect(levenshtein("", "abc")).toBe(3);
    });

    test("editSimilarity is 1 for identical and scales with edits", () => {
        expect(editSimilarity("gold", "gold")).toBe(1);
        expect(editSimilarity("tchaikovski", "tchaikovsky")).toBeCloseTo(
            0.909,
            2,
        );
        // A single short-word edit stays below the default 0.8 threshold.
        expect(editSimilarity("ruin", "rain")).toBeLessThan(0.8);
        expect(editSimilarity("", "")).toBe(1);
    });

    test("fuzzyLexicalScore credits exact substrings and near-misses", () => {
        const haystack = "empire in black and gold";
        // Exact substring -> full credit.
        expect(fuzzyLexicalScore(["gold"], haystack)).toBe(1);
        // Single-typo word -> partial credit, above threshold but below 1.
        const near = fuzzyLexicalScore(["empyre"], haystack);
        expect(near).toBeGreaterThanOrEqual(0.8);
        expect(near).toBeLessThan(1);
        // Below threshold -> no credit.
        expect(fuzzyLexicalScore(["zzzzzz"], haystack)).toBe(0);
        // No keywords -> no credit.
        expect(fuzzyLexicalScore([], haystack)).toBe(0);
    });

    test("fuzzyThreshold of 1 disables fuzzy credit", () => {
        const haystack = "empire in black and gold";
        expect(fuzzyLexicalScore(["empyre"], haystack, 1)).toBe(0);
        // Exact substring still counts at threshold 1.
        expect(fuzzyLexicalScore(["gold"], haystack, 1)).toBe(1);
    });

    test("splitOrClauses tokenizes each OR clause independently", () => {
        expect(
            splitOrClauses("Empire in Black and Gold or Children of Ruin"),
        ).toEqual([
            ["empire", "black", "gold"],
            ["children", "ruin"],
        ]);
        // No "or" -> a single clause with the whole keyword list.
        expect(splitOrClauses("what did Tchaikovsky write")).toEqual([
            ["tchaikovsky", "write"],
        ]);
        // "or" is matched as a whole word, not inside other words.
        expect(splitOrClauses("oracle history")).toEqual([
            ["oracle", "history"],
        ]);
    });
});

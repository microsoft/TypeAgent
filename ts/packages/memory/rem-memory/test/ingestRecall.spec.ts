// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { OxigraphStore } from "../src/oxigraphStore.js";
import { SignalStore } from "../src/signalStore.js";
import { EntityResolver } from "../src/resolver.js";
import { RemMemory } from "../src/ingest.js";
import { Observation, TrustTier } from "../src/model.js";

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
});

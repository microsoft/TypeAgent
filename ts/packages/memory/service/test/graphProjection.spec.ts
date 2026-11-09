// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { KnowProCorpusIndex } from "../src/knowProCorpusIndex.js";
import {
    graphProjectionLimits,
    GraphProjectionUnavailable,
    readGraphProjection,
} from "../src/graphProjection.js";
import type { CorpusIndex } from "../src/types.js";
import { graphInventory, boundGraphInventory } from "../src/graphQuery.js";
import type { GraphSupport } from "../src/graphTypes.js";

function index(
    refs: Array<{ source: string; type?: string; knowledge: unknown }>,
) {
    const value = new KnowProCorpusIndex(
        "fixture",
        ".graph-projection-fixture",
    );
    Object.assign(value, {
        activeRevisions: new Map(refs.map((ref) => [ref.source, "revision"])),
        memory: {
            messages: {
                get: (ordinal: number) => ({
                    metadata: {
                        sourceUrl: `typeagent-memory://sources/${refs[ordinal].source}/revisions/revision`,
                    },
                }),
            },
            semanticRefs: refs.map((ref, ordinal) => ({
                knowledgeType: ref.type ?? "entity",
                knowledge: ref.knowledge,
                range: { start: { messageOrdinal: ordinal, chunkOrdinal: 0 } },
            })),
        },
    });
    return value;
}

test("production bounded projection filters eligible event IDs and header-only names before aggregation", async () => {
    const value = index([
        { source: "inside", knowledge: { name: "Zephyr", type: ["system"] } },
        { source: "outside", knowledge: { name: "Zephyr", type: ["system"] } },
        { source: "outside", knowledge: { name: "Secret", type: ["system"] } },
        {
            source: "inside",
            knowledge: { name: "conversation-42", type: ["conversation"] },
        },
        {
            source: "inside",
            type: "action",
            knowledge: {
                subjectEntityName: "conversation-42",
                objectEntityName: "Zephyr",
                verbs: ["mentions"],
            },
        },
        {
            source: "inside",
            type: "action",
            knowledge: {
                subjectEntityName: "Zephyr",
                objectEntityName: "Queue",
                verbs: ["uses"],
            },
        },
    ]);
    const graph = await value.readKnowledgeGraph(
        new Set(["inside"]),
        "entities",
        new Map([["inside", new Set(["conversation-42"])]]),
    );
    expect(graph.entities).toEqual([
        {
            name: "Zephyr",
            types: ["system"],
            mentionCount: 1,
            sourceIds: ["inside"],
        },
    ]);
    expect(graph.relationships).toEqual([
        {
            fromEntity: "Zephyr",
            toEntity: "Queue",
            relationshipType: "uses",
            count: 1,
            sourceIds: ["inside"],
        },
    ]);
    expect(
        (await value.getKnowledgeGraph()).entities.find(
            (entity) => entity.name === "Zephyr",
        )?.mentionCount,
    ).toBe(2);
});

test("production projection enforces finite scan and aggregation budgets rather than only truncating output", async () => {
    const repeated = Array.from(
        { length: graphProjectionLimits.semanticReferences + 1 },
        () => ({
            source: "event",
            knowledge: { name: "Zephyr", type: ["system"] },
        }),
    );
    const value = index(repeated);
    await expect(
        value.readKnowledgeGraph(new Set(["event"]), "entities"),
    ).rejects.toBeInstanceOf(GraphProjectionUnavailable);
    expect((await value.getKnowledgeGraph()).entities[0].mentionCount).toBe(
        graphProjectionLimits.semanticReferences + 1,
    );
    const unique = index(
        Array.from(
            { length: graphProjectionLimits.nodes + 1 },
            (_, ordinal) => ({
                source: "event",
                knowledge: { name: `entity-${ordinal}`, type: ["system"] },
            }),
        ),
    );
    await expect(
        unique.readKnowledgeGraph(new Set(["event"]), "entities"),
    ).rejects.toThrow("node aggregation budget");
});

test("bounded graph capability is explicit for legacy/custom index adapters", async () => {
    await expect(
        readGraphProjection({} as CorpusIndex, new Set(), "topics"),
    ).rejects.toThrow("does not support bounded");
});

test("document suppressions preserve unrelated entities and independently scoped topic names", async () => {
    const value = index([
        {
            source: "source",
            knowledge: { name: "recovery", type: ["concept"] },
        },
        { source: "source", knowledge: { name: "Queue", type: ["system"] } },
        { source: "source", type: "topic", knowledge: { text: "recovery" } },
        {
            source: "source",
            type: "action",
            knowledge: {
                subjectEntityName: "recovery",
                objectEntityName: "Queue",
                verbs: ["uses"],
            },
        },
    ]);
    const exclusions = new Map([["source\0entity", new Set(["recovery"])]]);
    const entities = await value.readKnowledgeGraph(
        new Set(["source"]),
        "entities",
        exclusions,
    );
    expect(entities.entities.map((entity) => entity.name)).toEqual(["Queue"]);
    expect(entities.relationships).toEqual([]);
    expect(
        (
            await value.readKnowledgeGraph(
                new Set(["source"]),
                "topics",
                exclusions,
            )
        ).topics[0].name,
    ).toBe("recovery");
});

test("topic co-occurrence uses exact event turns, not an entire conversation or repeated independent votes", () => {
    const supports = new Map<string, GraphSupport>(
        ["a", "b", "c"].map((eventId) => [
            eventId,
            {
                kind: "event",
                corpusId: "corpus",
                eventId,
                conversationId: "chat",
                turnId: eventId === "c" ? "different-turn" : "same-turn",
                eventTime: "2026-10-24T00:00:00Z",
                authority: "evidence-only",
            },
        ]),
    );
    const inventory = graphInventory({ corpusId: "corpus", kind: "topics" }, [
        {
            supports,
            graph: {
                entities: [],
                relationships: [],
                topics: [
                    {
                        name: "recovery",
                        mentionCount: 2,
                        sourceIds: ["a", "b"],
                    },
                    { name: "queue safety", mentionCount: 1, sourceIds: ["b"] },
                    { name: "unrelated", mentionCount: 1, sourceIds: ["c"] },
                ],
            },
        },
    ]);
    expect(inventory.edges).toHaveLength(1);
    expect(inventory.edges[0]).toMatchObject({
        type: "co-occurrence",
        count: 1,
        supportCount: 2,
        distinctEventCount: 2,
        distinctTurnCount: 1,
    });
    const unrelated = inventory.nodes.find(
        (node) => node.label === "unrelated",
    )!;
    expect(
        inventory.edges.some(
            (edge) =>
                edge.source === unrelated.id || edge.target === unrelated.id,
        ),
    ).toBe(false);
});

test("inventory traversal exceeds 250 nodes without losing nodes and bounds UTF-8 payloads", () => {
    const supports = new Map<string, GraphSupport>([
        [
            "source",
            {
                kind: "document",
                corpusId: "corpus",
                sourceId: "source",
                revisionId: "revision",
            },
        ],
    ]);
    const request = {
        corpusId: "corpus",
        kind: "entities" as const,
        maxNodes: 250,
        maxEdges: 500,
    };
    const inventory = graphInventory(request, [
        {
            supports,
            graph: {
                topics: [],
                relationships: [],
                entities: Array.from({ length: 300 }, (_, ordinal) => ({
                    name: `${"🦉".repeat(600)}-${ordinal}`,
                    types: Array(8).fill("🦉".repeat(80)),
                    mentionCount: 1,
                    sourceIds: ["source"],
                })),
            },
        },
    ]);
    let token: string | undefined;
    const seen = new Set<string>();
    do {
        const page = boundGraphInventory(
            { ...request, ...(token ? { continuationToken: token } : {}) },
            inventory,
            "generation",
        );
        expect(Buffer.byteLength(JSON.stringify(page), "utf8")).toBeLessThan(
            512 * 1024,
        );
        expect(page.counts.nodes).toBe(300);
        for (const node of page.nodes) {
            expect(seen.has(node.id)).toBe(false);
            seen.add(node.id);
        }
        token = page.nextContinuationToken;
    } while (token);
    expect(seen.size).toBe(300);
});

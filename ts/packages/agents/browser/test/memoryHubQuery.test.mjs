// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
    createMemoryHubQueryFunctions,
    fuseEvidence,
} from "../dist/agent/memoryHubQuery.mjs";
import { createMemoryHubExploreFunctions } from "../dist/agent/memoryHubExplore.mjs";
import { createMemoryHubKnowledgeFunctions } from "../dist/agent/memoryHubKnowledge.mjs";
import { browserCorpusName } from "../dist/agent/browserMemoryService.mjs";
import { citedAnswer } from "../dist/agent/memoryHubAnswer.mjs";
import {
    conversationCorpusName,
    conversationProducerId,
} from "@typeagent/memory-service";

const time = "2026-10-02T00:00:00.000Z";
const corpora = [
    { corpusId: "a", name: "Documents" },
    { corpusId: "b", name: "Web" },
    { corpusId: "c", name: conversationCorpusName },
];
const event = {
    corpusId: "c",
    eventId: "event-1",
    sourceKind: "conversation",
    producer: {
        producerId: conversationProducerId,
        producerType: "dispatcher",
    },
    eventType: "explicit-decision",
    eventTime: time,
    content: "Keep the worker paused.",
    conversationId: "conversation-1",
    turnId: "turn-7",
    metadata: { authority: "explicit" },
};

function fixture() {
    const calls = [];
    const service = {
        listCorpora: async () => corpora,
        getCorpus: async (corpusId) => ({
            ...corpora.find((c) => c.corpusId === corpusId),
            sourceCount: corpusId === "c" ? 0 : 1,
        }),
        search: async (request) => {
            calls.push(["search", request]);
            const evidence = {
                corpusId: request.corpusId,
                evidenceId: "same",
                sourceId: "shared",
                revisionId: "r1",
                locator: "message:0",
                title: "Worker",
                canonicalUri: "https://example.invalid/same",
                snippet: "Check the worker.",
                sourceType: request.corpusId === "b" ? "web" : "markdown",
                score: request.corpusId === "b" ? 100_000 : 0.01,
                capturedAt: time,
            };
            return {
                matches: [evidence, evidence],
                warnings: ["Fixture warning"],
            };
        },
        searchProcedures: async (_request) => [
            {
                procedure: {
                    procedureId: "guide",
                    title: "Guide",
                    state: "saved",
                },
                version: {
                    version: 3,
                    createdAt: time,
                    markdown: "Check first.",
                    document: {
                        citations: [{ sourceId: "shared", revisionId: "r1" }],
                    },
                },
                score: 20,
            },
        ],
        searchEvents: async (request) => {
            calls.push(["events", request]);
            return { matches: [{ event, snippet: event.content, score: 2 }] };
        },
        getEvent: async () => event,
        getSource: async (corpusId, sourceId) => ({
            corpusId,
            sourceId,
            title: "Original",
            sourceType: "markdown",
            tags: ["ops"],
            activeRevisionId: "r2",
        }),
        getSourceContent: async (request) => {
            calls.push(["content", request]);
            return {
                content: "Retained original",
                offset: request.offset ?? 0,
                totalChars: 17,
                revisionId: request.revisionId ?? "r2",
                truncated: false,
            };
        },
        getProcedure: async (corpusId, procedureId, version) => {
            calls.push(["procedure", corpusId, procedureId, version]);
            return {
                version: version ?? 3,
                document: { title: "Guide" },
                markdown: "Exact saved version",
            };
        },
        getKnowledgeGraph: async () => ({
            entities: [
                {
                    name: "Worker",
                    types: ["service"],
                    mentionCount: 2,
                    sourceIds: ["shared"],
                },
            ],
            topics: [
                { name: "Operations", mentionCount: 1, sourceIds: ["shared"] },
            ],
            relationships: [
                {
                    fromEntity: "Worker",
                    toEntity: "Worker",
                    relationshipType: "checks",
                    count: 1,
                    sourceIds: ["shared"],
                },
            ],
        }),
        listProcedures: async () => [{ procedureId: "guide" }],
        listChanges: async (request) => {
            const records =
                request.corpusId === "c"
                    ? []
                    : Array.from({ length: 3 }, (_, i) => ({
                          changeId: `${request.corpusId}-${i}`,
                          corpusId: request.corpusId,
                          operation: "replace",
                          outcome: "committed",
                          createdAt: time,
                          counts: { sources: 1, revisions: 1, knowledge: 0 },
                      }));
            const start = Number(request.continuationToken ?? 0);
            const next = start + request.pageSize;
            return {
                items: records.slice(start, next),
                total: records.length,
                ...(next < records.length
                    ? { nextContinuationToken: String(next) }
                    : {}),
            };
        },
        answer: async () => {
            throw new Error("Per-corpus answers must never be concatenated");
        },
    };
    const synthesize = async (_question, matches) => ({
        text: "Check the worker.",
        mode: "synthesized",
        citationIds: [matches[0].id],
        followUps: [],
    });
    return {
        service,
        calls,
        synthesize,
        query: createMemoryHubQueryFunctions(
            () => service,
            () => "conversation-1",
            synthesize,
        ),
    };
}

test("query insights use exact returned-source knowledge and carry real capture metadata without inventing confidence", async () => {
    const { service, query } = fixture();
    service.getSource = async (corpusId, sourceId) => ({
        corpusId,
        sourceId,
        activeRevisionId: "r1",
    });
    const reads = [];
    service.getSourceKnowledge = async (corpusId, sourceId) => {
        reads.push([corpusId, sourceId]);
        return service.getKnowledgeGraph(corpusId);
    };
    const result = await query.memoryHubSearch({
        corpusId: "a",
        query: "worker",
    });
    assert.deepEqual(reads, [["a", "shared"]]);
    assert.equal(result.insights.provider, "canonical");
    assert.equal(result.insights.corpusId, "a");
    assert.equal(result.insights.status, "available");
    assert.deepEqual(result.insights.topTopics, ["Operations"]);
    assert.deepEqual(result.insights.relatedEntities, [
        { name: "Worker", type: "service" },
    ]);
    assert.equal(
        result.matches.find((match) => match.kind === "source").eventTime,
        time,
    );
    assert.match(result.insights.message, /Not corpus-wide statistics/);
});

test("historical or unavailable source knowledge is explicit and never substitutes Browser memory insights", async () => {
    const { service, query } = fixture();
    let reads = 0;
    service.getSourceKnowledge = async () => {
        reads++;
        throw new Error("Knowledge provider offline");
    };
    const stale = await query.memoryHubSearch({
        corpusId: "a",
        query: "worker",
    });
    assert.equal(stale.insights.status, "unavailable");
    assert.match(stale.insights.message, /not substituted/);
    assert.equal(reads, 0);
    service.getSource = async (corpusId, sourceId) => ({
        corpusId,
        sourceId,
        activeRevisionId: "r1",
    });
    const failed = await query.memoryHubSearch({
        corpusId: "a",
        query: "worker",
    });
    assert.equal(failed.insights.status, "unavailable");
    assert.match(failed.insights.message, /Knowledge provider offline/);
    assert.deepEqual(failed.insights.topTopics, []);
    assert.equal(failed.insights.provider, "canonical");
    assert.equal(failed.matches.length > 0, true);
});

test("mixed search preserves corpus/version/turn identity and synthesizes once over merged evidence", async () => {
    const { query, calls } = fixture();
    const result = await query.memoryHubSearch({
        query: "worker",
        generateAnswer: true,
    });
    assert.equal(result.matches.length, 5);
    assert.equal(result.matches.filter((m) => m.kind === "source").length, 2);
    assert.equal(result.ranking, "reciprocal-rank-fusion");
    assert.equal(result.errors.length, 0);
    assert.ok(
        result.matches.some(
            (m) =>
                m.kind === "conversation" &&
                m.turnId === "turn-7" &&
                m.authoritative,
        ),
    );
    assert.ok(
        result.matches.some(
            (m) => m.kind === "procedure" && m.procedureVersion === 3,
        ),
    );
    assert.ok(result.matches.some((m) => m.revisionId === "r1"));
    assert.ok(
        result.answer.citationIds.every((id) =>
            result.matches.some((m) => m.id === id),
        ),
    );
    assert.equal(
        calls.find(([kind]) => kind === "events")[1].producerIds[0],
        conversationProducerId,
    );
});

test("rank fusion does not compare unrelated raw scores or double-count duplicate hits", () => {
    const item = (id, rank, score) => ({ id, rank, score });
    assert.deepEqual(
        fuseEvidence(
            [
                [item("a", 1, 0.01), item("a", 2, 1e9), item("z", 2, 1e8)],
                [item("b", 1, 1)],
            ],
            10,
        ).map((m) => m.id),
        ["a", "b", "z"],
    );
    assert.throws(() => fuseEvidence([[item("bad", 1, NaN)]], 1), /non-finite/);
});

test("current conversation comes from the host; missing identity does not broaden scope", async () => {
    const { service, calls, synthesize } = fixture();
    const scoped = createMemoryHubQueryFunctions(
        () => service,
        () => undefined,
        synthesize,
    );
    const unavailable = await scoped.memoryHubSearch({
        query: "worker",
        conversationScope: "current",
    });
    assert.ok(
        unavailable.errors.some((error) => error.operation === "conversations"),
    );
    assert.equal(calls.filter(([kind]) => kind === "events").length, 0);
    const available = createMemoryHubQueryFunctions(
        () => service,
        () => "owner",
        synthesize,
    );
    await available.memoryHubSearch({
        query: "worker",
        conversationScope: "current",
    });
    assert.deepEqual(
        calls.find(([kind]) => kind === "events")[1].conversationIds,
        ["owner"],
    );
});

test("partial retrieval and answer failures retain supported evidence with explicit errors", async () => {
    const { service } = fixture();
    service.search = async () => {
        throw new Error("Index unavailable");
    };
    const query = createMemoryHubQueryFunctions(
        () => service,
        () => "owner",
        async () => {
            throw new Error("Model unavailable");
        },
    );
    const result = await query.memoryHubSearch({
        query: "worker",
        generateAnswer: true,
    });
    assert.ok(result.matches.length > 0);
    assert.equal(
        result.errors.filter((error) => error.operation === "search").length,
        2,
    );
    assert.ok(result.errors.some((error) => error.operation === "answer"));
    assert.equal(result.answer, undefined);
});

test("unknown corpora, empty questions and reversed dates are rejected", async () => {
    const { query } = fixture();
    await assert.rejects(
        query.memoryHubSearch({ query: "worker", corpusId: "foreign" }),
        /not found/,
    );
    await assert.rejects(query.memoryHubSearch({ query: " " }), /empty/);
    await assert.rejects(
        query.memoryHubSearch({
            query: "worker",
            dateFrom: time,
            dateTo: "2025-01-01T00:00:00Z",
        }),
        /reversed/,
    );
    for (const dateFrom of ["2026-10-02", "2026-02-30T00:00:00Z"])
        await assert.rejects(
            query.memoryHubSearch({ query: "worker", dateFrom }),
            /Invalid Memory search date/,
        );
});

test("a corrupt corpus score reports partial failure without hiding other evidence", async () => {
    const { query, service } = fixture();
    const search = service.search;
    service.search = async (request) => {
        const result = await search(request);
        if (request.corpusId === "a") result.matches[0].score = NaN;
        return result;
    };
    const result = await query.memoryHubSearch({ query: "worker" });
    assert.ok(
        result.errors.some(
            (error) =>
                error.corpusId === "a" && /non-finite/.test(error.message),
        ),
    );
    assert.ok(
        result.matches.some(
            (match) => match.kind === "source" && match.corpusId === "b",
        ),
    );
});

test("procedure filtering stops starting reads when its whole-operation deadline expires", async (t) => {
    let now = 0;
    t.mock.method(Date, "now", () => now);
    const { query, service } = fixture();
    service.searchProcedures = async () => [
        {
            procedure: { procedureId: "guide", title: "Guide", state: "saved" },
            version: {
                version: 3,
                createdAt: time,
                markdown: "Check first.",
                document: {
                    citations: [
                        { sourceId: "first", revisionId: "r1" },
                        { sourceId: "second", revisionId: "r1" },
                    ],
                },
            },
            score: 1,
        },
    ];
    let reads = 0;
    service.getSource = async () => {
        reads++;
        now = 31_000;
        return { sourceType: "markdown", tags: [] };
    };
    const result = await query.memoryHubSearch({
        query: "worker",
        corpusId: "a",
        tags: ["ops"],
    });
    assert.equal(reads, 1);
    assert.ok(
        result.errors.some(
            (error) =>
                error.operation === "procedures" &&
                /deadline/.test(error.message),
        ),
    );
});

test("document predicates are forwarded and conversation/procedure predicates precede final ranking", async () => {
    const { query, calls } = fixture();
    const request = {
        query: "worker",
        sourceTypes: ["markdown"],
        tags: ["ops"],
        dateFrom: time,
        dateTo: time,
    };
    const result = await query.memoryHubSearch(request);
    assert.equal(
        result.matches.some((m) => m.kind === "conversation"),
        false,
    );
    const passed = calls.find(([kind]) => kind === "search")[1];
    assert.deepEqual(passed.tags, ["ops"]);
    assert.equal(passed.dateFrom, time);
    assert.ok(result.matches.some((m) => m.kind === "procedure"));
});

test("evidence opens exact retained source revision and exact saved procedure version", async () => {
    const { query, calls } = fixture();
    const source = await query.memoryHubEvidence({
        kind: "source",
        corpusId: "a",
        objectId: "shared",
        revisionId: "r1",
    });
    assert.equal(source.provenance.revisionId, "r1");
    assert.equal(
        calls.find(([kind]) => kind === "content")[1].revisionId,
        "r1",
    );
    const procedure = await query.memoryHubEvidence({
        kind: "procedure",
        corpusId: "a",
        objectId: "guide",
        procedureVersion: 2,
    });
    assert.equal(procedure.provenance.procedureVersion, 2);
    assert.deepEqual(calls.find(([kind]) => kind === "procedure").slice(1), [
        "a",
        "guide",
        2,
    ]);
});

test("conversation citations resolve actual event/turn structure and reject foreign producers", async () => {
    const { query, service } = fixture();
    const content = await query.memoryHubEvidence({
        kind: "conversation",
        corpusId: "c",
        objectId: "event-1",
    });
    assert.equal(content.provenance.conversationId, "conversation-1");
    assert.equal(content.provenance.turnId, "turn-7");
    service.getEvent = async () => ({
        ...event,
        producer: { producerId: "other" },
    });
    await assert.rejects(
        query.memoryHubEvidence({
            kind: "conversation",
            corpusId: "c",
            objectId: "event-1",
        }),
        /no longer available/,
    );
});

test("unsupported answer citations are rejected without losing retrieval", async () => {
    const { service } = fixture();
    const query = createMemoryHubQueryFunctions(
        () => service,
        () => "owner",
        async () => ({
            text: "Unsupported",
            mode: "synthesized",
            citationIds: ["invented"],
            followUps: [],
        }),
    );
    const result = await query.memoryHubSearch({
        query: "worker",
        generateAnswer: true,
    });
    assert.equal(result.answer, undefined);
    assert.ok(result.matches.length);
    assert.ok(
        result.errors.some((error) =>
            /unsupported citations/.test(error.message),
        ),
    );
});

test("claim-level citation validation permits an honest no-answer and rejects unsupported claims", () => {
    const evidence = [{ id: "known" }];
    assert.equal(
        citedAnswer(
            {
                status: "answered",
                claims: [{ text: "Supported", evidenceIds: ["known"] }],
                followUps: [],
            },
            evidence,
        ).text,
        "Supported [1]",
    );
    assert.throws(
        () =>
            citedAnswer(
                {
                    status: "answered",
                    claims: [{ text: "Unsupported", evidenceIds: ["other"] }],
                    followUps: [],
                },
                evidence,
            ),
        /unsupported/,
    );
    assert.equal(
        citedAnswer(
            {
                status: "noAnswer",
                claims: [],
                whyNoAnswer: "Insufficient evidence",
                followUps: [],
            },
            evidence,
        ).status,
        "noAnswer",
    );
});

test("neutral graph counts are corpus-qualified, progressive and explicit about unsupported event graphs", async () => {
    const { service } = fixture();
    const explore = createMemoryHubExploreFunctions(() => service);
    const first = await explore.memoryHubExplore({ maxNodes: 1 });
    assert.equal(first.counts.sources, 2);
    assert.equal(first.counts.entities, 2);
    assert.equal(first.entities.length, 1);
    assert.equal(first.omittedEntities, 1);
    assert.ok(
        first.errors.some(
            (error) => error.corpusId === "c" && error.operation === "graph",
        ),
    );
    const all = await explore.memoryHubExplore({ maxNodes: 10 });
    assert.equal(new Set(all.entities.map((e) => e.id)).size, 2);
    assert.deepEqual(
        all.entities
            .flatMap((e) => e.sources)
            .map((s) => s.corpusId)
            .sort(),
        ["a", "b"],
    );
});

test("knowledge paging and filtering cover thousands of items independently of the Overview preview", async () => {
    const { service } = fixture();
    const entities = Array.from({ length: 2500 }, (_, index) => ({
        name: `Worker ${String(index).padStart(4, "0")}`,
        types: ["service"],
        mentionCount: 2500 - index,
        sourceIds: ["shared"],
    }));
    const graph = {
        entities,
        topics: entities.map((item) => ({ ...item })),
        relationships: entities.slice(1).map((item) => ({
            fromEntity: "Worker 0000",
            toEntity: item.name,
            relationshipType: "reads",
            count: item.mentionCount,
            sourceIds: ["shared"],
        })),
    };
    service.getKnowledgeGraph = async () => graph;
    const hub = createMemoryHubKnowledgeFunctions(() => service);
    for (const kind of ["entities", "topics", "relationships"]) {
        const first = await hub.memoryHubKnowledge({
            kind,
            corpusId: "a",
            pageSize: 24,
        });
        const second = await hub.memoryHubKnowledge({
            kind,
            corpusId: "a",
            pageSize: 24,
            offset: 24,
        });
        assert.equal(first.items.length, 24);
        assert.equal(second.items.length, 24);
        assert.equal(first.total, kind === "relationships" ? 2499 : 2500);
        assert.equal(
            new Set([...first.items, ...second.items].map((item) => item.id))
                .size,
            48,
        );
        const filtered = await hub.memoryHubKnowledge({
            kind,
            corpusId: "a",
            query: "2499",
        });
        assert.equal(filtered.total, 1);
        assert.ok(filtered.items[0].title.includes("2499"));
        assert.deepEqual(filtered.items[0].sources, [
            { corpusId: "a", sourceId: "shared" },
        ]);
    }
    const preview = await createMemoryHubExploreFunctions(
        () => service,
    ).memoryHubExplore({ corpusId: "a", maxNodes: 6 });
    assert.equal(preview.counts.entities, 2500);
    assert.equal(preview.entities.length, 6);
    assert.equal(preview.topics.length, 6);
    assert.equal(preview.relationships.length, 6);
    assert.equal(preview.contributingSources.length, 1);
    assert.equal(preview.relationships[0].fromName, "Worker 0000");
});

test("knowledge sources filter full contributing metadata, browser scope never follows the selected corpus, and failures stay partial", async () => {
    const { service } = fixture();
    service.listCorpora = async () => [
        { corpusId: "a", name: "Documents" },
        { corpusId: "b", name: browserCorpusName },
    ];
    service.listSources = async (corpusId) => [
        {
            corpusId,
            sourceId: "shared",
            title: "Late source",
            sourceType: "web",
        },
    ];
    const hub = createMemoryHubKnowledgeFunctions(() => service);
    const sources = await hub.memoryHubKnowledge({
        kind: "sources",
        corpusId: "a",
        query: "Late",
    });
    assert.equal(sources.total, 1);
    assert.equal(sources.items[0].title, "Late source");
    const browser = await hub.memoryHubKnowledge({
        kind: "entities",
        browserOnly: true,
    });
    assert.ok(
        browser.items.every((item) =>
            item.sources.every((source) => source.corpusId === "b"),
        ),
    );
    await assert.rejects(
        hub.memoryHubKnowledge({
            kind: "entities",
            browserOnly: true,
            corpusId: "a",
        }),
        /selected corpus/,
    );
    for (const request of [
        { kind: "bad" },
        { kind: "topics", offset: -1 },
        { kind: "topics", pageSize: 101 },
        { kind: "topics", query: "x".repeat(513) },
        { kind: "topics", sort: "bad" },
    ])
        await assert.rejects(hub.memoryHubKnowledge(request));
    service.getKnowledgeGraph = async (corpusId) => {
        if (corpusId === "a") throw new Error("offline");
        return { entities: [], topics: [], relationships: [] };
    };
    const partial = await hub.memoryHubKnowledge({ kind: "topics" });
    assert.equal(partial.errors.length, 1);
    assert.equal(partial.errors[0].corpusId, "a");
    service.listCorpora = async () => [];
    await assert.rejects(
        hub.memoryHubKnowledge({ kind: "entities", browserOnly: true }),
        /unavailable/,
    );
});

test("Changes pages cross corpus boundaries without loss and tokens bind to scope", async () => {
    const { service } = fixture();
    const changes = createMemoryHubExploreFunctions(() => service);
    let continuationToken;
    const ids = [];
    do {
        const page = await changes.memoryHubChanges({
            pageSize: 2,
            ...(continuationToken ? { continuationToken } : {}),
        });
        assert.equal(page.total, 6);
        ids.push(...page.items.map((item) => item.changeId));
        continuationToken = page.nextContinuationToken;
    } while (continuationToken);
    assert.deepEqual(ids, ["a-0", "a-1", "a-2", "b-0", "b-1", "b-2"]);
    const first = await changes.memoryHubChanges({ pageSize: 2 });
    await assert.rejects(
        changes.memoryHubChanges({
            corpusId: "b",
            continuationToken: first.nextContinuationToken,
        }),
        /scope changed/,
    );
    service.listChanges = undefined;
    await assert.rejects(changes.memoryHubChanges({}), /unavailable/);
});

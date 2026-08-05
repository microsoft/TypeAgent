// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DomainError,
    HmacPacketContinuationCodec,
    SequenceIdGenerator,
    WorkingMemoryPacketAssembler,
    hashQuery,
    normalizeQuery,
    renderPacketRecord,
    type EvaluatedQueryRecord,
    type QueryEvaluatorResult,
    type QueryIrV1,
    type TokenEstimator,
} from "../../src/index.js";

const ids = new SequenceIdGenerator(Date.UTC(2026, 7, 9));
const scopeId = ids.generate("Scope");
const codec = new HmacPacketContinuationCodec("m7-test-secret".repeat(4));

describe("WorkingMemoryPacketAssembler", () => {
    test("keeps soft-AND hit count ahead of lexical quality", () => {
        const query = createQuery({ tokenBudget: 50 });
        const oneHit = createRecord("one", 1, 100);
        const twoHits = createRecord("two", 2, 0.1);
        const packet = createAssembler().assemble({
            query,
            evaluation: createEvaluation(query, [oneHit, twoHits]),
        });

        expect(
            packet.references.map((reference) => reference.entityId),
        ).toEqual(["two"]);
        expect(packet.estimatedTokens).toBeLessThanOrEqual(
            packet.targetTokenBudget,
        );
        expect(packet.truncated).toBe(true);
    });

    test("deduplicates authoritative records and produces byte-stable output", () => {
        const query = createQuery({ tokenBudget: 200 });
        const current = {
            ...createRecord("duplicate", 1, 1),
            revision: 2,
            title: "Current revision",
        };
        const stale = {
            ...createRecord("duplicate", 1, 1),
            title: "Stale revision",
        };
        const input = {
            query,
            evaluation: createEvaluation(query, [current, stale]),
        };

        const first = createAssembler().assemble(input);
        const second = createAssembler().assemble(input);

        expect(first).toEqual(second);
        expect(first.references).toHaveLength(1);
        expect(first.references[0]!.revision).toBe(2);
        expect(first.text).toContain("Current revision");
        expect(first.references[0]).not.toHaveProperty("content");
    });

    test("continues without duplicate records or a repeated topic brief", () => {
        const query = createQuery({
            tokenBudget: 55,
            topic: {
                rootPath: "/project/memory",
                traversal: "descendants",
            },
        });
        const evaluation = createEvaluation(query, [
            createRecord("one", 1, 1),
            createRecord("two", 1, 1),
            createRecord("three", 1, 1),
        ]);
        const assembler = createAssembler();

        const first = assembler.assemble({ query, evaluation });
        const second = assembler.assemble({
            query,
            evaluation,
            continuation: first.continuation!,
        });
        const repeatedSecond = assembler.assemble({
            query,
            evaluation,
            continuation: first.continuation!,
            repeatTopicBrief: true,
        });
        const third = assembler.assemble({
            query,
            evaluation,
            continuation: second.continuation!,
        });

        const entityIds = [first, second, third].flatMap((packet) =>
            packet.references.map((reference) => reference.entityId),
        );
        expect(new Set(entityIds).size).toBe(3);
        expect(first.text).toContain("Context: /project/memory");
        expect(second.text).not.toContain("Context:");
        expect(repeatedSecond.text).toContain("Context: /project/memory");
        expect(third.continuation).toBeUndefined();
    });

    test("rejects tampered and mismatched continuation cursors", () => {
        const query = createQuery({ tokenBudget: 50 });
        const evaluation = createEvaluation(query, [
            createRecord("one", 1, 1),
            createRecord("two", 1, 1),
        ]);
        const assembler = createAssembler();
        const first = assembler.assemble({ query, evaluation });
        const cursor = first.continuation!;

        expect(() =>
            assembler.assemble({
                query,
                evaluation,
                continuation: `${cursor[0] === "A" ? "B" : "A"}${cursor.slice(1)}`,
            }),
        ).toThrow(DomainError);
        expect(() =>
            assembler.assemble({
                query: createQuery({ tokenBudget: 51 }),
                evaluation,
                continuation: cursor,
            }),
        ).toThrow(DomainError);
    });

    test("renders a summary followed by every record after its watermark", () => {
        const query = createQuery({ tokenBudget: 200 });
        const records = [
            createRecord("old", 1, 1, 1),
            createRecord("tail-two", 1, 1, 2),
            createRecord("tail-three", 1, 1, 3),
        ];
        const packet = createAssembler().assemble({
            query,
            evaluation: createEvaluation(query, records),
            summaries: [
                {
                    summaryId: "actions-summary",
                    topicId: "topic-one",
                    facetKind: "action",
                    summary: "Earlier actions completed.",
                    sourceWatermark: 1,
                    records,
                },
            ],
        });

        expect(
            packet.references.map((reference) => reference.entityId),
        ).toEqual(["actions-summary", "tail-two", "tail-three"]);
        expect(packet.text).toContain("summary through sequence 1");
        expect(packet.text).not.toContain("Record old");
        expect(packet.truncated).toBe(false);
    });

    test("reports evaluator result limits separately from packet truncation", () => {
        const query = createQuery({ tokenBudget: 200 });
        const evaluation = {
            ...createEvaluation(query, [createRecord("one", 1, 1)]),
            truncated: true,
        };

        const packet = createAssembler().assemble({ query, evaluation });

        expect(packet.truncated).toBe(false);
        expect(packet.resultLimitReached).toBe(true);
        expect(packet.continuation).toBeUndefined();
    });

    test("keeps the fallback estimate within the conservative target", () => {
        const query = createQuery({ tokenBudget: 120 });
        const assembler = new WorkingMemoryPacketAssembler({
            continuationCodec: codec,
        });

        const packet = assembler.assemble({
            query,
            evaluation: createEvaluation(query, [
                createRecord("fallback", 1, 1),
            ]),
        });

        expect(packet.estimatedTokens).toBeLessThanOrEqual(
            packet.targetTokenBudget,
        );
    });

    test("makes progress when records are too large for the budget", () => {
        const query = createQuery({ tokenBudget: 20 });
        const evaluation = createEvaluation(query, [
            createRecord("one", 1, 1),
            createRecord("two", 1, 1),
        ]);
        const assembler = createAssembler();

        const first = assembler.assemble({ query, evaluation });
        const second = assembler.assemble({
            query,
            evaluation,
            continuation: first.continuation!,
        });

        expect(first.omittedOversizedEntityIds).toHaveLength(1);
        expect(second.omittedOversizedEntityIds).toHaveLength(1);
        expect(second.truncated).toBe(false);
        expect(second.continuation).toBeUndefined();
    });

    test("does not emit tail records when their summary is oversized", () => {
        const query = createQuery({ tokenBudget: 20 });
        const tail = createRecord("tail", 1, 1, 2);

        const packet = createAssembler().assemble({
            query,
            evaluation: createEvaluation(query, [tail]),
            summaries: [
                {
                    summaryId: "oversized-summary",
                    topicId: "topic-one",
                    facetKind: "action",
                    summary: "Summary",
                    sourceWatermark: 1,
                    records: [tail],
                },
            ],
        });

        expect(packet.references).toHaveLength(0);
        expect(packet.omittedOversizedEntityIds).toEqual([
            "oversized-summary",
            "tail",
        ]);
        expect(packet.truncated).toBe(false);
    });
});

describe("packet rendering and cursors", () => {
    test("renders snippet, card, and full detail without duplicating payloads", () => {
        const record = createRecord("render", 2, 0.8);

        expect(renderPacketRecord(record, "snippets", "[m1]")).toContain(
            "[m1] Turn",
        );
        expect(renderPacketRecord(record, "cards", "[m1]")).toContain(
            "state=active",
        );
        expect(renderPacketRecord(record, "full", "[m1]")).toContain(
            "evidence=",
        );
    });

    test("round trips deterministic cursor state", () => {
        const state = {
            queryHash: "a".repeat(64),
            indexVersion: 7,
            consumedIds: ["record:two", "record:one", "record:one"],
            topicBriefIncluded: true,
        };

        const cursor = codec.encode(state);

        expect(codec.encode(state)).toBe(cursor);
        expect(codec.decode(cursor)).toEqual({
            ...state,
            consumedIds: ["record:one", "record:two"],
        });
    });

    test("rejects continuation secrets shorter than 32 bytes", () => {
        expect(() => new HmacPacketContinuationCodec("too-short")).toThrow(
            DomainError,
        );
    });
});

class SectionTokenEstimator implements TokenEstimator {
    public estimate(text: string): number {
        const citations = text.match(/\[m\d+\]/g)?.length ?? 0;
        return citations * 40 + (text.includes("Context:") ? 5 : 0);
    }
}

function createAssembler(): WorkingMemoryPacketAssembler {
    return new WorkingMemoryPacketAssembler({
        continuationCodec: codec,
        tokenEstimator: new SectionTokenEstimator(),
    });
}

function createQuery(overrides: Partial<QueryIrV1> = {}): QueryIrV1 {
    return normalizeQuery({
        version: 1,
        scopeId,
        targetKinds: ["turn"],
        expression: {
            type: "match",
            clauseId: "memory-clause",
            text: "memory",
        },
        detail: "snippets",
        tokenBudget: 1_024,
        maxResults: 100,
        timezone: {
            timeZone: "UTC",
            utcOffsetMinutes: 0,
            resolvedAt: "2026-08-09T12:00:00.000Z",
        },
        ...overrides,
    });
}

function createEvaluation(
    query: QueryIrV1,
    records: readonly EvaluatedQueryRecord[],
): QueryEvaluatorResult {
    return {
        queryHash: hashQuery(query),
        indexVersion: 3,
        records,
        candidateCount: records.length,
        truncated: false,
    };
}

function createRecord(
    entityId: string,
    hitCount: number,
    quality: number,
    sequence = 1,
): EvaluatedQueryRecord {
    return {
        entityId,
        entityKind: "turn",
        revision: 1,
        title: `Record ${entityId}`,
        content: `Content for ${entityId}`,
        occurredAt: "2026-08-09T10:00:00.000Z",
        recordedAt: "2026-08-09T10:01:00.000Z",
        hitCount,
        quality,
        fields: {
            entityId,
            state: "active",
            sequence,
        },
        evidence: [
            {
                clauseId: "memory-clause",
                channels: ["lexical"],
                quality,
                references: [`turn:${entityId}:1`],
            },
        ],
        eventReferences: [],
    };
}

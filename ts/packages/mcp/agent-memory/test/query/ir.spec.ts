// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DomainError,
    SequenceIdGenerator,
    evaluateQueryExpression,
    hashQuery,
    normalizeQuery,
    rankQueryCandidates,
    serializeQuery,
    type QueryCandidate,
    type QueryExpression,
    type QueryIrV1,
} from "../../src/index.js";

const ids = new SequenceIdGenerator(Date.UTC(2026, 7, 7));
const scopeId = ids.generate("Scope");
const resolvedAt = "2026-08-07T12:00:00.000Z";

describe("query IR expression semantics", () => {
    test("evaluates nested AND, OR, soft AND, and NOT truth tables", () => {
        const expression: QueryExpression = {
            type: "and",
            children: [
                match("quark"),
                {
                    type: "or",
                    children: [match("eigenvalue"), match("spectrum")],
                },
                { type: "not", child: match("archived") },
            ],
        };

        expect(evaluate(expression, ["quark", "eigenvalue"]).matches).toBe(
            true,
        );
        expect(evaluate(expression, ["quark", "spectrum"]).matches).toBe(true);
        expect(evaluate(expression, ["quark"]).matches).toBe(false);
        expect(
            evaluate(expression, ["quark", "eigenvalue", "archived"]).matches,
        ).toBe(false);
        expect(
            normalizeQuery(
                query({
                    expression: {
                        type: "not",
                        child: { type: "not", child: match("quark") },
                    },
                }),
            ).expression,
        ).toMatchObject({ type: "not" });

        const soft: QueryExpression = {
            type: "softAnd",
            minimumShouldMatch: 2,
            children: [match("quark"), match("eigenvalue"), match("field")],
        };
        expect(evaluate(soft, ["quark"]).matches).toBe(false);
        expect(evaluate(soft, ["quark", "field"])).toMatchObject({
            matches: true,
            hitCount: 2,
        });
    });

    test("ranks distinct soft-AND hits before lexical quality", () => {
        const expression: QueryExpression = {
            type: "softAnd",
            children: [match("quark"), match("eigenvalue"), match("field")],
        };
        const ranked = rankQueryCandidates(expression, [
            candidate("one", { quark: 100 }),
            candidate("two", { quark: 100, eigenvalue: 100 }),
            candidate("three", { quark: 0.1, eigenvalue: 0.1, field: 0.1 }),
        ]);

        expect(
            ranked.map(({ candidateId, hitCount }) => [candidateId, hitCount]),
        ).toEqual([
            ["three", 3],
            ["two", 2],
            ["one", 1],
        ]);
    });

    test("counts grouped alternatives once and duplicate evidence once", () => {
        const expression: QueryExpression = {
            type: "softAnd",
            children: [
                match("quark"),
                {
                    type: "or",
                    children: [match("eigenvalue"), match("spectrum")],
                },
                match("field"),
            ],
        };
        const grouped = evaluateQueryExpression(
            expression,
            candidate("grouped", {
                quark: [0.2, 0.9],
                eigenvalue: 0.8,
                spectrum: 0.7,
                field: 0.6,
            }),
        );

        expect(grouped).toMatchObject({
            matches: true,
            hitCount: 3,
        });
        expect(grouped.quality).toBeCloseTo(2.3);
        expect(
            evaluateQueryExpression(
                match("quark"),
                candidate("alias", {
                    quark: [0.2, 0.9, 0.5],
                }),
            ),
        ).toMatchObject({ hitCount: 1, quality: 0.9 });
    });

    test("filters affect membership without increasing hit count", () => {
        const expression: QueryExpression = {
            type: "softAnd",
            children: [
                match("quark"),
                {
                    type: "filter",
                    field: "state",
                    operator: "equals",
                    value: "active",
                },
            ],
        };

        expect(
            evaluateQueryExpression(expression, {
                ...candidate("active", { quark: 1 }),
                fields: { state: "active" },
            }),
        ).toMatchObject({ matches: true, hitCount: 1 });
        expect(
            evaluateQueryExpression(expression, {
                ...candidate("archived", { quark: 1 }),
                fields: { state: "archived" },
            }),
        ).toMatchObject({ matches: false, hitCount: 1 });
    });
});

describe("query IR normalization", () => {
    test("normalizes equivalent IR to the same serialization and hash", () => {
        const left = query({
            targetKinds: ["turn", "action"],
            include: ["terms", "topics"],
            expression: {
                type: "and",
                children: [
                    match("quark", "  QUARK  "),
                    match("field", "field"),
                ],
            },
        });
        const right = query({
            targetKinds: ["action", "turn"],
            include: ["topics", "terms"],
            expression: {
                type: "and",
                children: [match("field", "field"), match("quark", "quark")],
            },
        });

        expect(serializeQuery(left)).toBe(serializeQuery(right));
        expect(hashQuery(left)).toBe(hashQuery(right));
        expect(normalizeQuery(left).orderBy).toEqual([
            { field: "entityId", direction: "asc" },
        ]);

        const nested = query({
            expression: {
                type: "and",
                children: [
                    match("quark"),
                    {
                        type: "and",
                        children: [match("field"), match("eigenvalue")],
                    },
                ],
            },
        });
        const flat = query({
            expression: {
                type: "and",
                children: [match("eigenvalue"), match("quark"), match("field")],
            },
        });
        expect(hashQuery(nested)).toBe(hashQuery(flat));
    });

    test("normalizes temporal selectors and binds continuation to the query", () => {
        const base = query({
            temporal: {
                type: "changedDuring",
                start: "2026-08-06T00:00:00-07:00",
                end: "2026-08-07T00:00:00-07:00",
                projection: "endState",
            },
        });
        const queryHash = hashQuery(base);
        const continued: QueryIrV1 = {
            ...base,
            continuation: {
                queryHash,
                indexVersion: 4,
                lastEntityId: "turn-9",
                sortValues: [3, 0.8],
            },
        };

        expect(hashQuery(continued)).toBe(queryHash);
        expect(normalizeQuery(continued).continuation).toMatchObject({
            queryHash,
            indexVersion: 4,
        });
        expectDomainError(
            () =>
                normalizeQuery({
                    ...continued,
                    continuation: {
                        ...continued.continuation!,
                        queryHash: "0".repeat(64),
                    },
                }),
            "INVALID_ARGUMENT",
        );
    });

    test("rejects invalid and unbounded queries before execution", () => {
        expectDomainError(
            () => normalizeQuery(query({ tokenBudget: 0 })),
            "INVALID_ARGUMENT",
        );

        expect(() =>
            normalizeQuery(
                query({
                    topic: {
                        rootPath: "/project/memory",
                        traversal: "descendants",
                    },
                    expression: {
                        type: "filter",
                        field: "state",
                        operator: "equals",
                        value: "active",
                    },
                }),
            ),
        ).not.toThrow();
        expectDomainError(
            () =>
                normalizeQuery(
                    query({
                        expression: {
                            type: "filter",
                            field: "state",
                            operator: "equals",
                            value: "active",
                        },
                    }),
                ),
            "INVALID_ARGUMENT",
        );
        expectDomainError(
            () =>
                normalizeQuery(
                    query({
                        expression: {
                            type: "softAnd",
                            children: [
                                match("quark", "quark"),
                                match("quark", "quarks"),
                            ],
                        },
                    }),
                ),
            "INVALID_ARGUMENT",
        );
        expectDomainError(
            () =>
                normalizeQuery(
                    query({
                        temporal: {
                            type: "during",
                            start: "2026-08-08T00:00:00Z",
                            end: "2026-08-07T00:00:00Z",
                        },
                    }),
                ),
            "INVALID_ARGUMENT",
        );
    });
});

function query(overrides: Partial<QueryIrV1> = {}): QueryIrV1 {
    return {
        version: 1,
        scopeId,
        targetKinds: ["turn"],
        expression: match("memory"),
        detail: "cards",
        tokenBudget: 1_024,
        maxResults: 100,
        timezone: {
            timeZone: "America/Los_Angeles",
            utcOffsetMinutes: -420,
            resolvedAt,
        },
        ...overrides,
    };
}

function match(clauseId: string, text = clauseId): QueryExpression {
    return { type: "match", clauseId, text };
}

function candidate(
    candidateId: string,
    clauseEvidence: QueryCandidate["clauseEvidence"],
): QueryCandidate {
    return { candidateId, clauseEvidence, fields: {} };
}

function evaluate(expression: QueryExpression, clauses: readonly string[]) {
    return evaluateQueryExpression(
        expression,
        candidate(
            "candidate",
            Object.fromEntries(clauses.map((clause) => [clause, 1])),
        ),
    );
}

function expectDomainError(
    operation: () => unknown,
    code: DomainError["code"],
): void {
    try {
        operation();
        throw new Error("Expected operation to throw");
    } catch (error) {
        expect(error).toBeInstanceOf(DomainError);
        expect((error as DomainError).code).toBe(code);
    }
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DomainError,
    SequenceIdGenerator,
    hashQuery,
    normalizeQuery,
    parseQueryLanguage,
    renderQueryLanguage,
    serializeQuery,
    type QueryLanguageOptions,
} from "../../src/index.js";

const ids = new SequenceIdGenerator(Date.UTC(2026, 7, 8));
const scopeId = ids.generate("Scope");
const artifactId = ids.generate("Artifact");
const turnId = ids.generate("Turn");
const options: QueryLanguageOptions = {
    scopeId,
    timeZone: "America/Los_Angeles",
    now: new Date("2026-08-08T19:00:00.000Z"),
};

describe("query path language", () => {
    test.each([
        ["/topics/project/memory", "topic", "exact"],
        ["/topics/project/memory/*/turns", "turn", "children"],
        ["/topics/project/memory/**/actions", "action", "descendants"],
        ["/topics/project/memory/artifacts", "artifact", "exact"],
        ["/topics/project/memory/goals", "goal", "exact"],
        ["/topics/project/memory/outputs", "output", "exact"],
        ["/topics/project/memory/design-notes", "designNote", "exact"],
    ])("parses topic route %s", (input, kind, traversal) => {
        const query = parseQueryLanguage(input, options);

        expect(query.targetKinds).toEqual([kind]);
        expect(query.topic).toMatchObject({
            rootPath: "/project/memory",
            traversal,
        });
    });

    test.each([
        [
            '/terms/"quantum field"/topics',
            "topic",
            { type: "term", term: "quantum field" },
        ],
        [
            "/terms/eigenvalue/turns",
            "turn",
            { type: "term", term: "eigenvalue" },
        ],
        [
            `/artifacts/${artifactId}/turns`,
            "turn",
            { type: "artifact", artifactId },
        ],
        [`/turns/${turnId}`, "turn", { type: "turn", turnId }],
    ])("parses structural route %s", (input, kind, source) => {
        const query = parseQueryLanguage(input, options);

        expect(query.targetKinds).toEqual([kind]);
        expect(query.source).toEqual(source);
    });

    test("parses properties, escaped segments, and controls", () => {
        const query = parseQueryLanguage(
            '/topics/Agent%20Memory/**/properties/"review state" where "quark field" + (eigenvalue | spectrum) filter state=active during yesterday detail snippets order hitCount:desc,quality:desc limit 25 tokens 2048',
            options,
        );

        expect(query).toMatchObject({
            targetKinds: ["property"],
            topic: {
                rootPath: "/agent-memory",
                traversal: "descendants",
            },
            detail: "snippets",
            maxResults: 25,
            tokenBudget: 2_048,
            temporal: {
                type: "during",
                start: "2026-08-07T07:00:00.000Z",
                end: "2026-08-08T07:00:00.000Z",
            },
        });
        expect(serializeQuery(query)).toContain("review state");
    });

    test("keeps escaped reserved suffixes as literal topic names", () => {
        const query = parseQueryLanguage('/topics/project/"turns"', options);
        const topLevel = parseQueryLanguage("/topics/turns", options);

        expect(query).toMatchObject({
            targetKinds: ["topic"],
            topic: { rootPath: "/project/turns", traversal: "exact" },
        });
        expect(topLevel).toMatchObject({
            targetKinds: ["topic"],
            topic: { rootPath: "/turns", traversal: "exact" },
        });
        expect(
            serializeQuery(
                parseQueryLanguage(renderQueryLanguage(query), options),
            ),
        ).toBe(serializeQuery(query));
    });

    test("uses documented !, &, |, + precedence", () => {
        const query = parseQueryLanguage(
            "/topics/project/turns where alpha + beta | gamma & !delta",
            options,
        );

        expect(query.expression).toMatchObject({
            type: "softAnd",
            children: expect.arrayContaining([
                expect.objectContaining({ type: "match", text: "alpha" }),
                expect.objectContaining({
                    type: "or",
                    children: expect.arrayContaining([
                        expect.objectContaining({
                            type: "match",
                            text: "beta",
                        }),
                        expect.objectContaining({
                            type: "and",
                            children: expect.arrayContaining([
                                expect.objectContaining({
                                    type: "match",
                                    text: "gamma",
                                }),
                                expect.objectContaining({ type: "not" }),
                            ]),
                        }),
                    ]),
                }),
            ]),
        });
    });

    test("parse-render-parse preserves normalized IR", () => {
        const first = parseQueryLanguage(
            '/topics/project/memory/**/turns where "quark field" + (eigenvalue | spectrum) filter state=active changed yesterday endState detail full order hitCount:desc,quality:desc limit 40 tokens 4096',
            options,
        );
        const rendered = renderQueryLanguage(first);
        const second = parseQueryLanguage(rendered, options);

        expect(serializeQuery(second)).toBe(serializeQuery(first));
        expect(hashQuery(second)).toBe(hashQuery(first));
    });
});

describe("query temporal resolution", () => {
    test("resolves bounded day and week offsets", () => {
        const day = parseQueryLanguage(
            "/topics/project/turns during 3 days ago",
            options,
        );
        const week = parseQueryLanguage(
            "/topics/project/turns during 2 weeks ago",
            options,
        );

        expect(day.temporal).toMatchObject({
            start: "2026-08-05T07:00:00.000Z",
            end: "2026-08-06T07:00:00.000Z",
        });
        expect(week.temporal).toMatchObject({
            start: "2026-07-25T07:00:00.000Z",
            end: "2026-08-01T07:00:00.000Z",
        });
    });

    test.each([
        [
            "spring forward",
            "2026-03-09T12:00:00.000Z",
            "2026-03-08T08:00:00.000Z",
            "2026-03-09T07:00:00.000Z",
        ],
        [
            "fall back",
            "2026-11-02T12:00:00.000Z",
            "2026-11-01T07:00:00.000Z",
            "2026-11-02T08:00:00.000Z",
        ],
    ])(
        "resolves yesterday across the %s transition",
        (_name, now, start, end) => {
            const query = parseQueryLanguage(
                "/topics/project/turns during yesterday",
                { ...options, now: new Date(now) },
            );

            expect(query.temporal).toEqual({ type: "during", start, end });
        },
    );

    test("rendered continuation intervals do not change after midnight", () => {
        const beforeMidnight = parseQueryLanguage(
            "/topics/project/turns during yesterday",
            {
                ...options,
                now: new Date("2026-08-08T06:59:00.000Z"),
            },
        );
        const rendered = renderQueryLanguage(beforeMidnight);
        const afterMidnight = parseQueryLanguage(rendered, {
            ...options,
            now: new Date("2026-08-08T07:01:00.000Z"),
        });

        expect(afterMidnight.temporal).toEqual(beforeMidnight.temporal);
        const queryHash = hashQuery(beforeMidnight);
        expect(
            normalizeQuery({
                ...beforeMidnight,
                continuation: {
                    queryHash,
                    indexVersion: 2,
                    lastEntityId: "turn-2",
                    sortValues: [2, 0.5],
                },
            }).continuation,
        ).toMatchObject({ queryHash, indexVersion: 2 });
    });
});

describe("query language validation", () => {
    test.each([
        "/unknown/value",
        "/topics/project/*/nested/turns",
        "/terms/value/artifacts",
        "/topics/project/turns where (alpha | beta",
        "/topics/project/turns during last 999 days",
        "/topics/project/turns limit unlimited",
    ])("rejects malformed or unbounded input: %s", (input) => {
        expectDomainError(
            () => parseQueryLanguage(input, options),
            "INVALID_ARGUMENT",
        );
    });

    test("rejects excessive expression nesting with a bounded error", () => {
        const nested = `${"(".repeat(17)}term${")".repeat(17)}`;
        expectDomainError(
            () =>
                parseQueryLanguage(
                    `/topics/project/turns where ${nested}`,
                    options,
                ),
            "INVALID_ARGUMENT",
        );
    });
});

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

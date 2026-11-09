// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TimestampToTextRangeIndex } from "../src/timestampIndex.js";
import { matchesTemporalRange, parseTemporalValue } from "../src/temporal.js";
import type {
    MessageTemporalContext,
    TemporalQueryRange,
} from "../src/temporalSchema.js";
import { runWithSearchTiming } from "../src/searchTiming.js";

function context(
    messageTime: string,
    events: string[] = [],
): MessageTemporalContext {
    return {
        version: 1,
        sourceRevisionId: "synthetic",
        contextHash: "fixture",
        ownerId: "fixture",
        sourceSpan: { start: 0, end: 0 },
        inheritedDateEvidence: [],
        messageTime: parseTemporalValue(messageTime),
        eventMentions: events.map((raw) => ({
            text: "fixture",
            start: 0,
            end: 0,
            role: "eventTime",
            resolution: "resolved",
            value: parseTemporalValue(raw),
        })),
    };
}

describe("indexed temporal candidates retain authoritative exact behavior", () => {
    const contexts = [
        context("2024-02-29T23:59:59.999Z", ["2024-01-01", "2024-03-01"]),
        context("2024-03-01T01:59:59.999+02:00"),
        context("2024-02-29T23:59:59.999"),
        context("2024-02"),
        context("2024"),
        context("2024-02-29"),
        context("2025-01-01"),
        context("0000-01-01T00:00:00+14:00"),
        context("9999-12-31T23:59:59-14:00"),
    ];
    const queries: TemporalQueryRange[] = [
        {
            dimension: "message",
            domain: "instant",
            start: "2024-02-29T23:59:59.999Z",
            end: "2024-02-29T23:59:59.999Z",
        },
        {
            dimension: "message",
            domain: "calendar",
            start: "2024-01",
            end: "2024-02",
        },
        {
            dimension: "message",
            domain: "calendar",
            start: "2024",
            end: "2024",
        },
        { dimension: "message", domain: "calendar", start: "2024-02" },
        {
            dimension: "event",
            domain: "calendar",
            start: "2024-03-01",
            end: "2024-03-01",
        },
        {
            dimension: "message",
            domain: "instant",
            start: "0000-01-01T00:00:00+14:00",
        },
        {
            dimension: "message",
            domain: "instant",
            start: "9999-12-31T23:59:59-14:00",
            end: "2025-01-01T00:00:00Z",
        },
    ];
    test.each(queries)(
        "candidate/scan parity for %j after replacement and clear",
        (query) => {
            const index = new TimestampToTextRangeIndex();
            contexts.forEach((value, ordinal) =>
                index.addTemporalContext(ordinal, value),
            );
            const exact = contexts.flatMap((value, ordinal) =>
                matchesTemporalRange(value, query) ? [ordinal] : [],
            );
            expect(
                index
                    .lookupTemporalRange(query)
                    .map((range) => range.start.messageOrdinal),
            ).toEqual(exact);
            index.addTemporalContext(0, context("2030-01-01"));
            const replaced = contexts.map((value, ordinal) =>
                ordinal === 0 ? context("2030-01-01") : value,
            );
            expect(
                index
                    .lookupTemporalRange(query)
                    .map((range) => range.start.messageOrdinal),
            ).toEqual(
                replaced.flatMap((value, ordinal) =>
                    matchesTemporalRange(value, query) ? [ordinal] : [],
                ),
            );
            index.clear();
            expect(index.lookupTemporalRange(query)).toEqual([]);
        },
    );

    test("a selective 4096-context range exact-checks only its two candidate contexts", () => {
        const index = new TimestampToTextRangeIndex();
        for (let ordinal = 0; ordinal < 4096; ordinal++)
            index.addTemporalContext(
                ordinal,
                context(
                    new Date(
                        Date.UTC(2024, 0, 1) + ordinal * 60_000,
                    ).toISOString(),
                ),
            );
        const previous = process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
        process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = "1";
        const warning = console.warn;
        const logs: string[] = [];
        console.warn = (entry: unknown) => {
            logs.push(String(entry));
        };
        try {
            const result = runWithSearchTiming("synthetic", "test", () =>
                index.lookupTemporalRange({
                    dimension: "message",
                    domain: "instant",
                    start: "2024-01-01T00:01:00Z",
                    end: "2024-01-01T00:02:00Z",
                }),
            );
            expect(result).toHaveLength(2);
            expect(
                logs.some(
                    (entry) =>
                        entry.includes('"candidateContexts":2') &&
                        entry.includes('"totalContexts":4096'),
                ),
            ).toBe(true);
        } finally {
            console.warn = warning;
            if (previous === undefined)
                delete process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
            else process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = previous;
        }
    });

    test("unsupported precision and instant bounds without offsets fail even on empty indexes", () => {
        const index = new TimestampToTextRangeIndex();
        for (const start of [
            "2024-01-01T00:00:00.0001Z",
            "2024-01-01T00:00:00",
        ])
            expect(() =>
                index.lookupTemporalRange({
                    dimension: "message",
                    domain: "instant",
                    start,
                }),
            ).toThrow();
    });
});

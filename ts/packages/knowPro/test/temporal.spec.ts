// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { error, success } from "typechat";
import type { conversation as kpLib } from "@typeagent/knowledge-processor";
import {
    matchesTemporalRange,
    normalizeTemporalContext,
    parseTemporalValue,
    resolveRelativeDate,
    temporalMentions,
    temporalSegments,
    validateTemporalValue,
} from "../src/temporal.js";
import type { MessageTemporalContext } from "../src/temporalSchema.js";
import type { IMessageMetadata } from "../src/interfaces.js";
import { extractKnowledgeWithTemporalContext } from "../src/temporalKnowledge.js";
import { MessageCollection } from "../src/storage.js";
import {
    QueryEvalContext,
    TextRangesInDateRangeSelector,
} from "../src/query.js";
import { TermToSemanticRefIndex } from "../src/conversationIndex.js";
import { TimestampToTextRangeIndex } from "../src/timestampIndex.js";
import {
    getEnclosingDateRangeForMessages,
    getEnclosingDateRangeForTextRange,
} from "../src/message.js";
import { TestConversation } from "./testCommon.js";
import { TestMessage } from "./testMessage.js";

function context(date?: string): MessageTemporalContext {
    return temporalSegments(
        "source text",
        {
            version: 1,
            scopes: [
                {
                    ownerId: "owner",
                    start: 0,
                    end: 11,
                    ...(date ? { messageTime: date } : {}),
                },
            ],
        },
        "revision",
    )[0].context!;
}

class TemporalMessage extends TestMessage {
    public metadata: IMessageMetadata;
    constructor(text: string, temporal: MessageTemporalContext) {
        super(text);
        this.metadata = { temporalContext: temporal };
        delete this.timestamp;
        if (temporal.messageTime?.instantUtc)
            this.timestamp = temporal.messageTime.instantUtc;
    }
}

const empty = { entities: [], actions: [], inverseActions: [], topics: [] };

describe("canonical source temporal context", () => {
    test.each([
        "I just finished a short class.",
        "I recently changed jobs.",
        "We will visit soon.",
        "I bought just one ticket.",
    ])(
        "vague windows are not promoted to canonical exact event dates: %s",
        (text) => {
            const source = context("2024-04-10T00:30:00+14:00");
            expect(temporalMentions(text, source)).toEqual([]);
            expect(
                resolveRelativeDate(text, source.messageTime),
            ).toBeUndefined();
            expect(
                temporalMentions(`${text} Today is busy.`, source)[0].value
                    ?.localDateTime,
            ).toBe("2024-04-10");
        },
    );

    test.each([
        ["2023/05/27 (Sat) 22:00", "floating", "2023-05-27T22:00"],
        ["2023-05-27", "calendar", "2023-05-27"],
        ["2023-05", "calendar", "2023-05"],
        ["2023", "calendar", "2023"],
        ["2023-05-27T23:30:00-07:00", "instant", "2023-05-27T23:30:00"],
        ["Tue, 13 Oct 2026 18:00:00 -0700", "instant", "2026-10-13T18:00:00"],
        ["Tue, 13 Oct 2026 18:00:00", "floating", "2026-10-13T18:00:00"],
        ["2023-05-27T22:00-00:00", "floating", "2023-05-27T22:00"],
    ])(
        "preserves spelling, precision and calendar domain: %s",
        (raw, kind, localDateTime) => {
            const value = parseTemporalValue(raw);
            expect(value).toMatchObject({ raw, kind, localDateTime });
            expect(validateTemporalValue({ ...value })).toEqual(value);
            if (kind !== "instant") expect(value.instantUtc).toBeUndefined();
        },
    );

    test.each([
        "2023-02-29",
        "2024-13-01",
        "2024-01-01T24:00",
        "2024-01-01T10:00+14:01",
        "not a date",
    ])("rejects invalid structured source dates: %s", (raw) =>
        expect(() => parseTemporalValue(raw)).toThrow(),
    );

    test("deictic days use source-local dates across UTC midnight and DST changes", () => {
        const anchor = parseTemporalValue("2024-03-10T23:30:00-07:00");
        expect(anchor.instantUtc).toBe("2024-03-11T06:30:00.000Z");
        expect(resolveRelativeDate("yesterday", anchor)?.localDateTime).toBe(
            "2024-03-09",
        );
        expect(resolveRelativeDate("tomorrow", anchor)?.localDateTime).toBe(
            "2024-03-11",
        );
        expect(resolveRelativeDate("today", undefined)).toBeUndefined();
    });

    test("nested source owners inherit dates without crossing quotation boundaries", () => {
        const parts = temporalSegments(
            "beforequotedafter",
            {
                version: 1,
                scopes: [
                    {
                        ownerId: "outer",
                        start: 0,
                        end: 17,
                        messageTime: "2024-05-10",
                    },
                    {
                        ownerId: "quote",
                        start: 6,
                        end: 12,
                        messageTime: "2020-01-02",
                    },
                ],
            },
            "revision",
        );
        expect(parts.map((part) => part.text).join("")).toBe(
            "beforequotedafter",
        );
        expect(parts.map((part) => part.context?.ownerId)).toEqual([
            "outer",
            "quote",
            "outer",
        ]);
        expect(
            parts.map((part) => part.context?.messageTime?.localDateTime),
        ).toEqual(["2024-05-10", "2020-01-02", "2024-05-10"]);
    });

    test("canonical context is independent of input property and scope order", () => {
        const a = normalizeTemporalContext(
            {
                version: 1,
                scopes: [
                    {
                        ownerId: "inner",
                        start: 1,
                        end: 2,
                        messageTime: "2024-01-01",
                    },
                    { ownerId: "outer", start: 0, end: 3 },
                ],
            },
            3,
        );
        const b = normalizeTemporalContext(
            {
                version: 1,
                scopes: [
                    { end: 3, start: 0, ownerId: "outer" },
                    {
                        messageTime: "2024-01-01",
                        end: 2,
                        start: 1,
                        ownerId: "inner",
                    },
                ],
            },
            3,
        );
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        expect(() =>
            normalizeTemporalContext(
                {
                    version: 1,
                    scopes: [
                        { ownerId: "a", start: 0, end: 2 },
                        { ownerId: "b", start: 1, end: 3 },
                    ],
                },
                3,
            ),
        ).toThrow("Conflicting");
    });

    test("message and event ranges remain separate and floating values never satisfy instant ranges", () => {
        const temporal = context("2024-05-10");
        temporal.eventMentions = temporalMentions("I went yesterday", temporal);
        const range = {
            domain: "calendar" as const,
            start: "2024-05-09",
            end: "2024-05-09",
        };
        expect(
            matchesTemporalRange(temporal, { ...range, dimension: "event" }),
        ).toBe(true);
        expect(
            matchesTemporalRange(temporal, { ...range, dimension: "message" }),
        ).toBe(false);
        expect(
            matchesTemporalRange(temporal, {
                dimension: "message",
                domain: "instant",
                start: "2024-05-09T00:00:00Z",
                end: "2024-05-10T23:59:59Z",
            }),
        ).toBe(false);
        expect(() =>
            matchesTemporalRange(temporal, {
                ...range,
                dimension: "message",
                domain: "instant",
            }),
        ).toThrow("explicit UTC offset");
    });

    test.each([false, true])(
        "shuffled, repeated and noncontiguous timestamps select exactly the matching messages; index=%s",
        (indexed) => {
            const messages = [
                "2024-05-10T00:00Z",
                "2024-01-01T00:00Z",
                "2024-05-10T00:00Z",
                "2025-01-01T00:00Z",
            ].map((date) => new TemporalMessage("fact", context(date)));
            const conversation = new TestConversation("dates", [], messages);
            conversation.semanticRefIndex = new TermToSemanticRefIndex();
            const index = indexed ? new TimestampToTextRangeIndex() : undefined;
            index?.addTimestamps(
                messages.map((message, ordinal) => [
                    ordinal,
                    message.timestamp!,
                ]),
            );
            const query = new QueryEvalContext(conversation, undefined, index);
            const selected = new TextRangesInDateRangeSelector({
                start: new Date("2024-05-10T00:00Z"),
                end: new Date("2024-05-10T00:00Z"),
            }).eval(query);
            expect(
                selected
                    ?.getRanges()
                    .map((range) => range.start.messageOrdinal),
            ).toEqual([0, 2]);
            expect(
                getEnclosingDateRangeForMessages(conversation.messages, [0, 2]),
            ).toEqual({
                start: new Date("2024-05-10T00:00Z"),
                end: new Date("2024-05-10T00:00Z"),
            });
            expect(
                getEnclosingDateRangeForTextRange(conversation.messages, {
                    start: { messageOrdinal: 0 },
                    end: { messageOrdinal: 3 },
                })?.end,
            ).toEqual(new Date("2024-05-10T00:00Z"));
        },
    );

    test("calendar indexing includes floating dates and excludes unknown dates", () => {
        const index = new TimestampToTextRangeIndex();
        index.addTemporalContext(0, context("2024/05/10 (Fri) 10:00"));
        index.addTemporalContext(1, context());
        expect(
            index
                .lookupTemporalRange({
                    dimension: "message",
                    domain: "calendar",
                    start: "2024-05-10",
                    end: "2024-05-10",
                })
                .map((range) => range.start.messageOrdinal),
        ).toEqual([0]);
        expect(
            index.lookupRange({ start: new Date("2024-05-10T00:00Z") }),
        ).toEqual([]);
    });

    test("validated earlier-chunk discoveries reach later calls and survive a serialized restart", async () => {
        const first = context("2024-05-10");
        first.partOrdinal = 0;
        const second = structuredClone(first);
        second.partOrdinal = 1;
        const messages = new MessageCollection([
            new TemporalMessage("Launch was 2024-05-01.", first),
            new TemporalMessage("That was the earlier event.", second),
        ]);
        const prompts: string[] = [];
        const extractor: kpLib.KnowledgeExtractor = {
            settings: { maxContextLength: 4096 },
            extract: async () => empty,
            extractWithRetry: async (text, _retries, preamble) => {
                prompts.push(JSON.stringify(preamble));
                return success({
                    ...empty,
                    dateAnchors: text.includes("2024-05-01")
                        ? [
                              {
                                  quote: "Launch was 2024-05-01.",
                                  date: "2024-05-01",
                                  role: "eventTime" as const,
                              },
                          ]
                        : [],
                });
            },
        };
        await extractKnowledgeWithTemporalContext(
            messages,
            [{ messageOrdinal: 0 }],
            extractor,
        );
        messages.get(0).metadata = {
            temporalContext: JSON.parse(JSON.stringify(first)),
        };
        await extractKnowledgeWithTemporalContext(
            messages,
            [{ messageOrdinal: 1 }],
            extractor,
        );
        expect(prompts[1]).toContain("Launch was 2024-05-01.");
        expect(
            second.inheritedDateEvidence.some(
                (evidence) => evidence.value.localDateTime === "2024-05-01",
            ),
        ).toBe(true);
        expect(second.messageTime?.localDateTime).toBe("2024-05-10");
        expect(second.contextHash).not.toBe(second.sourceContextHash);
    });

    test("two valid dates in the same source quote have distinct evidence identities", async () => {
        const temporal = context("2024-05-10");
        const text = "The event ran from 2024-05-01 to 2024-05-02.";
        const messages = new MessageCollection([
            new TemporalMessage(text, temporal),
        ]);
        const extractor: kpLib.KnowledgeExtractor = {
            settings: { maxContextLength: 4096 },
            extract: async () => empty,
            extractWithRetry: async () =>
                success({
                    ...empty,
                    dateAnchors: ["2024-05-01", "2024-05-02"].map((date) => ({
                        quote: text,
                        date,
                        role: "eventTime" as const,
                    })),
                }),
        };
        const results = await extractKnowledgeWithTemporalContext(
            messages,
            [{ messageOrdinal: 0 }],
            extractor,
        );
        expect(results[0].success).toBe(true);
        expect(
            new Set(temporal.discoveredDateEvidence?.map((entry) => entry.id))
                .size,
        ).toBe(2);
    });

    test("retrying an earlier chunk excludes future discovered, inherited and rejected annotations", async () => {
        const temporal = context("2024-05-10");
        const future = {
            id: "future",
            role: "eventTime" as const,
            locator: "later-chunk",
            value: parseTemporalValue("2028-12-31"),
            chunkOrdinal: 1,
        };
        temporal.discoveredDateEvidence = [future];
        temporal.inheritedDateEvidence.push(future);
        temporal.rejectedDateAnchors = [
            { chunkOrdinal: 1, anchorOrdinal: 77, reason: "invalid-date" },
        ];
        const message = new TemporalMessage("Earlier passage", temporal);
        message.textChunks.push("Future passage dated 2028-12-31.");
        const messages = new MessageCollection([message]);
        let prompt = "";
        const extractor: kpLib.KnowledgeExtractor = {
            settings: { maxContextLength: 4096 },
            extract: async () => empty,
            extractWithRetry: async (_text, _retries, preamble) => {
                prompt = JSON.stringify(preamble);
                return success(empty);
            },
        };
        await extractKnowledgeWithTemporalContext(
            messages,
            [{ messageOrdinal: 0, chunkOrdinal: 0 }],
            extractor,
        );
        expect(prompt).not.toContain("2028-12-31");
        expect(prompt).not.toContain('"anchorOrdinal":77');
        expect(temporal.discoveredDateEvidence).toEqual([]);
        expect(temporal.rejectedDateAnchors).toEqual([]);
    });

    test("a failed prerequisite prevents dependent extraction", async () => {
        let calls = 0;
        const messages = new MessageCollection([
            new TemporalMessage("first", context()),
            new TemporalMessage("dependent", context()),
        ]);
        const extractor: kpLib.KnowledgeExtractor = {
            settings: { maxContextLength: 4096 },
            extract: async () => empty,
            extractWithRetry: async () => {
                calls++;
                return error("controlled failure");
            },
        };
        const results = await extractKnowledgeWithTemporalContext(
            messages,
            [{ messageOrdinal: 0 }, { messageOrdinal: 1 }],
            extractor,
        );
        expect(calls).toBe(1);
        expect(results[1]).toEqual(
            error("Temporal prerequisite extraction failed"),
        );
    });

    test.each([
        {
            quote: "Missing quote",
            date: "2024-05-01",
            source: "No such quotation.",
            reason: "quote-not-found",
        },
        {
            quote: "2024-05-01",
            date: "2024-05-01",
            source: "2024-05-01 and 2024-05-01",
            reason: "ambiguous-quote",
        },
        {
            quote: "Launch was May 1.",
            date: "2024-05-01",
            source: "Launch was May 1.",
            reason: "date-not-in-quote",
        },
        {
            quote: "Invalid 2023-02-29.",
            date: "2023-02-29",
            source: "Invalid 2023-02-29.",
            reason: "invalid-date",
        },
    ])(
        "rejects $reason annotations explicitly without aborting valid knowledge or inheriting the rejected date",
        async ({ quote, date, source, reason }) => {
            const first = context("2024-05-10");
            first.partOrdinal = 0;
            const second = structuredClone(first);
            second.partOrdinal = 1;
            const text = `${source} Valid event 2024-05-02.`;
            const knowledge = {
                ...empty,
                entities: [{ name: "Launch", type: ["event"] }],
            };
            const messages = new MessageCollection([
                new TemporalMessage(text, first),
                new TemporalMessage("Dependent passage.", second),
            ]);
            const extractor: kpLib.KnowledgeExtractor = {
                settings: { maxContextLength: 4096 },
                extract: async () => knowledge,
                extractWithRetry: async (input) =>
                    success({
                        ...knowledge,
                        dateAnchors:
                            input === text
                                ? [
                                      {
                                          quote,
                                          date,
                                          role: "eventTime" as const,
                                      },
                                      {
                                          quote: "Valid event 2024-05-02.",
                                          date: "2024-05-02",
                                          role: "eventTime" as const,
                                      },
                                  ]
                                : [],
                    }),
            };
            const originalWarning = console.warn;
            const warnings: string[] = [];
            console.warn = (message: unknown) => {
                warnings.push(String(message));
            };
            try {
                const results = await extractKnowledgeWithTemporalContext(
                    messages,
                    [{ messageOrdinal: 0 }, { messageOrdinal: 1 }],
                    extractor,
                );
                expect(results.every((result) => result.success)).toBe(true);
                expect(results[0]).toMatchObject(
                    success({ entities: knowledge.entities }),
                );
                expect(first.rejectedDateAnchors).toEqual([
                    { anchorOrdinal: 0, chunkOrdinal: 0, reason },
                ]);
                expect(
                    first.discoveredDateEvidence?.map(
                        (entry) => entry.value.localDateTime,
                    ),
                ).toEqual(["2024-05-02"]);
                expect(
                    second.inheritedDateEvidence
                        .filter((entry) => entry.role === "eventTime")
                        .map((entry) => entry.value.localDateTime),
                ).toEqual(["2024-05-02"]);
                expect(warnings).toHaveLength(1);
                expect(warnings[0]).toContain(reason);
                expect(warnings[0]).not.toContain(quote);
            } finally {
                console.warn = originalWarning;
            }
        },
    );
});

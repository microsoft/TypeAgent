// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Unit tests for the structured-content agenda builder in
 * calendarActionHandlerV3. buildStructuredEventList converts a list of raw
 * calendar events into an ActionResultSuccess whose displayContent is a
 * StructuredContent document (optional heading + table).
 */

import { buildStructuredEventList } from "../src/calendarActionHandlerV3.js";

function blocks(result: ReturnType<typeof buildStructuredEventList>) {
    return (result.displayContent as any).blocks;
}

function tableBlock(result: ReturnType<typeof buildStructuredEventList>) {
    return blocks(result).find((b: any) => b.kind === "table");
}

const events = [
    {
        subject: "Team sync",
        start: { dateTime: "2026-07-13T09:00:00" },
        end: { dateTime: "2026-07-13T09:30:00" },
        location: { displayName: "Room 1" },
        htmlLink: "https://calendar.example/e/1",
    },
    {
        subject: "1:1",
        start: { dateTime: "2026-07-13T11:00:00" },
        end: { dateTime: "2026-07-13T11:30:00" },
        location: "Cafe",
    },
];

describe("buildStructuredEventList", () => {
    test("returns a structured displayContent", () => {
        const result = buildStructuredEventList(events);
        expect((result.displayContent as any).type).toBe("structured");
    });

    test("no heading when omitted", () => {
        const result = buildStructuredEventList(events);
        expect(blocks(result).some((b: any) => b.kind === "heading")).toBe(
            false,
        );
    });

    test("adds a heading block when provided", () => {
        const result = buildStructuredEventList(events, "Today");
        expect(blocks(result)[0]).toMatchObject({
            kind: "heading",
            text: "Today",
        });
    });

    test("table has Event / When / Location columns", () => {
        const t = tableBlock(buildStructuredEventList(events));
        expect(t.columns.map((c: any) => c.id)).toEqual([
            "subject",
            "when",
            "location",
        ]);
    });

    test("subject cell is a link when htmlLink is present", () => {
        const t = tableBlock(buildStructuredEventList(events));
        expect(t.rows[0][0]).toMatchObject({
            text: "Team sync",
            href: "https://calendar.example/e/1",
        });
    });

    test("subject cell is plain text without htmlLink", () => {
        const t = tableBlock(buildStructuredEventList(events));
        expect(t.rows[1][0]).toBe("1:1");
    });

    test("location resolves both object and string forms", () => {
        const t = tableBlock(buildStructuredEventList(events));
        expect(t.rows[0][2]).toBe("Room 1");
        expect(t.rows[1][2]).toBe("Cafe");
    });

    test("table is sortable and paginated", () => {
        const t = tableBlock(buildStructuredEventList(events));
        expect(t.sortable).toBe(true);
        expect(t.pageSize).toBe(15);
    });

    test("rawData carries the original events", () => {
        const result = buildStructuredEventList(events);
        expect((result.displayContent as any).rawData).toBe(events);
    });
});

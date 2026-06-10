// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    findConversationByName,
    formatAutoConversationName,
    normalizeConversationName,
    sortConversationsByCreatedDesc,
    findUniqueConversationByName,
} from "../src/conversation/naming.js";
import type { ConversationInfo } from "../src/index.js";
import { makeStubConnection, makeInfo } from "./conversation-stubConnection.js";

describe("normalizeConversationName", () => {
    test("lowercases and trims", () => {
        expect(normalizeConversationName("  MyChat  ")).toBe("mychat");
    });
    test("preserves internal whitespace", () => {
        expect(normalizeConversationName("My Chat ")).toBe("my chat");
    });
    test("empty string is empty", () => {
        expect(normalizeConversationName("   ")).toBe("");
    });
});

describe("findConversationByName", () => {
    const list: ConversationInfo[] = [
        makeInfo("a", "Alpha"),
        makeInfo("b", "Beta"),
        makeInfo("c", "GAMMA"),
    ];
    test("case-insensitive match", () => {
        expect(findConversationByName(list, "alpha")?.conversationId).toBe("a");
        expect(findConversationByName(list, "Alpha")?.conversationId).toBe("a");
        expect(findConversationByName(list, "gamma")?.conversationId).toBe("c");
    });
    test("returns undefined on miss", () => {
        expect(findConversationByName(list, "Delta")).toBeUndefined();
    });
    test("trims input", () => {
        expect(findConversationByName(list, "  beta  ")?.conversationId).toBe(
            "b",
        );
    });
});

describe("findUniqueConversationByName", () => {
    test("returns match when exactly one", async () => {
        const conn = makeStubConnection({
            list: [makeInfo("a", "Alpha"), makeInfo("b", "Beta")],
        });
        const r = await findUniqueConversationByName(conn, "alpha");
        expect(r.kind).toBe("match");
        if (r.kind === "match") {
            expect(r.conversation.conversationId).toBe("a");
        }
    });
    test("returns not-found when zero matches", async () => {
        const conn = makeStubConnection({ list: [makeInfo("a", "Alpha")] });
        const r = await findUniqueConversationByName(conn, "missing");
        expect(r.kind).toBe("not-found");
    });
    test("returns ambiguous when multiple matches", async () => {
        // The server enforces uniqueness, but a buggy server / racing
        // create may produce duplicates; the helper must not silently
        // pick one. Force the scenario via the stub.
        const conn = makeStubConnection({
            list: [makeInfo("a", "Alpha"), makeInfo("b", "alpha")],
        });
        const r = await findUniqueConversationByName(conn, "alpha");
        expect(r.kind).toBe("ambiguous");
        if (r.kind === "ambiguous") {
            expect(r.matches).toHaveLength(2);
        }
    });
});

describe("formatAutoConversationName", () => {
    test("renders deterministic YYYY-MM-DD HH:MM", () => {
        const d = new Date(2026, 4, 9, 7, 5);
        expect(formatAutoConversationName(d)).toBe(
            "Conversation 2026-05-09 07:05",
        );
    });
    test("zero-pads month, day, hour, and minute", () => {
        const d = new Date(2026, 0, 1, 0, 0);
        expect(formatAutoConversationName(d)).toBe(
            "Conversation 2026-01-01 00:00",
        );
    });
});

describe("sortConversationsByCreatedDesc", () => {
    test("orders newest-first; ties keep relative order", () => {
        const sorted = sortConversationsByCreatedDesc([
            makeInfo("old", "Old", "2026-01-01T00:00:00Z"),
            makeInfo("new", "New", "2026-03-01T00:00:00Z"),
            makeInfo("mid", "Mid", "2026-02-01T00:00:00Z"),
        ]);
        expect(sorted.map((c) => c.conversationId)).toEqual([
            "new",
            "mid",
            "old",
        ]);
    });
    test("does not mutate input", () => {
        const list = [
            makeInfo("a", "A", "2026-01-01T00:00:00Z"),
            makeInfo("b", "B", "2026-02-01T00:00:00Z"),
        ];
        const before = list.map((c) => c.conversationId);
        sortConversationsByCreatedDesc(list);
        expect(list.map((c) => c.conversationId)).toEqual(before);
    });
});

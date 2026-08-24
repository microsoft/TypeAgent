// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { DisplayLogEntry } from "@typeagent/dispatcher-types";
import {
    buildSummaryRequest,
    buildTranscriptTurns,
    displayContentToPlainText,
    formatTranscript,
} from "../src/conversationSummary.js";

// Minimal display-log entry constructors. The pure helpers only read a few
// fields, so the rest of each entry shape is filled in loosely via a cast.
function userReq(command: string, requestId = "r"): DisplayLogEntry {
    return {
        type: "user-request",
        seq: 0,
        timestamp: 0,
        requestId: { requestId },
        command,
    } as DisplayLogEntry;
}
function setDisplay(content: unknown, requestId = "r"): DisplayLogEntry {
    return {
        type: "set-display",
        seq: 0,
        timestamp: 0,
        message: { message: content, requestId: { requestId } },
    } as unknown as DisplayLogEntry;
}
function appendDisplay(content: unknown, requestId = "r"): DisplayLogEntry {
    return {
        type: "append-display",
        seq: 0,
        timestamp: 0,
        mode: "inline",
        message: { message: content, requestId: { requestId } },
    } as unknown as DisplayLogEntry;
}

describe("displayContentToPlainText", () => {
    it("returns plain strings unchanged", () => {
        expect(displayContentToPlainText("hello")).toBe("hello");
    });

    it("reads the content field of typed content", () => {
        expect(
            displayContentToPlainText({ type: "text", content: "hi there" }),
        ).toBe("hi there");
    });

    it("strips tags from html content", () => {
        expect(
            displayContentToPlainText({
                type: "html",
                content: "<p>bold <strong>text</strong></p>",
            }),
        ).toBe("bold text");
    });

    it("joins array content", () => {
        expect(displayContentToPlainText(["a", "b", "c"])).toBe("a b c");
    });

    it("returns empty string for unknown shapes", () => {
        expect(displayContentToPlainText(undefined)).toBe("");
        expect(displayContentToPlainText({ foo: 1 })).toBe("");
    });
});

describe("buildTranscriptTurns", () => {
    it("pairs user requests with assistant responses", () => {
        const turns = buildTranscriptTurns([
            userReq("hi", "r1"),
            setDisplay("hello", "r1"),
        ]);
        expect(turns).toEqual([
            { role: "user", text: "hi" },
            { role: "assistant", text: "hello" },
        ]);
    });

    it("folds append-display chunks into one assistant turn", () => {
        const turns = buildTranscriptTurns([
            userReq("q", "r1"),
            appendDisplay("part a", "r1"),
            appendDisplay("part b", "r1"),
        ]);
        expect(turns[1]).toEqual({ role: "assistant", text: "part a\npart b" });
    });

    it("lets a set-display replace the intermediate assistant text", () => {
        const turns = buildTranscriptTurns([
            userReq("q", "r1"),
            setDisplay("first", "r1"),
            setDisplay("final", "r1"),
        ]);
        expect(turns[1]).toEqual({ role: "assistant", text: "final" });
    });

    it("starts a new assistant turn for a different request id", () => {
        const turns = buildTranscriptTurns([
            setDisplay("a", "r1"),
            setDisplay("b", "r2"),
        ]);
        expect(turns).toEqual([
            { role: "assistant", text: "a" },
            { role: "assistant", text: "b" },
        ]);
    });

    it("skips empty and non-message entries", () => {
        const turns = buildTranscriptTurns([
            userReq("", "r1"),
            setDisplay("", "r1"),
            { type: "command-result", seq: 0, timestamp: 0 } as DisplayLogEntry,
        ]);
        expect(turns).toEqual([]);
    });
});

describe("formatTranscript", () => {
    it("labels turns and truncates over-long turns", () => {
        const text = formatTranscript(
            [
                { role: "user", text: "1234567890" },
                { role: "assistant", text: "ok" },
            ],
            { maxTurnChars: 5 },
        );
        expect(text).toBe("User: 12345 […]\nAssistant: ok");
    });

    it("keeps the most recent turns when over the total budget", () => {
        const turns = Array.from({ length: 50 }, (_, i) => ({
            role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
            text: `turn ${i}`,
        }));
        const text = formatTranscript(turns, { maxTotalChars: 40 });
        expect(text.startsWith("[…earlier turns omitted…]\n")).toBe(true);
        // The tail (most recent turns) is retained, not the head.
        expect(text).toContain("turn 49");
        expect(text).not.toContain("turn 0\n");
    });
});

describe("buildSummaryRequest", () => {
    it("includes the conversation name and transcript", () => {
        const request = buildSummaryRequest(
            "Paris trip",
            "User: hi\nAssistant: hello",
        );
        expect(request).toContain('"Paris trip"');
        expect(request).toContain("User: hi\nAssistant: hello");
    });
});

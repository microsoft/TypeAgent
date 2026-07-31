// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { rankConversationMatches } from "../src/conversationSearchIndex.js";

// Fake message store keyed by ordinal, mirroring what the real index derives
// from a matched message (its text + the conversation id read off its tag).
const MESSAGES: Record<
    number,
    { text: string; conversationId: string | undefined }
> = {
    0: { text: "workout playlist", conversationId: "A" },
    1: { text: "more workout notes", conversationId: "A" },
    2: { text: "grocery list", conversationId: "B" },
    3: { text: "untagged message", conversationId: undefined },
};

const getMessage = (ordinal: number) => MESSAGES[ordinal];
const noTombstones = () => false;

const MATCHES = [
    { messageOrdinal: 0, score: 0.9 },
    { messageOrdinal: 1, score: 0.5 },
    { messageOrdinal: 2, score: 0.8 },
    { messageOrdinal: 3, score: 0.3 },
];

describe("rankConversationMatches", () => {
    it("groups hits by conversation and keeps the best score", () => {
        const result = rankConversationMatches(
            MATCHES,
            getMessage,
            noTombstones,
            10,
            3,
        );
        expect(result.map((m) => m.conversationId)).toEqual(["A", "B"]);
        expect(result[0].score).toBeCloseTo(0.9);
        // Snippets are ordered best-first within a conversation.
        expect(result[0].snippets).toEqual([
            "workout playlist",
            "more workout notes",
        ]);
        expect(result[1].score).toBeCloseTo(0.8);
    });

    it("skips messages with no conversation tag", () => {
        const result = rankConversationMatches(
            MATCHES,
            getMessage,
            noTombstones,
            10,
            3,
        );
        // The untagged ordinal (3) must not create a phantom conversation.
        expect(result.some((m) => m.conversationId === undefined)).toBe(false);
        expect(result).toHaveLength(2);
    });

    it("excludes tombstoned conversations", () => {
        const result = rankConversationMatches(
            MATCHES,
            getMessage,
            (id) => id === "A",
            10,
            3,
        );
        expect(result.map((m) => m.conversationId)).toEqual(["B"]);
    });

    it("caps snippets per conversation, best first", () => {
        const result = rankConversationMatches(
            MATCHES,
            getMessage,
            noTombstones,
            10,
            1,
        );
        const a = result.find((m) => m.conversationId === "A")!;
        expect(a.snippets).toEqual(["workout playlist"]);
    });

    it("caps the number of conversations returned", () => {
        const result = rankConversationMatches(
            MATCHES,
            getMessage,
            noTombstones,
            1,
            3,
        );
        expect(result).toHaveLength(1);
        expect(result[0].conversationId).toBe("A");
    });

    it("returns nothing for no matches", () => {
        expect(
            rankConversationMatches([], getMessage, noTombstones, 10, 3),
        ).toHaveLength(0);
    });
});

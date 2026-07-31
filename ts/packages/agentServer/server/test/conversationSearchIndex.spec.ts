// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { rankConversationMatches } from "../src/conversationSearchIndex.js";
import {
    createConversationSearchIndex,
    selectStaleConversations,
    selectUnindexedTurns,
} from "../src/conversationSearchIndex.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

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

describe("selectUnindexedTurns", () => {
    const notIndexed = () => false;

    it("keeps only user-request entries, in log order, with text + key", () => {
        const entries = [
            {
                type: "user-request",
                command: "first",
                requestId: { requestId: "r1" },
                seq: 0,
            },
            { type: "set-display", seq: 1 },
            {
                type: "user-request",
                command: "second",
                requestId: { requestId: "r2" },
                seq: 2,
            },
            { type: "command-result", seq: 3 },
        ];
        const turns = selectUnindexedTurns(entries, notIndexed);
        expect(turns).toEqual([
            { text: "first", turnKey: "r1" },
            { text: "second", turnKey: "r2" },
        ]);
    });

    it("falls back to the entry sequence when the request id is absent", () => {
        const entries = [
            { type: "user-request", command: "no id", seq: 7 },
            {
                type: "user-request",
                command: "empty id",
                requestId: {},
                seq: 8,
            },
        ];
        const turns = selectUnindexedTurns(entries, notIndexed);
        expect(turns).toEqual([
            { text: "no id", turnKey: "7" },
            { text: "empty id", turnKey: "8" },
        ]);
    });

    it("skips turns whose key is already indexed", () => {
        const entries = [
            {
                type: "user-request",
                command: "old",
                requestId: { requestId: "r1" },
                seq: 0,
            },
            {
                type: "user-request",
                command: "new",
                requestId: { requestId: "r2" },
                seq: 1,
            },
        ];
        const turns = selectUnindexedTurns(entries, (key) => key === "r1");
        expect(turns).toEqual([{ text: "new", turnKey: "r2" }]);
    });

    it("returns [] when there are no user turns", () => {
        expect(
            selectUnindexedTurns([{ type: "set-display", seq: 0 }], notIndexed),
        ).toEqual([]);
    });
});

describe("selectStaleConversations", () => {
    it("returns only conversations that are no longer live", () => {
        const indexed = ["A", "B", "C"];
        const live = new Set(["A", "C"]);
        expect(selectStaleConversations(indexed, (id) => live.has(id))).toEqual(
            ["B"],
        );
    });

    it("returns [] when every indexed conversation is still live", () => {
        const live = new Set(["A", "B"]);
        expect(
            selectStaleConversations(["A", "B"], (id) => live.has(id)),
        ).toEqual([]);
    });

    it("returns [] when nothing is indexed", () => {
        expect(selectStaleConversations([], () => true)).toEqual([]);
    });
});

describe("createConversationSearchIndex", () => {
    // Regression: the index directory must be created up front, or knowPro's
    // writer fails with ENOENT on every background auto-save and nothing ever
    // persists to disk (the index survives only until the process restarts).
    it("creates the index directory so background saves can persist", async () => {
        const root = path.join(
            os.tmpdir(),
            `unified-index-test-${Date.now()}-${Math.random()
                .toString(36)
                .slice(2)}`,
        );
        const dir = path.join(root, "_unified");
        expect(fs.existsSync(dir)).toBe(false);
        const index = await createConversationSearchIndex(dir, {
            extractKnowledge: false,
        });
        try {
            expect(fs.existsSync(dir)).toBe(true);
        } finally {
            await index.close();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

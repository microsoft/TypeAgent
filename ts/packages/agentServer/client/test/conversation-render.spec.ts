// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { renderConversationActionResult } from "../src/conversation/render.js";
import type { ConversationActionResult } from "../src/conversation/manage.js";

// The renderer returns structured DisplayContent; serialize it so tests can
// assert on the rendered text without coupling to the block shape.
function render(result: ConversationActionResult): string {
    return JSON.stringify(renderConversationActionResult(result));
}

describe("renderConversationActionResult — list", () => {
    test("shows a per-conversation message count, pluralized", () => {
        const json = render({
            kind: "list",
            currentConversationId: "id2",
            conversations: [
                {
                    conversationId: "id1",
                    name: "Alpha",
                    clientCount: 0,
                    createdAt: "2026-01-01T00:00:00Z",
                    messageCount: 1,
                },
                {
                    conversationId: "id2",
                    name: "Beta",
                    clientCount: 1,
                    createdAt: "2026-01-02T00:00:00Z",
                    messageCount: 5,
                },
            ],
        });

        expect(json).toContain("Conversations (2)");
        expect(json).toContain("1 message");
        expect(json).toContain("5 messages");
        // The current conversation is marked.
        expect(json).toContain("Beta (current)");
    });

    test("empty list renders a friendly message", () => {
        const json = render({
            kind: "list",
            currentConversationId: undefined,
            conversations: [],
        });
        expect(json).toContain("No conversations found.");
    });
});

describe("renderConversationActionResult — matches", () => {
    test("shows query, name, and percent match", () => {
        const json = render({
            kind: "matches",
            query: "gym music",
            currentConversationId: "id2",
            matches: [
                {
                    conversation: {
                        conversationId: "id1",
                        name: "Workout Playlist",
                        clientCount: 0,
                        createdAt: "2026-01-01T00:00:00Z",
                        messageCount: 3,
                    },
                    score: 0.92,
                },
                {
                    conversation: {
                        conversationId: "id2",
                        name: "Beta",
                        clientCount: 0,
                        createdAt: "2026-01-02T00:00:00Z",
                        messageCount: 1,
                    },
                    score: 0.71,
                },
            ],
        });
        expect(json).toContain("Matches for");
        expect(json).toContain("gym music");
        expect(json).toContain("Workout Playlist");
        expect(json).toContain("92% match");
        // The current conversation is marked.
        expect(json).toContain("Beta (current)");
    });
});

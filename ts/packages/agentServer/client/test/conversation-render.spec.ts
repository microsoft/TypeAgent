// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { renderConversationActionResult } from "../src/conversation/render.js";
import type { ConversationActionResult } from "../src/conversation/manage.js";
import type { StructuredBlock, StructuredContent } from "@typeagent/agent-sdk";

// The renderer returns structured DisplayContent; serialize it so tests can
// assert on the rendered text without coupling to the block shape.
function render(result: ConversationActionResult): string {
    return JSON.stringify(renderConversationActionResult(result));
}

type TableBlock = Extract<StructuredBlock, { kind: "table" }>;

describe("renderConversationActionResult — list", () => {
    test("renders a sortable table with numeric counts and a current marker", () => {
        const content = renderConversationActionResult({
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
                    indexedMessageCount: 5,
                },
            ],
        }) as StructuredContent;

        expect(JSON.stringify(content)).toContain("Conversations (2)");

        const table = content.blocks.find(
            (b): b is TableBlock => b.kind === "table",
        );
        expect(table).toBeDefined();
        // Sortable is on by default (not explicitly disabled).
        expect(table!.sortable).not.toBe(false);
        expect(table!.columns.map((c) => c.header)).toEqual([
            "Name",
            "Messages",
            "Indexed",
            "Clients",
            "Created",
        ]);
        // Message/client counts are numeric cells, not pluralized text; the
        // indexed cell is an "indexed/total" ratio (missing count => 0).
        expect(table!.rows[0]).toEqual(
            expect.arrayContaining(["Alpha", 1, "0/1", 0]),
        );
        expect(table!.rows[1]).toEqual(
            expect.arrayContaining(["Beta (current)", 5, "5/5", 1]),
        );
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

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, it, expect } from "@jest/globals";
import type { DisplayContent } from "@typeagent/agent-sdk";
import {
    renderConversationIndexProgress,
    renderConversationIndexSummary,
} from "../src/context/system/conversationIndexProgress.js";

// DisplayContent is either a bare string or a typed object (which may carry a
// plain-text alternate). Pull whichever text a text-only host would render.
function textOf(content: DisplayContent): string {
    if (typeof content === "string") {
        return content;
    }
    const typed = content as {
        content: unknown;
        alternates?: { type: string; content: unknown }[];
    };
    const alt = typed.alternates?.find((a) => a.type === "text");
    return String(alt?.content ?? typed.content);
}

// The primary (html / markdown) content a rich host renders.
function primaryOf(content: DisplayContent): string {
    if (typeof content === "string") {
        return content;
    }
    return String((content as { content: unknown }).content);
}

describe("conversation index progress rendering", () => {
    it("renders a bar with the (bold) conversation name, percent, and counts", () => {
        const content = renderConversationIndexProgress({
            done: 5,
            total: 20,
            name: "CLI notes",
        });
        const text = textOf(content);
        expect(text).toContain("CLI notes");
        expect(text).toContain("25%");
        expect(text).toContain("5/20");
        // The name is bold in the html bar.
        expect(primaryOf(content)).toContain("<strong>CLI notes</strong>");
    });

    it("carries the live-bubble rail marker (title + percent) in the html bar", () => {
        // ChatPanel's top rail reads these data-* attributes off the progress
        // bubble to build its chip; the name is escaped in the attribute value.
        const html = primaryOf(
            renderConversationIndexProgress({
                done: 5,
                total: 20,
                name: "CLI notes",
            }),
        );
        expect(html).toContain('data-live-percent="25"');
        expect(html).toContain(
            'data-live-title="Indexing &quot;CLI notes&quot;"',
        );
        // Without a name it falls back to a generic, static title.
        expect(
            primaryOf(renderConversationIndexProgress({ done: 1, total: 2 })),
        ).toContain('data-live-title="Indexing conversations"');
    });

    it("shows 0% before the total is known (no misleading full bar)", () => {
        expect(
            textOf(renderConversationIndexProgress({ done: 0, total: 0 })),
        ).toContain("0%");
    });

    it("falls back to a generic heading without a name", () => {
        expect(
            textOf(renderConversationIndexProgress({ done: 1, total: 2 })),
        ).toContain("Indexing conversation content");
    });

    it("summarizes a single indexed conversation with a bold name", () => {
        const content = renderConversationIndexSummary([
            { name: "CLI notes", newlyIndexed: 3, totalMessages: 3 },
        ]);
        expect(textOf(content)).toContain("indexed 3 new messages");
        expect(textOf(content)).toContain("3 total");
        expect(primaryOf(content)).toContain("**CLI notes**");
    });

    it("summarizes an already-up-to-date conversation", () => {
        const text = textOf(
            renderConversationIndexSummary([
                { name: "CLI notes", newlyIndexed: 0, totalMessages: 5 },
            ]),
        );
        expect(text).toContain("already up to date");
    });

    it("summarizes multiple conversations with a total header and bold names", () => {
        const content = renderConversationIndexSummary([
            { name: "A", newlyIndexed: 2, totalMessages: 2 },
            { name: "B", newlyIndexed: 3, totalMessages: 3 },
        ]);
        expect(textOf(content)).toContain(
            "Indexed 5 new messages across 2 conversations",
        );
        expect(textOf(content)).toContain("A:");
        expect(textOf(content)).toContain("B:");
        expect(primaryOf(content)).toContain("**A**");
        expect(primaryOf(content)).toContain("**B**");
    });

    it("reports nothing to index for an empty result", () => {
        expect(textOf(renderConversationIndexSummary([]))).toContain(
            "No conversations to index",
        );
    });
});

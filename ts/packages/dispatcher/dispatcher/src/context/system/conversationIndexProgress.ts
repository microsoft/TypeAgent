// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { DisplayContent } from "@typeagent/agent-sdk";

const BAR_WIDTH = 20;
const HEADING = "Indexing conversation content";

// Progress of an in-flight backfill, for the streamed bar. `done`/`total`
// count user turns; `name` is the conversation currently being indexed.
export type ConversationIndexBar = {
    done: number;
    total: number;
    name?: string | undefined;
};

function percent(done: number, total: number): number {
    // total is 0 before the plan is computed or when there is nothing to
    // index, so show 0% rather than a misleading full bar.
    if (total <= 0) {
        return 0;
    }
    return Math.min(100, Math.round((done / total) * 100));
}

// Escape a user-controlled string (a conversation name) for safe html interpolation.
function escapeHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// A progress bar rendered for both html hosts (styled div) and text hosts
// (unicode blocks), carried as alternates so each client picks what it
// supports. Streamed in place via appendDisplay(..., "temporary").
export function renderConversationIndexProgress(
    progress: ConversationIndexBar,
): DisplayContent {
    const { done, total, name } = progress;
    const pct = percent(done, total);
    const counts = total > 0 ? `${done}/${total} messages` : "";
    // Bold the name in the html bar (escaped, since it is user-controlled);
    // the plain-text alternate keeps it unadorned.
    const htmlHeading = name
        ? `Indexing "<strong>${escapeHtml(name)}</strong>"`
        : HEADING;
    const textHeading = name ? `Indexing "${name}"` : HEADING;
    const html =
        `<div style="font-family:var(--vscode-font-family,sans-serif)">` +
        `<div style="margin-bottom:4px">${htmlHeading}${counts ? ` \u2014 ${counts}` : ""}</div>` +
        `<div style="background:rgba(127,127,127,0.25);border-radius:6px;height:12px;width:100%;overflow:hidden">` +
        `<div style="background:#4caf50;height:100%;width:${pct}%;transition:width .3s"></div>` +
        `</div></div>`;
    const filled = Math.round((pct / 100) * BAR_WIDTH);
    const bar = "\u25A0".repeat(filled) + "\u25A1".repeat(BAR_WIDTH - filled);
    const text = `${textHeading} [${bar}] ${pct}%${counts ? ` (${counts})` : ""}`;
    return {
        type: "html",
        content: html,
        alternates: [{ type: "text", content: text }],
    };
}

// The final summary shown when a backfill finishes, replacing the bar.
export function renderConversationIndexSummary(
    indexed: { name: string; newlyIndexed: number; totalMessages: number }[],
): DisplayContent {
    if (indexed.length === 0) {
        return "No conversations to index.";
    }
    type Entry = (typeof indexed)[number];
    const statusOf = (c: Entry) =>
        c.newlyIndexed === 0
            ? "already up to date"
            : `indexed ${c.newlyIndexed} new message${
                  c.newlyIndexed === 1 ? "" : "s"
              }`;
    // Bold the conversation name in markdown; the text alternate keeps it plain.
    const mdLine = (c: Entry) =>
        `**${c.name}**: ${statusOf(c)} (${c.totalMessages} total)`;
    const textLine = (c: Entry) =>
        `${c.name}: ${statusOf(c)} (${c.totalMessages} total)`;

    if (indexed.length === 1) {
        return {
            type: "markdown",
            content: mdLine(indexed[0]),
            alternates: [{ type: "text", content: textLine(indexed[0]) }],
        };
    }
    const total = indexed.reduce((n, c) => n + c.newlyIndexed, 0);
    const header = `Indexed ${total} new message${
        total === 1 ? "" : "s"
    } across ${indexed.length} conversations:`;
    return {
        type: "markdown",
        content: `${header}\n${indexed.map((c) => `- ${mdLine(c)}`).join("\n")}`,
        alternates: [
            {
                type: "text",
                content: `${header}\n${indexed.map(textLine).join("\n")}`,
            },
        ],
    };
}

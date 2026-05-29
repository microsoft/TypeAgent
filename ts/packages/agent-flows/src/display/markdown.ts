// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Markdown formatting helpers used by flow management handlers (listFlow /
// showFlow / etc.) to produce ActionResult markdown that renders consistently
// across agents.
//
// Why these belong here: every agent that returns markdown to the renderer
// needs the same escaping rules + spacing constants. Centralizing keeps
// speech-bubble appearance uniform whether the user is listing Excel flows,
// browser flows, or task flows.

// Four non-breaking spaces. Used as a left-margin on list items so the
// renderer's `<p>` doesn't push them flush against the bubble edge.
export const INDENT = "&nbsp;&nbsp;&nbsp;&nbsp;";

// Empty paragraph that forces a visible vertical gap even in renderers that
// give `<p>` and `<ul>` zero margin.
export const SECTION_BREAK = "\n\n&nbsp;\n\n";

// Escape markdown/HTML specials in user-provided prose so they render literally.
// Covers backslash, backtick, asterisk, underscore, braces, brackets, angles.
export function escapeMarkdown(s: string): string {
    return s.replace(/([\\`*_{}\[\]<>])/g, "\\$1");
}

// Inside an inline code span, only backticks need handling; swap for entity.
export function escapeCodeSpan(s: string): string {
    return s.replace(/`/g, "&#96;");
}

// Format an ISO timestamp as a friendly absolute string (e.g.
// "May 21, 2026, 8:13 PM"). Returns "unknown" on null/undefined and the
// original string on parse failure.
export function formatTimestamp(ts: string | undefined | null): string {
    if (!ts) return "unknown";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return String(ts);
    return d.toLocaleString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Conversation name primitives. Names are compared case-insensitively
// (matches the server's `ensureNameAvailable`).

import type { AgentServerConnection, ConversationInfo } from "../index.js";

export function normalizeConversationName(name: string): string {
    return name.trim().toLowerCase();
}

export function findConversationByName(
    conversations: readonly ConversationInfo[],
    name: string,
): ConversationInfo | undefined {
    const norm = normalizeConversationName(name);
    return conversations.find(
        (c) => normalizeConversationName(c.name) === norm,
    );
}

export type ResolveByNameResult =
    | { kind: "match"; conversation: ConversationInfo }
    | { kind: "not-found"; name: string }
    | { kind: "ambiguous"; name: string; matches: ConversationInfo[] };

/**
 * Resolve a user-typed name to a single conversation, returning a
 * discriminated result for not-found / ambiguous so callers can render
 * the right UI without throwing.
 */
export async function findUniqueConversationByName(
    connection: AgentServerConnection,
    name: string,
): Promise<ResolveByNameResult> {
    const norm = normalizeConversationName(name);
    const all = await connection.listConversations();
    const matches = all.filter(
        (c) => normalizeConversationName(c.name) === norm,
    );
    if (matches.length === 0) {
        return { kind: "not-found", name };
    }
    if (matches.length > 1) {
        return { kind: "ambiguous", name, matches };
    }
    return { kind: "match", conversation: matches[0] };
}

/** `Conversation YYYY-MM-DD HH:MM` — auto-name for unnamed `new`. */
export function formatAutoConversationName(date: Date = new Date()): string {
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `Conversation ${date.getFullYear()}-${pad(
        date.getMonth() + 1,
    )}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Newest-first sort (returns a new array). */
export function sortConversationsByCreatedDesc<
    T extends Pick<ConversationInfo, "createdAt">,
>(conversations: readonly T[]): T[] {
    return [...conversations].sort(
        (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
}

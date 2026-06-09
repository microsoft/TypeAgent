// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Conversation name primitives shared across all clients (CLI, Electron
 * shell, VS Code extension, browser extension).
 *
 * The server compares conversation names case-insensitively in
 * `ensureNameAvailable`; every client therefore normalizes the same way
 * before lookup. Centralizing the helpers here removes four near-identical
 * inline copies and guarantees the comparison matches the server's
 * canonical form.
 */

import type { AgentServerConnection, ConversationInfo } from "../index.js";

/**
 * Match the agent server's case-insensitive name comparison
 * (see server's `ensureNameAvailable`).
 */
export function normalizeConversationName(name: string): string {
    return name.trim().toLowerCase();
}

/**
 * Case-insensitive name lookup over an already-fetched conversation list.
 * Returns the first match (servers reject duplicates so there is at most one).
 */
export function findConversationByName(
    conversations: readonly ConversationInfo[],
    name: string,
): ConversationInfo | undefined {
    const norm = normalizeConversationName(name);
    return conversations.find(
        (c) => normalizeConversationName(c.name) === norm,
    );
}

/**
 * Result of {@link findUniqueConversationByName}.
 */
export type ResolveByNameResult =
    | { kind: "match"; conversation: ConversationInfo }
    | { kind: "not-found"; name: string }
    | { kind: "ambiguous"; name: string; matches: ConversationInfo[] };

/**
 * Resolve a name to a single conversation. Returns a discriminated result
 * so callers can render the right UI for not-found / ambiguous without
 * throwing. Use this when the input came from a user (typed name or NL
 * parameter); use {@link findConversationByName} when you already have
 * the list in hand.
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

/**
 * Generate the auto-name format used by the conversation agent when the
 * user asks to create a conversation without specifying a name. Matches
 * the format inlined in shell, vscode-shell, and browser today
 * (`Conversation YYYY-MM-DD HH:MM`).
 *
 * @param date Defaults to `new Date()`; injectable for tests.
 */
export function formatAutoConversationName(date: Date = new Date()): string {
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `Conversation ${date.getFullYear()}-${pad(
        date.getMonth() + 1,
    )}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Sort a conversation list by createdAt descending (most-recent first).
 * Used by {@link manageList} and the cycle (`prev` / `next`) operations
 * so the order matches what the user sees in `@conversation list`.
 *
 * Returns a new array; the input is not mutated.
 */
export function sortConversationsByCreatedDesc<
    T extends Pick<ConversationInfo, "createdAt">,
>(conversations: readonly T[]): T[] {
    return [...conversations].sort(
        (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
}

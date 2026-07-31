// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ConversationMemory,
    ConversationMessage,
    ConversationMessageMeta,
    createConversationMemory,
} from "@typeagent/conversation-memory";
import { mkdir } from "node:fs/promises";
import registerDebug from "debug";

const debug = registerDebug("agent-server:conversation:searchIndex");
const debugError = registerDebug("agent-server:conversation:searchIndex:error");

// Message tag carrying the owning conversation id. A plain-string tag (knowPro
// `MessageTag = string | StructuredTag`) is enough: cross-conversation search
// runs unscoped, then reads this tag back off each matched message to group
// hits by conversation.
const CONV_TAG_PREFIX = "conv:";
// Message tag carrying the source turn's stable id (the request id, or the
// display-log sequence number for turns that predate request ids). Present
// only on user messages; lets a history backfill skip turns already indexed
// live and count each turn once, regardless of the order the two paths ran in.
const TURN_TAG_PREFIX = "turn:";
const UNIFIED_MEMORY_BASENAME = "unifiedMemory";

/** A conversation whose content matched a query, with representative snippets. */
export type RankedConversationContent = {
    conversationId: string;
    /** Best (highest) matching-message score for this conversation. */
    score: number;
    /** Top matching message texts, best first. */
    snippets: string[];
};

/**
 * A content-search request over the unified index. Provide a natural-language
 * `question`, a set of keyword `terms`, or both - they are blended (best score
 * per message wins). `question` drives the knowledge/query-translation search;
 * `terms` (or the question, when no terms are given) drive the message-text
 * similarity search.
 */
export type ContentSearchQuery = {
    question?: string | undefined;
    terms?: string[] | undefined;
};

/**
 * A single knowPro index spanning every conversation's messages, each tagged
 * with its owning conversation id. Backs cross-conversation content search
 * ("which conversation was this discussed in?") without spinning up each
 * conversation's own dispatcher.
 *
 * Deletes are handled by tombstoning the conversation id (filtered out of
 * results) because knowPro collections are append-only; a later compaction
 * pass rebuilds the index to reclaim the space.
 */
export interface ConversationSearchIndex {
    /**
     * Queue a conversation message for indexing, tagged by conversation id.
     * `turnKey` (the source turn's stable id) is recorded on user messages so
     * the turn is counted once and skipped by a later history backfill.
     * `onIndexed` (optional) fires when the message has been indexed (or
     * immediately when there is nothing to index), for progress reporting.
     */
    addMessage(
        conversationId: string,
        text: string,
        sender?: string,
        turnKey?: string,
        onIndexed?: () => void,
    ): void;
    /** Exclude a (deleted) conversation from future search results. */
    tombstone(conversationId: string): void;
    /**
     * The user-turn keys already indexed for a conversation. Its size is the
     * conversation's indexed-message count; a history backfill uses membership
     * to skip turns that are already indexed (live or by an earlier backfill).
     */
    getIndexedTurns(conversationId: string): ReadonlySet<string>;
    /** Rank conversations by how well their content matches the query. */
    search(
        query: ContentSearchQuery,
        maxConversations?: number,
        maxSnippetsPerConversation?: number,
    ): Promise<RankedConversationContent[]>;
    /** Await all queued indexing work (e.g. before search in tests). */
    waitForPendingTasks(): Promise<void>;
    close(): Promise<void>;
}

function conversationTag(conversationId: string): string {
    return CONV_TAG_PREFIX + conversationId;
}

function conversationIdFromTags(
    tags: ReadonlyArray<string | { [k: string]: unknown }>,
): string | undefined {
    for (const tag of tags) {
        if (typeof tag === "string" && tag.startsWith(CONV_TAG_PREFIX)) {
            return tag.slice(CONV_TAG_PREFIX.length);
        }
    }
    return undefined;
}

function turnTag(turnKey: string): string {
    return TURN_TAG_PREFIX + turnKey;
}

function turnKeyFromTags(
    tags: ReadonlyArray<string | { [k: string]: unknown }>,
): string | undefined {
    for (const tag of tags) {
        if (typeof tag === "string" && tag.startsWith(TURN_TAG_PREFIX)) {
            return tag.slice(TURN_TAG_PREFIX.length);
        }
    }
    return undefined;
}

/**
 * Group scored message hits into per-conversation matches. Pure so it can be
 * unit tested without a live model: `getMessage` yields each message's text and
 * (tag-derived) conversation id, `isTombstoned` filters deleted conversations.
 */
export function rankConversationMatches(
    messageMatches: ReadonlyArray<{ messageOrdinal: number; score: number }>,
    getMessage: (ordinal: number) => {
        text: string;
        conversationId: string | undefined;
    },
    isTombstoned: (conversationId: string) => boolean,
    maxConversations: number,
    maxSnippetsPerConversation: number,
): RankedConversationContent[] {
    const byConversation = new Map<
        string,
        { score: number; snippets: { text: string; score: number }[] }
    >();
    for (const { messageOrdinal, score } of messageMatches) {
        const { text, conversationId } = getMessage(messageOrdinal);
        if (conversationId === undefined || isTombstoned(conversationId)) {
            continue;
        }
        let entry = byConversation.get(conversationId);
        if (entry === undefined) {
            entry = { score: 0, snippets: [] };
            byConversation.set(conversationId, entry);
        }
        entry.score = Math.max(entry.score, score);
        const snippet = text.trim();
        if (snippet.length > 0) {
            entry.snippets.push({ text: snippet, score });
        }
    }
    const results: RankedConversationContent[] = [];
    for (const [conversationId, entry] of byConversation) {
        const snippets = entry.snippets
            .sort((a, b) => b.score - a.score)
            .slice(0, maxSnippetsPerConversation)
            .map((s) => s.text);
        results.push({ conversationId, score: entry.score, snippets });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, maxConversations);
}

/** The display-log fields a history backfill needs from each entry. */
export type BackfillLogEntry = {
    type?: string;
    command?: string;
    requestId?: { requestId?: string } | undefined;
    seq?: number;
};

/**
 * Pick the user turns from a conversation's display-log entries that are not
 * yet indexed, in log order. Pure so it can be unit tested without a live
 * memory: `isIndexed` reports whether a turn key is already present. The turn
 * key is the request id, falling back to the entry sequence for turns that
 * predate request ids (e.g. some imported mirrors).
 */
export function selectUnindexedTurns(
    entries: ReadonlyArray<BackfillLogEntry>,
    isIndexed: (turnKey: string) => boolean,
): { text: string; turnKey: string }[] {
    const turns: { text: string; turnKey: string }[] = [];
    for (const entry of entries) {
        if (entry?.type !== "user-request") {
            continue;
        }
        const turnKey = entry.requestId?.requestId ?? String(entry.seq);
        if (isIndexed(turnKey)) {
            continue;
        }
        turns.push({ text: entry.command ?? "", turnKey });
    }
    return turns;
}

class ConversationSearchIndexImpl implements ConversationSearchIndex {
    private readonly tombstoned = new Set<string>();
    // conversationId -> set of indexed user-turn keys. Rebuilt on startup from
    // the persisted message tags; the map itself is not persisted.
    private readonly turnsByConversation = new Map<string, Set<string>>();
    private static readonly EMPTY_TURNS: ReadonlySet<string> = new Set();

    constructor(
        // Undefined when no model provider is configured; the index is then
        // inert (addMessage no-ops, search returns nothing) rather than failing.
        private readonly memory: ConversationMemory | undefined,
        // Extract entities/topics per message for richer retrieval. Production
        // leaves this on so memory search works well; tests turn it off.
        private readonly extractKnowledge: boolean,
    ) {
        if (this.memory !== undefined) {
            this.rebuildTurnIndex(this.memory);
        }
    }

    // Reconstruct the per-conversation indexed-turn sets from the tags already
    // stored in the unified memory, so indexed counts and backfill dedup work
    // across restarts (the memory persists; this in-memory map does not).
    private rebuildTurnIndex(memory: ConversationMemory): void {
        for (const message of memory.messages) {
            const tags = message.tags ?? [];
            const conversationId = conversationIdFromTags(tags);
            const turnKey = turnKeyFromTags(tags);
            if (conversationId === undefined || turnKey === undefined) {
                continue;
            }
            this.recordTurn(conversationId, turnKey);
        }
    }

    private recordTurn(conversationId: string, turnKey: string): void {
        let turns = this.turnsByConversation.get(conversationId);
        if (turns === undefined) {
            turns = new Set<string>();
            this.turnsByConversation.set(conversationId, turns);
        }
        turns.add(turnKey);
    }

    public addMessage(
        conversationId: string,
        text: string,
        sender?: string,
        turnKey?: string,
        onIndexed?: () => void,
    ): void {
        if (this.memory === undefined) {
            // Inert index: the turn will never be embedded, but report it as
            // handled so a progress total can still complete.
            onIndexed?.();
            return;
        }
        // Record the turn key (user turns only) before the empty-text bail so a
        // blank turn still counts, keeping the indexed total aligned with the
        // display log's user-request count.
        const userTurnKey = sender === "user" ? turnKey : undefined;
        if (userTurnKey !== undefined) {
            this.recordTurn(conversationId, userTurnKey);
        }
        if (text.trim().length === 0) {
            onIndexed?.();
            return;
        }
        const tags = [conversationTag(conversationId)];
        if (userTurnKey !== undefined) {
            tags.push(turnTag(userTurnKey));
        }
        this.memory.queueAddMessage(
            new ConversationMessage(
                text,
                new ConversationMessageMeta(sender),
                tags,
            ),
            onIndexed,
            this.extractKnowledge,
        );
    }

    public tombstone(conversationId: string): void {
        this.tombstoned.add(conversationId);
    }

    public getIndexedTurns(conversationId: string): ReadonlySet<string> {
        return (
            this.turnsByConversation.get(conversationId) ??
            ConversationSearchIndexImpl.EMPTY_TURNS
        );
    }

    public async search(
        query: ContentSearchQuery,
        maxConversations: number = 10,
        maxSnippetsPerConversation: number = 3,
    ): Promise<RankedConversationContent[]> {
        const memory = this.memory;
        if (memory === undefined) {
            return [];
        }
        const question = query.question?.trim();
        const terms = (query.terms ?? [])
            .map((t) => t.trim())
            .filter((t) => t.length > 0);
        // Text-similarity runs on the explicit terms, or the question when no
        // terms were given - so a lone NL question still gets a message-text
        // match (catching literal mentions extraction may have missed).
        const textQuery = terms.length > 0 ? terms.join(" ") : question;
        if (!question && !textQuery) {
            return [];
        }

        // Blend two knowPro searches, keeping the best score per message:
        //  - question -> searchWithLanguage: query translation + extracted-
        //    knowledge match (semantic, but needs extraction to have run).
        //  - terms/text -> searchByTextSimilarity: message-text embedding match
        //    (finds literal / near-literal mentions without extraction).
        const scoreByOrdinal = new Map<number, number>();
        const addMatches = (
            matches:
                | readonly { messageOrdinal: number; score: number }[]
                | undefined,
        ) => {
            for (const m of matches ?? []) {
                const prev = scoreByOrdinal.get(m.messageOrdinal);
                if (prev === undefined || m.score > prev) {
                    scoreByOrdinal.set(m.messageOrdinal, m.score);
                }
            }
        };

        if (question) {
            const nl = await memory.searchWithLanguage(question);
            if (nl.success) {
                addMatches(nl.data.flatMap((r) => r.messageMatches));
            } else {
                debugError(`Unified NL search failed: ${nl.message}`);
            }
        }
        if (textQuery) {
            try {
                const text = await memory.searchByTextSimilarity(textQuery);
                addMatches(text?.messageMatches);
            } catch (e: any) {
                debugError(
                    `Unified text-similarity search failed: ${e?.message}`,
                );
            }
        }

        const messageMatches = [...scoreByOrdinal.entries()].map(
            ([messageOrdinal, score]) => ({ messageOrdinal, score }),
        );
        return rankConversationMatches(
            messageMatches,
            (ordinal) => {
                const message = memory.messages.get(ordinal);
                return {
                    text: message?.textChunks?.join(" ") ?? "",
                    conversationId: conversationIdFromTags(message?.tags ?? []),
                };
            },
            (conversationId) => this.tombstoned.has(conversationId),
            maxConversations,
            maxSnippetsPerConversation,
        );
    }

    public async waitForPendingTasks(): Promise<void> {
        await this.memory?.waitForPendingTasks();
    }

    public async close(): Promise<void> {
        // Each queued add auto-saves; just drain any in-flight work.
        await this.waitForPendingTasks();
    }
}

/** Options for {@link createConversationSearchIndex}. */
export type ConversationSearchIndexOptions = {
    /**
     * Extract entities/topics from each message as it is indexed, for richer
     * memory retrieval. Defaults to true. Tests disable it to avoid the
     * per-message extraction model call.
     */
    extractKnowledge?: boolean;
};

/**
 * Open (or create) the unified conversation search index under `dirPath`.
 * Never throws: when no model provider is configured the returned index is
 * inert, so callers can wire it unconditionally.
 */
export async function createConversationSearchIndex(
    dirPath: string,
    options?: ConversationSearchIndexOptions,
): Promise<ConversationSearchIndex> {
    const extractKnowledge = options?.extractKnowledge ?? true;
    let memory: ConversationMemory | undefined;
    try {
        // knowPro's writer does not create the target directory, so create it
        // up front. Otherwise every background auto-save fails with ENOENT and
        // the index never persists - it lives only in memory until restart.
        await mkdir(dirPath, { recursive: true });
        memory = await createConversationMemory(
            { dirPath, baseFileName: UNIFIED_MEMORY_BASENAME },
            false,
        );
    } catch (e: any) {
        debugError(
            `Unified content search disabled (memory init failed): ${e?.message}`,
        );
        memory = undefined;
    }
    if (memory !== undefined) {
        debug(`Unified conversation search index ready at ${dirPath}`);
    }
    return new ConversationSearchIndexImpl(memory, extractKnowledge);
}

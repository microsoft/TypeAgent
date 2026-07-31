// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ConversationMemory,
    ConversationMessage,
    ConversationMessageMeta,
    createConversationMemory,
} from "@typeagent/conversation-memory";
import registerDebug from "debug";

const debug = registerDebug("agent-server:conversation:searchIndex");
const debugError = registerDebug("agent-server:conversation:searchIndex:error");

// Message tag carrying the owning conversation id. A plain-string tag (knowPro
// `MessageTag = string | StructuredTag`) is enough: cross-conversation search
// runs unscoped, then reads this tag back off each matched message to group
// hits by conversation.
const CONV_TAG_PREFIX = "conv:";
const UNIFIED_MEMORY_BASENAME = "unifiedMemory";

/** A conversation whose content matched a query, with representative snippets. */
export type ConversationContentMatch = {
    conversationId: string;
    /** Best (highest) matching-message score for this conversation. */
    score: number;
    /** Top matching message texts, best first. */
    snippets: string[];
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
    /** Queue a conversation message for indexing, tagged by conversation id. */
    addMessage(conversationId: string, text: string, sender?: string): void;
    /** Exclude a (deleted) conversation from future search results. */
    tombstone(conversationId: string): void;
    /** Rank conversations by how well their content matches the query. */
    search(
        query: string,
        maxConversations?: number,
        maxSnippetsPerConversation?: number,
    ): Promise<ConversationContentMatch[]>;
    /** Await all queued indexing work (e.g. before search in tests). */
    waitForPendingTasks(): Promise<void>;
    close(): Promise<void>;
}

function conversationTag(conversationId: string): string {
    return CONV_TAG_PREFIX + conversationId;
}

export function shouldIndexConversationMessage(testMode: boolean): boolean {
    return !testMode;
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
): ConversationContentMatch[] {
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
    const results: ConversationContentMatch[] = [];
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

class ConversationSearchIndexImpl implements ConversationSearchIndex {
    private readonly tombstoned = new Set<string>();

    constructor(
        // Undefined when no model provider is configured; the index is then
        // inert (addMessage no-ops, search returns nothing) rather than failing.
        private readonly memory: ConversationMemory | undefined,
        // Extract entities/topics per message for richer retrieval. Production
        // leaves this on so memory search works well; tests turn it off.
        private readonly extractKnowledge: boolean,
        private readonly testMode: boolean,
    ) {}

    public addMessage(
        conversationId: string,
        text: string,
        sender?: string,
    ): void {
        if (
            this.memory === undefined ||
            !shouldIndexConversationMessage(this.testMode) ||
            text.trim().length === 0
        ) {
            return;
        }
        this.memory.queueAddMessage(
            new ConversationMessage(text, new ConversationMessageMeta(sender), [
                conversationTag(conversationId),
            ]),
            undefined,
            this.extractKnowledge,
        );
    }

    public tombstone(conversationId: string): void {
        this.tombstoned.add(conversationId);
    }

    public async search(
        query: string,
        maxConversations: number = 10,
        maxSnippetsPerConversation: number = 3,
    ): Promise<ConversationContentMatch[]> {
        if (this.memory === undefined || query.trim().length === 0) {
            return [];
        }
        const result = await this.memory.searchWithLanguage(query);
        if (!result.success) {
            debugError(`Unified content search failed: ${result.message}`);
            return [];
        }
        const messageMatches = result.data.flatMap((r) => r.messageMatches);
        const memory = this.memory;
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
    /** Disable indexing for isolated test shell instances. */
    testMode?: boolean;
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
    const testMode = options?.testMode ?? false;
    let memory: ConversationMemory | undefined;
    if (!testMode) {
        try {
            memory = await createConversationMemory(
                { dirPath, baseFileName: UNIFIED_MEMORY_BASENAME },
                false,
            );
        } catch (e: unknown) {
            debugError(
                `Unified content search disabled (memory init failed): ${e instanceof Error ? e.message : String(e)}`,
            );
            memory = undefined;
        }
    }
    if (memory !== undefined) {
        debug(`Unified conversation search index ready at ${dirPath}`);
    }
    return new ConversationSearchIndexImpl(memory, extractKnowledge, testMode);
}

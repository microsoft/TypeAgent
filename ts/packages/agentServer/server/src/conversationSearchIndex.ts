// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { MemoryEvent, MemoryService } from "@typeagent/memory-service";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const CORPUS_NAME = "typeagent-profile-conversations";
const PRODUCER_ID = "typeagent.agent-server.conversation-history";

export type RankedConversationContent = {
    conversationId: string;
    score: number;
    snippets: string[];
};

/** The natural-language question takes precedence over legacy keyword terms. */
export type ContentSearchQuery = {
    question?: string | undefined;
    terms?: string[] | undefined;
};

export interface ConversationSearchIndex {
    /** Only imported/historical turns belong here; the dispatcher owns live events. */
    addMessage(
        conversationId: string,
        text: string,
        sender?: string,
        turnKey?: string,
        onIndexed?: (indexed: boolean) => void,
        eventTime?: string,
    ): void;
    tombstone(conversationId: string): Promise<void>;
    reconcileTombstones(
        liveConversationIds: ReadonlySet<string>,
    ): Promise<number>;
    getIndexedTurns(conversationId: string): Promise<ReadonlySet<string>>;
    getBackfillExcludedTurns(
        conversationId: string,
        candidates?: string[],
    ): Promise<ReadonlySet<string>>;
    /** Freeze native migration eligibility before live dispatchers start writing. */
    initializeConversation(
        conversationId: string,
        historicalTurnKeys: string[],
        imported: boolean,
        sourceId?: string,
    ): Promise<void>;
    isSourceDeleted(sourceId: string): boolean;
    search(
        query: ContentSearchQuery,
        maxConversations?: number,
        maxSnippetsPerConversation?: number,
    ): Promise<RankedConversationContent[]>;
    waitForPendingTasks(): Promise<void>;
    close(): Promise<void>;
}

/** Group KnowPro scores, without another query engine or relevance adjustment. */
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
    const groups = new Map<string, RankedConversationContent>();
    for (const { messageOrdinal, score } of messageMatches) {
        const { text, conversationId } = getMessage(messageOrdinal);
        if (conversationId === undefined || isTombstoned(conversationId)) {
            continue;
        }
        let group = groups.get(conversationId);
        if (group === undefined) {
            group = { conversationId, score, snippets: [] };
            groups.set(conversationId, group);
        }
        group.score = Math.max(group.score, score);
        if (text.trim() && group.snippets.length < maxSnippetsPerConversation) {
            group.snippets.push(text.trim());
        }
    }
    return [...groups.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, maxConversations);
}

export type BackfillLogEntry = {
    type?: string;
    command?: string;
    requestId?: { requestId?: string } | undefined;
    seq?: number;
    timestamp?: number;
};

export function selectUnindexedTurns(
    entries: ReadonlyArray<BackfillLogEntry>,
    isIndexed: (turnKey: string) => boolean,
): { text: string; turnKey: string; eventTime?: string }[] {
    const turns: { text: string; turnKey: string; eventTime?: string }[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
        if (entry?.type !== "user-request") {
            continue;
        }
        const turnKey = entry.requestId?.requestId || String(entry.seq);
        if (turnKey === "undefined") {
            throw new Error(
                "Cannot backfill a conversation turn without a stable identity",
            );
        }
        if (!seen.has(turnKey) && !isIndexed(turnKey)) {
            seen.add(turnKey);
            turns.push({
                text: entry.command ?? "",
                turnKey,
                ...(entry.timestamp === undefined
                    ? {}
                    : { eventTime: new Date(entry.timestamp).toISOString() }),
            });
        }
    }
    return turns;
}

export function selectStaleConversations(
    indexedConversationIds: Iterable<string>,
    isLive: (conversationId: string) => boolean,
): string[] {
    return [...indexedConversationIds].filter((id) => !isLive(id));
}

type ReplayState = {
    consumed: string[];
    /** Undefined for imported histories, whose transcript may grow. */
    eligible?: string[];
    deleted?: boolean;
    sourceId?: string;
};

class ConversationSearchIndexImpl implements ConversationSearchIndex {
    private tail: Promise<void> = Promise.resolve();
    private saveTail: Promise<void> = Promise.resolve();
    private error: unknown;
    private corpusPromise: Promise<string> | undefined;
    private readonly state = new Map<string, ReplayState>();
    private readonly statePath: string;

    constructor(
        dirPath: string,
        private readonly service: MemoryService | undefined,
    ) {
        this.statePath = path.join(dirPath, "conversationEventReplay.json");
    }

    public async load(): Promise<void> {
        try {
            const state: Record<string, ReplayState> = JSON.parse(
                await readFile(this.statePath, "utf8"),
            );
            for (const [id, value] of Object.entries(state)) {
                this.state.set(id, value);
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                throw error;
            }
        }
    }

    public async retireLegacyFiles(): Promise<void> {
        if (this.service === undefined) {
            return;
        }
        await this.resolveCorpus();
        for (const suffix of [
            "_data.json",
            "_embeddings.bin",
            "_data.json.bak",
            "_embeddings.bin.bak",
        ]) {
            await rm(
                path.join(
                    path.dirname(this.statePath),
                    `unifiedMemory${suffix}`,
                ),
                { force: true },
            );
        }
    }

    private save(): Promise<void> {
        const saving = this.saveTail.then(async () => {
            await mkdir(path.dirname(this.statePath), { recursive: true });
            await writeFile(
                `${this.statePath}.tmp`,
                JSON.stringify(Object.fromEntries(this.state)),
            );
            await rename(`${this.statePath}.tmp`, this.statePath);
        });
        this.saveTail = saving.catch(() => {});
        return saving;
    }

    private requireService(): MemoryService {
        if (this.service === undefined) {
            throw new Error(
                "Conversation content indexing requires a durable memory service",
            );
        }
        return this.service;
    }

    private async resolveCorpus(): Promise<string> {
        this.corpusPromise ??= this.openCorpus().catch((error: unknown) => {
            this.corpusPromise = undefined;
            throw error;
        });
        return this.corpusPromise;
    }

    private async openCorpus(): Promise<string> {
        const service = this.requireService();
        const existing = (await service.listCorpora()).find(
            (corpus) => corpus.name === CORPUS_NAME,
        );
        return (
            existing ??
            (await service.createCorpus(
                CORPUS_NAME,
                "Profile-scoped conversation turns and verified outcomes",
            ))
        ).corpusId;
    }

    private async events(conversationId?: string): Promise<MemoryEvent[]> {
        const corpusId = await this.resolveCorpus();
        const events: MemoryEvent[] = [];
        let continuationToken: string | undefined;
        do {
            const page = await this.requireService().listEvents({
                corpusId,
                sourceKinds: ["conversation"],
                ...(conversationId === undefined
                    ? {}
                    : { conversationIds: [conversationId] }),
                pageSize: 100,
                ...(continuationToken === undefined
                    ? {}
                    : { continuationToken }),
            });
            events.push(...page.items);
            continuationToken = page.nextContinuationToken;
        } while (continuationToken !== undefined);
        return events;
    }

    public async initializeConversation(
        conversationId: string,
        historicalTurnKeys: string[],
        imported: boolean,
        sourceId?: string,
    ): Promise<void> {
        await this.waitForPendingTasks();
        if (!this.state.has(conversationId)) {
            this.state.set(conversationId, {
                consumed: [],
                ...(imported ? {} : { eligible: historicalTurnKeys }),
                ...(sourceId === undefined ? {} : { sourceId }),
            });
            await this.save();
        }
        const state = this.state.get(conversationId)!;
        if (sourceId !== undefined && state.sourceId === undefined) {
            state.sourceId = sourceId;
            await this.save();
        }
        if (this.service !== undefined) {
            await this.getBackfillExcludedTurns(conversationId);
        }
    }

    public isSourceDeleted(sourceId: string): boolean {
        return [...this.state.values()].some(
            (state) => state.deleted === true && state.sourceId === sourceId,
        );
    }

    public addMessage(
        conversationId: string,
        text: string,
        sender?: string,
        turnKey?: string,
        onIndexed?: (indexed: boolean) => void,
        eventTime?: string,
    ): void {
        this.tail = this.tail
            .then(async () => {
                if (sender !== "user" || !turnKey) {
                    throw new Error(
                        "History indexing requires a user turn with a stable identity",
                    );
                }
                const state = this.state.get(conversationId);
                if (state?.deleted) {
                    throw new Error(`Conversation deleted: ${conversationId}`);
                }
                if (
                    state?.eligible !== undefined &&
                    !state.eligible.includes(turnKey)
                ) {
                    onIndexed?.(false);
                    return;
                }
                const excluded =
                    await this.getBackfillExcludedTurns(conversationId);
                let indexed = false;
                if (!excluded.has(turnKey)) {
                    const replay: ReplayState = state ?? { consumed: [] };
                    // Persist suppression before append: after a crash, prefer a visible
                    // migration gap to recreating content that may have been forgotten.
                    replay.consumed.push(turnKey);
                    this.state.set(conversationId, replay);
                    await this.save();
                    try {
                        const appended =
                            await this.requireService().appendEvent({
                                corpusId: await this.resolveCorpus(),
                                idempotencyKey: JSON.stringify([
                                    conversationId,
                                    turnKey,
                                    "user-turn",
                                ]),
                                producer: {
                                    producerId: PRODUCER_ID,
                                    producerType: "conversation-history",
                                },
                                eventType: "user-turn",
                                sourceKind: "conversation",
                                conversationId,
                                turnId: turnKey,
                                sender: "user",
                                content: text,
                                ...(eventTime === undefined
                                    ? {}
                                    : { eventTime }),
                                metadata: {
                                    authority: "user-assertion",
                                    origin: "transcript-backfill",
                                    ...(replay.sourceId === undefined
                                        ? {}
                                        : { sourceSessionId: replay.sourceId }),
                                },
                            });
                        indexed = !appended.replayed;
                    } catch (error) {
                        if (
                            typeof error === "object" &&
                            error !== null &&
                            "code" in error &&
                            error.code === "EVENT_FORGOTTEN"
                        ) {
                            onIndexed?.(false);
                            return;
                        }
                        replay.consumed = replay.consumed.filter(
                            (key) => key !== turnKey,
                        );
                        await this.save();
                        throw error;
                    }
                }
                onIndexed?.(indexed);
            })
            .catch((error: unknown) => {
                this.error ??= error;
            });
    }

    public async getIndexedTurns(
        conversationId: string,
    ): Promise<ReadonlySet<string>> {
        if (this.service === undefined) {
            return new Set();
        }
        return new Set(
            (await this.events(conversationId))
                .filter(
                    (event) =>
                        event.eventType === "user-turn" &&
                        event.turnId !== undefined,
                )
                .map((event) => event.turnId!),
        );
    }

    public async getBackfillExcludedTurns(
        conversationId: string,
        candidates: string[] = [],
    ): Promise<ReadonlySet<string>> {
        const turns = new Set(await this.getIndexedTurns(conversationId));
        const state = this.state.get(conversationId);
        if (state !== undefined) {
            const consumed = new Set(state.consumed);
            for (const key of turns) {
                consumed.add(key);
            }
            if (consumed.size !== state.consumed.length) {
                state.consumed = [...consumed];
                await this.save();
            }
        }
        for (const key of state?.consumed ?? []) {
            turns.add(key);
        }
        if (state?.eligible !== undefined) {
            for (const key of candidates) {
                if (!state.eligible.includes(key)) {
                    turns.add(key);
                }
            }
        }
        return turns;
    }

    public async tombstone(conversationId: string): Promise<void> {
        await this.waitForPendingTasks();
        const state = this.state.get(conversationId) ?? { consumed: [] };
        state.deleted = true;
        this.state.set(conversationId, state);
        await this.save();
        if (this.service !== undefined) {
            await this.requireService().forgetEvents({
                corpusId: await this.resolveCorpus(),
                conversationIds: [conversationId],
            });
        }
    }

    public async reconcileTombstones(
        liveConversationIds: ReadonlySet<string>,
    ): Promise<number> {
        if (this.service === undefined) {
            return 0;
        }
        const indexed = new Set(
            (await this.events())
                .map((event) => event.conversationId)
                .filter(
                    (id): id is string =>
                        id !== undefined && this.state.has(id),
                ),
        );
        const stale = selectStaleConversations(indexed, (id) =>
            liveConversationIds.has(id),
        );
        for (const id of stale) {
            await this.tombstone(id);
        }
        return stale.length;
    }

    public async search(
        query: ContentSearchQuery,
        maxConversations = 10,
        maxSnippetsPerConversation = 3,
    ): Promise<RankedConversationContent[]> {
        await this.waitForPendingTasks();
        const question =
            query.question?.trim() || query.terms?.join(" ").trim();
        if (!question || maxConversations <= 0) {
            return [];
        }
        const result = await this.requireService().searchEvents({
            corpusId: await this.resolveCorpus(),
            query: question,
            sourceKinds: ["conversation"],
            limit: maxConversations * Math.max(maxSnippetsPerConversation, 1),
        });
        return rankConversationMatches(
            result.matches.map((match, messageOrdinal) => ({
                messageOrdinal,
                score: match.score,
            })),
            (ordinal) => ({
                text: result.matches[ordinal].snippet,
                conversationId: result.matches[ordinal].event.conversationId,
            }),
            (id) => this.state.get(id)?.deleted === true,
            maxConversations,
            maxSnippetsPerConversation,
        );
    }

    public async waitForPendingTasks(): Promise<void> {
        await this.tail;
        if (this.error !== undefined) {
            const error = this.error;
            this.error = undefined;
            throw error;
        }
    }

    public close(): Promise<void> {
        return this.waitForPendingTasks();
    }
}

export type ConversationSearchIndexOptions = {
    service?: MemoryService | undefined;
};

/** The directory holds replay identities only; KnowPro belongs to the service. */
export async function createConversationSearchIndex(
    dirPath: string,
    options?: ConversationSearchIndexOptions,
): Promise<ConversationSearchIndex> {
    const index = new ConversationSearchIndexImpl(dirPath, options?.service);
    await index.load();
    await index.retireLegacyFiles();
    return index;
}

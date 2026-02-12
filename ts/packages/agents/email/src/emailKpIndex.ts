// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Email Knowledge Processor Index
 *
 * Manages the kp index lifecycle for the email agent:
 * - Fetches emails from the provider and indexes them
 * - Persists the index to disk for fast reload
 * - Provides search via kp's QueryEngine
 * - Supports incremental indexing (new emails added to existing index)
 */

import {
    TextChunk,
    ChunkGroup,
    buildIndex,
    indexChunksIncremental,
    BuildResult,
    IncrementalStats,
    QueryEngine,
    QueryPlan,
    SearchResult,
    InvertedIndex,
    Dictionary,
    RelatedTermsMap,
    MetadataIndex,
    GroupIndex,
    ChunkStore,
    saveIndexState,
    loadIndexState,
    IndexState,
    generateAnswer,
    AnswerResult,
} from "kp";
import { IEmailProvider, EmailMessage } from "graph-utils";
import { emailsToChunks } from "./emailKpBridge.js";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { query } from "@anthropic-ai/claude-agent-sdk";

import registerDebug from "debug";
const debug = registerDebug("typeagent:email:kp");

const DEFAULT_STORAGE_DIR = path.join(
    os.homedir(),
    ".typeagent",
    "kp",
    "email",
);
const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_BACKFILL_BATCH = 50;
const MAX_BACKFILL_AGE_DAYS = 180; // 6 months
const MAX_TOTAL_EMAILS = 2000;

/**
 * Progress callback for async index operations.
 * Used to notify the UI about background indexing progress.
 */
export type IndexProgressCallback = (message: string) => void;

/**
 * Watermark state for incremental sync.
 * Stored as JSON in IndexState.watermark.
 */
interface WatermarkState {
    /** ISO datetime of the newest email we've indexed */
    newest?: string;
    /** ISO datetime of the oldest email we've indexed */
    oldest?: string;
    /** Total emails indexed so far */
    totalIndexed: number;
}

export interface EmailKpConfig {
    storagePath?: string;
    model?: string;
    maxFetchEmails?: number;
}

/**
 * Manages the kp index for the email agent.
 *
 * Usage:
 *   const kpIndex = new EmailKpIndex(config);
 *   await kpIndex.load();              // load from disk if exists
 *   await kpIndex.indexEmails(provider); // fetch + index emails
 *   const results = kpIndex.search(plan); // search the index
 */
export class EmailKpIndex {
    private storagePath: string;
    private model: string;
    private maxFetchEmails: number;

    private invertedIndex: InvertedIndex | undefined;
    private dictionary: Dictionary | undefined;
    private relatedTerms: RelatedTermsMap | undefined;
    private metadataIndex: MetadataIndex | undefined;
    private groupIndex: GroupIndex | undefined;
    private chunkStore: ChunkStore | undefined;
    private queryEngine: QueryEngine | undefined;

    private isLoaded = false;

    // Watermark state for incremental sync
    private newestIndexed: string | undefined;
    private oldestIndexed: string | undefined;
    private totalIndexed = 0;

    constructor(config?: EmailKpConfig) {
        this.storagePath = config?.storagePath ?? DEFAULT_STORAGE_DIR;
        this.model = config?.model ?? DEFAULT_MODEL;
        this.maxFetchEmails = config?.maxFetchEmails ?? 200;
    }

    /**
     * Load existing index from disk. Returns true if an index was found.
     */
    load(): boolean {
        const dbPath = path.join(this.storagePath, "chunks.db");
        const stateExists = fs.existsSync(
            path.join(this.storagePath, "index_state.json"),
        );

        if (!stateExists) {
            debug("No existing index found at %s", this.storagePath);
            return false;
        }

        debug("Loading existing index from %s", this.storagePath);

        // Load hot data (inverted index, dictionary, related terms)
        const state = loadIndexState(this.storagePath);
        if (!state) return false;

        this.invertedIndex = new InvertedIndex();
        this.invertedIndex.deserialize(state.invertedIndex);

        this.dictionary = new Dictionary();
        this.dictionary.deserialize(state.dictionary);

        this.relatedTerms = new RelatedTermsMap();
        this.relatedTerms.deserialize(state.relatedTerms);

        // Load cold data (chunks, groups)
        if (fs.existsSync(dbPath)) {
            this.chunkStore = new ChunkStore(dbPath);
        }

        // Rebuild metadata and group indexes from chunks
        this.metadataIndex = new MetadataIndex();
        this.groupIndex = new GroupIndex();

        if (this.chunkStore) {
            const groups = this.chunkStore.getAllGroups();
            for (const group of groups) {
                this.groupIndex.addGroup(group);
            }

            // Rebuild metadata from stored chunks
            const chunkCount = state.meta.chunkCount;
            for (let i = 0; i < chunkCount; i++) {
                const chunk = this.chunkStore.getChunk(i);
                if (chunk) {
                    for (const [column, values] of Object.entries(
                        chunk.metadata,
                    )) {
                        for (const value of values) {
                            this.metadataIndex.addEntry(
                                column,
                                value,
                                chunk.chunkId,
                            );
                        }
                    }
                }
            }
        }

        this.queryEngine = new QueryEngine(
            this.invertedIndex,
            this.relatedTerms,
            this.metadataIndex,
            this.groupIndex,
        );

        // Restore watermark state
        if (state.watermark) {
            try {
                const wm = JSON.parse(state.watermark) as WatermarkState;
                this.newestIndexed = wm.newest;
                this.oldestIndexed = wm.oldest;
                this.totalIndexed = wm.totalIndexed ?? 0;
            } catch {
                debug("Failed to parse watermark state");
            }
        }

        this.isLoaded = true;
        debug(
            "Index loaded: %d terms, %d dictionary entries, watermarks: newest=%s oldest=%s",
            state.meta.termCount,
            state.dictionary.length,
            this.newestIndexed ?? "none",
            this.oldestIndexed ?? "none",
        );
        return true;
    }

    /**
     * Fetch emails from the provider and build/rebuild the kp index.
     * Persists the result to disk.
     */
    async indexEmails(
        provider: IEmailProvider,
        onProgress?: IndexProgressCallback,
    ): Promise<{
        chunkCount: number;
        termCount: number;
        elapsed: number;
    }> {
        const totalStart = Date.now();

        onProgress?.(`Fetching up to ${this.maxFetchEmails} recent emails...`);
        debug("Fetching emails from provider...");
        const fetchStart = Date.now();
        const messages = await provider.getInbox(this.maxFetchEmails);
        const fetchMs = Date.now() - fetchStart;

        if (!messages || messages.length === 0) {
            onProgress?.("No emails found to index.");
            debug("No emails to index");
            return { chunkCount: 0, termCount: 0, elapsed: 0 };
        }

        onProgress?.(
            `Fetched ${messages.length} emails in ${(fetchMs / 1000).toFixed(1)}s. Converting...`,
        );
        debug("Fetched %d emails in %dms", messages.length, fetchMs);
        const { chunks, groups } = emailsToChunks(messages);

        onProgress?.(
            `Building keyword index from ${messages.length} emails (LLM enrichment)...`,
        );
        debug("Building kp index with LLM enrichment...");
        const enrichStart = Date.now();
        const enrichConfig: { onProgress?: (message: string) => void } = {};
        if (onProgress) enrichConfig.onProgress = onProgress;
        // Note: enrichment uses its own default model (Haiku) for speed;
        // this.model (Sonnet) is reserved for query planning + answer generation.
        const result = await buildIndex(chunks, groups, enrichConfig);
        const enrichMs = Date.now() - enrichStart;

        // Store hot data
        this.invertedIndex = result.invertedIndex;
        this.dictionary = result.dictionary;
        this.relatedTerms = result.relatedTerms;
        this.metadataIndex = result.metadataIndex;
        this.groupIndex = result.groupIndex;

        // Create query engine
        this.queryEngine = new QueryEngine(
            this.invertedIndex,
            this.relatedTerms,
            this.metadataIndex,
            this.groupIndex,
        );

        // Track watermarks from the fetched messages
        this.updateWatermarks(messages);

        // Persist to disk
        this.persist(chunks, groups, result);

        this.isLoaded = true;

        const totalMs = Date.now() - totalStart;
        onProgress?.(
            `Index built: ${result.stats.chunkCount} chunks, ${result.stats.indexTermCount} terms ` +
                `(fetch ${(fetchMs / 1000).toFixed(1)}s, enrich ${(enrichMs / 1000).toFixed(1)}s, total ${(totalMs / 1000).toFixed(1)}s)`,
        );
        debug(
            "Index built: %d chunks, %d terms (fetch %dms, enrich %dms, total %dms)",
            result.stats.chunkCount,
            result.stats.indexTermCount,
            fetchMs,
            enrichMs,
            totalMs,
        );

        return {
            chunkCount: result.stats.chunkCount,
            termCount: result.stats.indexTermCount,
            elapsed: totalMs,
        };
    }

    /**
     * Search the index with a QueryPlan.
     * Returns undefined if the index hasn't been built yet.
     */
    search(plan: QueryPlan): SearchResult | undefined {
        if (!this.queryEngine) {
            debug("No index loaded — cannot search");
            return undefined;
        }
        return this.queryEngine.execute(plan);
    }

    /**
     * Incrementally absorb new emails into the existing index.
     *
     * Designed to be called with emails returned by the server search.
     * Only new vocabulary (not already in the dictionary) is sent to the
     * LLM for enrichment — most words are already known (Heap's law),
     * so this is fast.
     *
     * Filters out emails already in the index (by message ID stored as
     * chunk groupId prefix).
     *
     * Returns the number of new emails absorbed, or undefined if the
     * index isn't initialized yet.
     */
    async absorbEmails(
        messages: EmailMessage[],
    ): Promise<IncrementalStats | undefined> {
        if (!this.isLoaded) {
            // No index yet — initialize empty indexes first
            this.initializeEmpty();
        }

        // Filter out emails we've already indexed (by message ID)
        const knownIds = this.getKnownMessageIds();
        const newMessages = messages.filter((m) => m.id && !knownIds.has(m.id));

        if (newMessages.length === 0) {
            debug("absorbEmails: no new emails to index");
            return {
                newChunkCount: 0,
                newKeywordCount: 0,
                newVocabularyCount: 0,
                reusedVocabularyCount: 0,
                elapsed: 0,
            };
        }

        // Assign chunk IDs starting after the current max
        const startChunkId = this.chunkStore
            ? this.chunkStore.getNextChunkId()
            : 0;

        debug(
            "absorbEmails: %d new emails (starting chunkId=%d)",
            newMessages.length,
            startChunkId,
        );

        const { chunks, groups } = emailsToChunks(newMessages, startChunkId);

        // Run incremental indexing (only enriches new vocabulary)
        const stats = await indexChunksIncremental(
            chunks,
            groups,
            this.invertedIndex!,
            this.dictionary!,
            this.relatedTerms!,
            this.metadataIndex!,
            this.groupIndex!,
            { model: this.model },
        );

        // Rebuild query engine (references same objects, just needs refresh)
        this.queryEngine = new QueryEngine(
            this.invertedIndex!,
            this.relatedTerms!,
            this.metadataIndex!,
            this.groupIndex!,
        );

        // Update watermarks from newly absorbed messages
        this.updateWatermarks(newMessages);

        // Persist new chunks to SQLite + save updated hot state
        this.persistIncremental(chunks, groups);

        debug(
            "absorbEmails: %d chunks, %d new vocab, %d reused in %dms",
            stats.newChunkCount,
            stats.newVocabularyCount,
            stats.reusedVocabularyCount,
            stats.elapsed,
        );

        return stats;
    }

    /**
     * Generate a QueryPlan from a natural language query using the LLM.
     */
    async generateQueryPlan(userQuery: string): Promise<QueryPlan> {
        const prompt = `${QUERY_PLAN_PROMPT}\n\nUser question: "${userQuery}"`;

        const queryInstance = query({
            prompt,
            options: { model: this.model },
        });

        let responseText = "";
        for await (const message of queryInstance) {
            if (message.type === "result") {
                if (message.subtype === "success") {
                    responseText = message.result || "";
                    break;
                }
            }
        }

        const jsonStart = responseText.indexOf("{");
        const jsonEnd = responseText.lastIndexOf("}");
        if (jsonStart === -1 || jsonEnd === -1) {
            throw new Error("No JSON in query plan response");
        }
        const plan = JSON.parse(
            responseText.substring(jsonStart, jsonEnd + 1),
        ) as QueryPlan;

        if (!plan.searchTerms) plan.searchTerms = [];
        if (!plan.combineOp) plan.combineOp = "and";

        return plan;
    }

    /**
     * Full pipeline: query plan → search → answer generation.
     *
     * Given the user's natural language question, generates a query plan,
     * executes it, packs the top chunks (by score, up to a char budget)
     * into a prompt, and asks the LLM for a grounded answer.
     */
    async answerQuery(userQuery: string): Promise<AnswerResult | undefined> {
        if (!this.queryEngine || !this.chunkStore) {
            debug("answerQuery: no index loaded");
            return undefined;
        }

        const plan = await this.generateQueryPlan(userQuery);
        const searchResult = this.queryEngine.execute(plan);

        if (searchResult.chunks.length === 0) {
            return {
                answer: "No relevant emails found for this question.",
                chunksUsed: 0,
                charsUsed: 0,
            };
        }

        const store = this.chunkStore;
        return generateAnswer(
            {
                userQuery,
                searchResult,
                getChunk: (id) => {
                    const c = store.getChunk(id);
                    if (!c) return undefined;
                    const result: {
                        text: string;
                        metadata?: Record<string, string[]>;
                        groupId?: string;
                        timestamp?: string;
                    } = { text: c.text, metadata: c.metadata };
                    if (c.groupId) result.groupId = c.groupId;
                    if (c.timestamp) result.timestamp = c.timestamp;
                    return result;
                },
            },
            { model: this.model },
        );
    }

    // =========================================================================
    // Incremental Sync — forward (new) and backfill (older)
    // =========================================================================

    /**
     * Sync forward: fetch emails newer than the newest watermark and absorb.
     * Call this on session start / periodically to pick up new mail.
     */
    async syncForward(
        provider: IEmailProvider,
        onProgress?: IndexProgressCallback,
    ): Promise<IncrementalStats | undefined> {
        const start = Date.now();
        const since = this.newestIndexed;
        onProgress?.(
            since
                ? `Checking for new emails since ${new Date(since).toLocaleDateString()}...`
                : "Checking for recent emails...",
        );

        const messages = await provider.getInbox(100, since);
        const fetchMs = Date.now() - start;

        if (!messages || messages.length === 0) {
            onProgress?.(
                `No new emails to index (${(fetchMs / 1000).toFixed(1)}s).`,
            );
            debug("syncForward: no new emails (%dms)", fetchMs);
            return undefined;
        }

        onProgress?.(
            `Fetched ${messages.length} new email(s) in ${(fetchMs / 1000).toFixed(1)}s. Indexing...`,
        );
        debug(
            "syncForward: %d new messages (%dms fetch)",
            messages.length,
            fetchMs,
        );

        const stats = await this.absorbEmails(messages);
        const totalMs = Date.now() - start;

        if (stats && stats.newChunkCount > 0) {
            onProgress?.(
                `Indexed ${stats.newChunkCount} new email chunk(s) in ${(totalMs / 1000).toFixed(1)}s.`,
            );
        } else {
            onProgress?.(
                `No new content to index (all duplicates, ${(totalMs / 1000).toFixed(1)}s).`,
            );
        }

        return stats;
    }

    /**
     * Backfill: fetch one batch of emails older than the oldest watermark.
     * Call this between interactions to gradually build deeper history.
     * Returns undefined if we've hit the backfill depth limit.
     */
    async backfillBatch(
        provider: IEmailProvider,
        batchSize?: number,
        onProgress?: IndexProgressCallback,
    ): Promise<IncrementalStats | undefined> {
        // Check depth limits
        if (this.totalIndexed >= MAX_TOTAL_EMAILS) {
            debug(
                "backfillBatch: hit total email limit (%d)",
                MAX_TOTAL_EMAILS,
            );
            onProgress?.("Backfill complete (email limit reached).");
            return undefined;
        }

        if (this.oldestIndexed) {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - MAX_BACKFILL_AGE_DAYS);
            if (new Date(this.oldestIndexed) < cutoff) {
                debug(
                    "backfillBatch: hit age limit (%d days)",
                    MAX_BACKFILL_AGE_DAYS,
                );
                onProgress?.("Backfill complete (age limit reached).");
                return undefined;
            }
        }

        const start = Date.now();
        const size = batchSize ?? DEFAULT_BACKFILL_BATCH;
        const before = this.oldestIndexed;

        onProgress?.(
            before
                ? `Fetching ${size} older emails (before ${new Date(before).toLocaleDateString()})...`
                : `Fetching ${size} emails for backfill...`,
        );

        const messages = await provider.getInbox(size, undefined, before);
        const fetchMs = Date.now() - start;

        if (!messages || messages.length === 0) {
            onProgress?.(
                `No older emails found. Backfill complete (${(fetchMs / 1000).toFixed(1)}s).`,
            );
            debug("backfillBatch: no older messages (%dms)", fetchMs);
            return undefined;
        }

        onProgress?.(
            `Fetched ${messages.length} older email(s) in ${(fetchMs / 1000).toFixed(1)}s. Indexing...`,
        );
        debug(
            "backfillBatch: %d older messages (%dms fetch)",
            messages.length,
            fetchMs,
        );

        const stats = await this.absorbEmails(messages);
        const totalMs = Date.now() - start;

        if (stats && stats.newChunkCount > 0) {
            onProgress?.(
                `Backfill: indexed ${stats.newChunkCount} chunk(s) in ${(totalMs / 1000).toFixed(1)}s (${this.totalIndexed} total).`,
            );
        }

        return stats;
    }

    /**
     * Whether backfill can still make progress (hasn't hit limits).
     */
    get canBackfill(): boolean {
        if (this.totalIndexed >= MAX_TOTAL_EMAILS) return false;
        if (this.oldestIndexed) {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - MAX_BACKFILL_AGE_DAYS);
            if (new Date(this.oldestIndexed) < cutoff) return false;
        }
        return true;
    }

    /**
     * Get a chunk's text by ID. Uses the SQLite store.
     */
    getChunkText(chunkId: number): string | undefined {
        return this.chunkStore?.getChunk(chunkId)?.text;
    }

    get loaded(): boolean {
        return this.isLoaded;
    }

    close(): void {
        this.chunkStore?.close();
        this.chunkStore = undefined;
        this.isLoaded = false;
    }

    // =========================================================================
    // Private
    // =========================================================================

    private persist(
        chunks: TextChunk[],
        groups: ChunkGroup[],
        result: BuildResult,
    ): void {
        debug("Persisting index to %s", this.storagePath);

        if (!fs.existsSync(this.storagePath)) {
            fs.mkdirSync(this.storagePath, { recursive: true });
        }

        // Save cold data to SQLite
        const dbPath = path.join(this.storagePath, "chunks.db");
        // Close existing store if open
        this.chunkStore?.close();
        // Remove old DB so we rebuild fresh
        if (fs.existsSync(dbPath)) {
            fs.unlinkSync(dbPath);
        }
        this.chunkStore = new ChunkStore(dbPath);
        this.chunkStore.addChunks(chunks);
        for (const group of groups) {
            this.chunkStore.addGroup(group);
        }

        // Save hot data as JSON using serialize() methods
        const invertedIndexData = result.invertedIndex.serialize();
        const dictionaryData = result.dictionary.serialize();
        const relatedTermsData = result.relatedTerms.serialize();

        const state: IndexState = {
            invertedIndex: invertedIndexData,
            dictionary: dictionaryData,
            relatedTerms: relatedTermsData,
            contacts: [],
            watermark: this.serializeWatermarks(),
            meta: {
                name: "email",
                schemaVersion: 1,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                chunkCount: chunks.length,
                termCount: result.stats.indexTermCount,
            },
        };

        saveIndexState(this.storagePath, state);
        debug("Index persisted");
    }

    /**
     * Persist new chunks incrementally (append to SQLite + save hot state).
     */
    private persistIncremental(
        chunks: TextChunk[],
        groups: ChunkGroup[],
    ): void {
        debug("Persisting incremental update to %s", this.storagePath);

        if (!fs.existsSync(this.storagePath)) {
            fs.mkdirSync(this.storagePath, { recursive: true });
        }

        // Ensure SQLite store is open
        if (!this.chunkStore) {
            const dbPath = path.join(this.storagePath, "chunks.db");
            this.chunkStore = new ChunkStore(dbPath);
        }

        // Append new chunks and groups
        this.chunkStore.addChunks(chunks);
        for (const group of groups) {
            this.chunkStore.addGroup(group);
        }

        // Save updated hot state
        this.saveHotState();
    }

    /**
     * Save the current in-memory hot state to disk.
     */
    private saveHotState(): void {
        if (!this.invertedIndex || !this.dictionary || !this.relatedTerms) {
            return;
        }

        const chunkCount = this.chunkStore?.getChunkCount() ?? 0;

        const state: IndexState = {
            invertedIndex: this.invertedIndex.serialize(),
            dictionary: this.dictionary.serialize(),
            relatedTerms: this.relatedTerms.serialize(),
            contacts: [],
            watermark: this.serializeWatermarks(),
            meta: {
                name: "email",
                schemaVersion: 1,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                chunkCount,
                termCount: this.invertedIndex.getTermCount(),
            },
        };

        saveIndexState(this.storagePath, state);
    }

    /**
     * Update watermarks from a batch of messages.
     */
    private updateWatermarks(messages: EmailMessage[]): void {
        for (const msg of messages) {
            if (!msg.receivedDateTime) continue;
            const dt = msg.receivedDateTime;
            if (!this.newestIndexed || dt > this.newestIndexed) {
                this.newestIndexed = dt;
            }
            if (!this.oldestIndexed || dt < this.oldestIndexed) {
                this.oldestIndexed = dt;
            }
        }
        // Count unique message IDs we've now indexed
        this.totalIndexed = this.getKnownMessageIds().size;
    }

    /**
     * Serialize current watermark state to JSON string.
     */
    private serializeWatermarks(): string {
        const state: WatermarkState = {
            totalIndexed: this.totalIndexed,
        };
        if (this.newestIndexed) state.newest = this.newestIndexed;
        if (this.oldestIndexed) state.oldest = this.oldestIndexed;
        return JSON.stringify(state);
    }

    /**
     * Initialize empty indexes (for first-time incremental use).
     */
    private initializeEmpty(): void {
        this.invertedIndex = new InvertedIndex();
        this.dictionary = new Dictionary();
        this.relatedTerms = new RelatedTermsMap();
        this.metadataIndex = new MetadataIndex();
        this.groupIndex = new GroupIndex();

        const dbPath = path.join(this.storagePath, "chunks.db");
        if (!fs.existsSync(this.storagePath)) {
            fs.mkdirSync(this.storagePath, { recursive: true });
        }
        this.chunkStore = new ChunkStore(dbPath);

        this.queryEngine = new QueryEngine(
            this.invertedIndex,
            this.relatedTerms,
            this.metadataIndex,
            this.groupIndex,
        );

        this.isLoaded = true;
        debug("Initialized empty index");
    }

    /**
     * Get the set of email message IDs already in the index.
     * Uses the chunk metadata "messageId" field if present,
     * or falls back to checking all chunk texts for the From: header.
     */
    private getKnownMessageIds(): Set<string> {
        const ids = new Set<string>();
        if (!this.chunkStore) return ids;

        const count = this.chunkStore.getChunkCount();
        for (let i = 0; i < count; i++) {
            const chunk = this.chunkStore.getChunk(i);
            if (chunk?.metadata?.messageId) {
                for (const id of chunk.metadata.messageId) {
                    ids.add(id);
                }
            }
        }
        return ids;
    }
}

// =========================================================================
// Query Plan Prompt (email-specific)
// =========================================================================

const QUERY_PLAN_PROMPT = `You are a search query planner. Given a natural language question about an email corpus, generate a structured query plan as JSON.

The email corpus has these metadata columns:
- sender: email address of the sender
- recipient: email addresses of recipients
- cc: email addresses of CC recipients
- subject: email subject line

Available search features:
- metadataFilters: narrow by sender, recipient, subject (ops: "equals", "contains", "domain")
- timeRange: ISO date range {start, end}
- groupFilters: filter by thread label
- searchTerms: content keywords (USE LEMMATIZED FORMS — base forms like "run" not "running", "person" not "people")
- combineOp: "and" or "or" for search terms

Output a JSON object matching this schema:
{
  "intent": "factual" | "summary" | "list" | "recall",
  "metadataFilters": [{"column": "sender", "value": "bob@x.com", "op": "contains"}],
  "timeRange": {"start": "2025-01-07", "end": "2025-01-08"},
  "groupFilters": [{"label": "payment"}],
  "searchTerms": [{"term": "lemmatized_keyword", "weight": 1.0}],
  "combineOp": "and",
  "maxResults": 10
}

Return ONLY the JSON object. Use lemmatized (base) forms for all search terms.`;

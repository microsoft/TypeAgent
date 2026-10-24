// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { lstat, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { writeRunbookJson } from "./durableRunbookJson.js";
import { redactRunbookText } from "./runbookRedaction.js";
import {
    agentSessionEventDigest,
    buildAgentSessionEpisodes,
    parseAgentSessionChunk,
} from "./agentSessionParsing.js";
import {
    distillAgentSessionEpisode,
    distillAgentSessionMemories,
    reconcileAgentMemories,
} from "./agentSessionDistillation.js";
import type {
    AgentMemoryArtifact,
    AgentMemorySearchRequest,
    AgentMemorySearchResult,
    AgentSessionDistillationModel,
    AgentSessionEpisode,
    AgentSessionImportReceipt,
    AgentSessionImportRequest,
    AgentSessionReadRequest,
    AgentSessionScope,
} from "./agentSessionTypes.js";
import type {
    DocumentIngestRequest,
    DocumentIngestResult,
    IngestionJobStatus,
    MemorySearchRequest,
    MemorySearchResult,
} from "./types.js";

interface SourceReference {
    sourceId: string;
    revisionId: string;
}

interface EpisodeWork {
    episode: AgentSessionEpisode;
    source?: SourceReference;
    memories?: AgentMemoryArtifact[];
}

interface PendingImport {
    key: string;
    hash: string;
    nextCursor: number;
    final: boolean;
    episodes: EpisodeWork[];
    seen: Record<string, string>;
    reduction?: AgentMemoryArtifact[];
}

interface StoredSession {
    schemaVersion: 1;
    scope: AgentSessionScope;
    receipt: AgentSessionImportReceipt;
    seen: Record<string, string>;
    requests: Array<{ key: string; hash: string }>;
    sources: SourceReference[];
    memories: AgentMemoryArtifact[];
    reductionMemories?: AgentMemoryArtifact[];
    pending?: PendingImport;
}

interface SessionHost {
    withIngestionGroup?(operation: () => Promise<void>): Promise<void>;
    ingestDocument(
        request: DocumentIngestRequest,
        signal?: AbortSignal,
    ): Promise<DocumentIngestResult>;
    getJob(jobId: string): Promise<IngestionJobStatus | undefined>;
    search(request: MemorySearchRequest): Promise<MemorySearchResult>;
    withEligible(
        corpusId: string,
        sources: SourceReference[],
        operation: () => Promise<void>,
    ): Promise<void>;
}

function digest(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function validateIdentifier(value: string): void {
    if (
        typeof value !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value) ||
        redactRunbookText(value) !== value
    )
        throw new Error("Agent session requires a safe bounded identifier");
}

function scopeFor(request: AgentSessionScope): AgentSessionScope {
    const scope: AgentSessionScope = {};
    for (const key of ["repository", "commit", "environment"] as const) {
        const value = request[key];
        if (value === undefined) continue;
        if (
            typeof value !== "string" ||
            !value.trim() ||
            value.length > 1000 ||
            redactRunbookText(value) !== value
        )
            throw new Error(
                `Agent session ${key} must be bounded, nonsecret text`,
            );
        scope[key] = value;
    }
    return scope;
}

function safeError(error: unknown): string {
    return redactRunbookText(
        (error instanceof Error ? error.message : String(error)).slice(0, 1800),
    );
}

async function readJson<T>(file: string): Promise<T | undefined> {
    try {
        return JSON.parse(await readFile(file, "utf8")) as T;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
            return undefined;
        throw error;
    }
}

async function directories(directory: string): Promise<string[]> {
    try {
        return (await readdir(directory, { withFileTypes: true }))
            .filter(
                (entry) =>
                    entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name),
            )
            .map((entry) => entry.name);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
    }
}

function newSession(request: AgentSessionImportRequest): StoredSession {
    return {
        schemaVersion: 1,
        scope: scopeFor(request),
        receipt: {
            schemaVersion: 1,
            corpusId: request.corpusId,
            sessionId: request.sessionId,
            importType: request.importType,
            state: "running",
            cursor: 0,
            final: false,
            sourceCount: 0,
            memoryCount: 0,
            duplicates: 0,
            losses: [],
            updatedAt: new Date().toISOString(),
        },
        seen: {},
        requests: [],
        sources: [],
        memories: [],
    };
}

export class AgentSessionStore {
    private readonly receipts = new Map<
        string,
        {
            stamp: string;
            receipt: AgentSessionImportReceipt;
            sources: SourceReference[];
        }
    >();
    private readonly admissions = new Map<string, Promise<unknown>>();
    private readonly active = new Map<
        string,
        { controller: AbortController; work: Promise<void> }
    >();
    private readonly writes = new Map<string, Promise<void>>();
    private readonly checkpointWork = new Map<string, Promise<void>>();
    private readonly removed = new Set<string>();
    private readonly failures = new Map<string, Error>();
    private readonly purging = new Set<string>();
    private closed = false;

    public constructor(
        private readonly root: string,
        private readonly host: SessionHost,
        private readonly model: () => AgentSessionDistillationModel,
    ) {}

    private location(request: AgentSessionReadRequest) {
        validateIdentifier(request.corpusId);
        validateIdentifier(request.sessionId);
        const id = digest(request.sessionId);
        return {
            key: `${request.corpusId}:${id}`,
            directory: path.join(
                this.root,
                request.corpusId,
                "agent-sessions",
                id,
            ),
            tombstone: path.join(
                this.root,
                request.corpusId,
                "agent-session-tombstones",
                `${id}.json`,
            ),
        };
    }

    private async load(
        request: AgentSessionReadRequest,
    ): Promise<StoredSession | undefined> {
        const { directory } = this.location(request);
        const stored = await readJson<StoredSession>(
            path.join(directory, "session.json"),
        );
        if (
            stored &&
            (stored.schemaVersion !== 1 ||
                stored.receipt?.corpusId !== request.corpusId ||
                stored.receipt.sessionId !== request.sessionId ||
                !Array.isArray(stored.sources) ||
                !Array.isArray(stored.memories) ||
                !Array.isArray(stored.requests))
        )
            throw new Error("Invalid agent session checkpoint");
        return stored;
    }

    private save(stored: StoredSession): Promise<void> {
        const { key, directory } = this.location(stored.receipt);
        if (this.removed.has(key))
            return Promise.reject(
                new Error("Agent session evidence was removed"),
            );
        stored.receipt.updatedAt = new Date().toISOString();
        const content = JSON.stringify(stored);
        const snapshot = {
            receipt: structuredClone(stored.receipt),
            sources: structuredClone(stored.sources),
        };
        const work = this.enqueueCheckpoint(key, async () => {
            await writeRunbookJson(
                path.join(directory, "session.json"),
                content,
                () => !this.removed.has(key),
            );
            if (!this.removed.has(key))
                this.receipts.set(key, {
                    ...snapshot,
                    stamp: await this.receiptStamp(directory),
                });
            if (this.receipts.size > 256)
                this.receipts.delete(this.receipts.keys().next().value!);
        });
        this.writes.set(key, work);
        return work;
    }

    private enqueueCheckpoint<T>(
        key: string,
        operation: () => Promise<T>,
    ): Promise<T> {
        const work = (this.checkpointWork.get(key) ?? Promise.resolve()).then(
            operation,
        );
        // Queue tails settle independently; callers still receive the original error.
        this.checkpointWork.set(
            key,
            work.then(
                () => undefined,
                () => undefined,
            ),
        );
        return work;
    }

    public async recover(corpusId: string): Promise<void> {
        validateIdentifier(corpusId);
        const root = path.join(this.root, corpusId, "agent-sessions");
        for (const id of await directories(root)) {
            const file = path.join(root, id, "session.json");
            const stored = await readJson<StoredSession>(file);
            if (!stored) throw new Error("Agent session checkpoint is missing");
            if (stored.receipt.state === "running") {
                stored.receipt.state = "failed";
                stored.receipt.error =
                    "Session import interrupted by restart; retry the same idempotency key";
                await this.save(stored);
            }
        }
    }

    public import(
        request: AgentSessionImportRequest,
    ): Promise<AgentSessionImportReceipt> {
        const { key } = this.location(request);
        const previous = this.admissions.get(key) ?? Promise.resolve();
        const operation = previous.then(() => this.admit(request));
        this.admissions.set(
            key,
            operation.catch(() => undefined),
        );
        return operation;
    }

    private async admit(
        request: AgentSessionImportRequest,
    ): Promise<AgentSessionImportReceipt> {
        if (this.closed) throw new Error("Agent session importer is closed");
        if (this.purging.has(request.corpusId))
            throw new Error("Agent session evidence removal is in progress");
        const parsed = parseAgentSessionChunk(request);
        const { key, tombstone } = this.location(request);
        if (await readJson(tombstone))
            throw new Error(
                "Agent session was invalidated by removal or replacement; use a new session identity for an explicitly reacquired import",
            );
        const stored = (await this.load(request)) ?? newSession(request);
        if (
            stored.receipt.importType !== request.importType ||
            digest(stored.scope) !== digest(scopeFor(request))
        )
            throw new Error(
                "Agent session format or applicability scope changed",
            );
        const requestKey = digest(request.idempotencyKey);
        const requestHash = digest(request);
        const prior = stored.requests.find((entry) => entry.key === requestKey);
        if (prior && prior.hash !== requestHash)
            throw new Error(
                "Agent session idempotency key has different content",
            );
        if (prior && stored.pending?.key !== requestKey)
            return structuredClone(stored.receipt);
        if (this.active.has(key)) {
            if (stored.pending?.key === requestKey)
                return structuredClone(stored.receipt);
            throw new Error(
                "Wait for the current agent session chunk to settle",
            );
        }
        if (stored.pending) {
            if (stored.pending.key !== requestKey)
                throw new Error(
                    "Retry or cancel the unfinished agent session chunk first",
                );
        } else {
            this.prepare(stored, request, parsed, requestKey, requestHash);
        }
        stored.receipt.state = "running";
        delete stored.receipt.error;
        this.failures.delete(key);
        await this.save(stored);
        const controller = new AbortController();
        const work = this.run(stored, controller.signal)
            .catch((error: unknown) => {
                this.failures.set(key, new Error(safeError(error)));
            })
            .finally(() => {
                this.active.delete(key);
            });
        this.active.set(key, { controller, work });
        return structuredClone(stored.receipt);
    }

    private prepare(
        stored: StoredSession,
        request: AgentSessionImportRequest,
        parsed: ReturnType<typeof parseAgentSessionChunk>,
        key: string,
        hash: string,
    ): void {
        if (stored.receipt.final)
            throw new Error(
                "Agent session is finalized; use a new session identity",
            );
        if (request.expectedCursor !== stored.receipt.cursor)
            throw new Error("Agent session continuation cursor changed");
        const seen: Record<string, string> = {};
        const events = parsed.events.filter((event) => {
            const eventKey = digest(event.id);
            const value = agentSessionEventDigest(event);
            const previous = stored.seen[eventKey];
            if (previous && previous !== value)
                throw new Error(
                    "Agent session event identity has conflicting content",
                );
            if (previous) {
                parsed.duplicates++;
                return false;
            }
            seen[eventKey] = value;
            return true;
        });
        if (Object.keys(stored.seen).length + events.length > 100_000)
            throw new Error(
                "Agent session exceeds the 100000-event checkpoint limit",
            );
        if (stored.receipt.losses.length + parsed.losses.length > 10_000)
            throw new Error(
                "Agent session exceeds the retained loss-receipt limit",
            );
        if (stored.requests.length >= 10_000)
            throw new Error(
                "Agent session exceeds the continuation-request limit",
            );
        stored.receipt.duplicates += parsed.duplicates;
        stored.receipt.losses.push(
            ...parsed.losses.map((loss) => ({
                ...loss,
                reason: `${loss.reason} (chunk start cursor=${request.expectedCursor}; line is chunk-relative)`,
            })),
        );
        stored.requests.push({ key, hash });
        stored.pending = {
            key,
            hash,
            nextCursor: request.expectedCursor + parsed.records,
            final: request.final === true,
            episodes: buildAgentSessionEpisodes(events).map((episode) => ({
                episode,
            })),
            seen,
        };
    }

    private async run(
        stored: StoredSession,
        signal: AbortSignal,
    ): Promise<void> {
        try {
            const pending = stored.pending;
            if (!pending)
                throw new Error("Agent session pending work is missing");
            for (
                let offset = 0;
                offset < pending.episodes.length;
                offset += 2
            ) {
                const items = pending.episodes.slice(offset, offset + 2);
                await this.retainEpisodes(stored, items, signal);
                for (const item of items) {
                    signal.throwIfAborted();
                    if (!item.source)
                        throw new Error(
                            "Agent session retained episode is missing",
                        );
                    if (!item.memories) {
                        item.memories = await distillAgentSessionEpisode(
                            {
                                ...stored.scope,
                                ...item.source,
                                episode: item.episode,
                            },
                            this.model(),
                            signal,
                        );
                        signal.throwIfAborted();
                        await this.checkpoint(stored);
                    }
                }
            }
            const incoming = pending.episodes.flatMap(
                (item) => item.memories ?? [],
            );
            if (!pending.reduction) {
                const inputs = [
                    ...(stored.reductionMemories ?? []),
                    ...incoming,
                ];
                pending.reduction =
                    !incoming.length || inputs.length < 2
                        ? inputs
                        : await distillAgentSessionMemories(
                              inputs,
                              this.model(),
                              signal,
                          );
                signal.throwIfAborted();
                await this.checkpoint(stored);
            }
            const completed = structuredClone(stored);
            completed.memories = reconcileAgentMemories(stored.memories, [
                ...incoming,
                ...pending.reduction,
            ]);
            completed.reductionMemories = pending.reduction;
            Object.assign(completed.seen, pending.seen);
            completed.receipt.cursor = pending.nextCursor;
            completed.receipt.final = pending.final;
            completed.receipt.sourceCount = stored.sources.length;
            completed.receipt.memoryCount = completed.memories.length;
            completed.receipt.state = completed.receipt.losses.length
                ? "partial"
                : "complete";
            delete completed.pending;
            await this.checkpoint(completed);
        } catch (error) {
            if (this.removed.has(this.location(stored.receipt).key)) return;
            stored.receipt.state = signal.aborted ? "cancelled" : "failed";
            stored.receipt.error = safeError(error);
            await this.save(stored);
        }
    }

    private async retainEpisodes(
        stored: StoredSession,
        items: EpisodeWork[],
        signal: AbortSignal,
    ): Promise<void> {
        const operation = async () => {
            const results = await Promise.allSettled(
                items.map(async (item) => {
                    signal.throwIfAborted();
                    item.source ??= await this.retainEpisode(
                        stored,
                        item.episode,
                        signal,
                    );
                }),
            );
            for (const item of items)
                if (
                    item.source &&
                    !stored.sources.some(
                        (entry) => entry.sourceId === item.source!.sourceId,
                    )
                )
                    stored.sources.push(item.source);
            await this.checkpoint(stored);
            for (const result of results)
                if (result.status === "rejected") throw result.reason;
        };
        if (this.host.withIngestionGroup)
            await this.host.withIngestionGroup(operation);
        else await operation();
    }

    private async retainEpisode(
        stored: StoredSession,
        episode: AgentSessionEpisode,
        signal: AbortSignal,
    ): Promise<SourceReference> {
        const sourceId = digest([
            "agent-session-episode-v1",
            stored.receipt.sessionId,
            episode.episodeId,
        ]);
        const result = await this.host.ingestDocument(
            {
                corpusId: stored.receipt.corpusId,
                source: {
                    sourceId,
                    sourceType: "text",
                    title: `Agent session ${stored.receipt.sessionId}: ${episode.episodeId.slice(0, 12)}`,
                    text: episode.text,
                    tags: ["agent-session", stored.receipt.importType],
                    metadata: {
                        agentSession: {
                            schemaVersion: 1,
                            sessionId: stored.receipt.sessionId,
                            episodeId: episode.episodeId,
                            ...stored.scope,
                        },
                    },
                },
                pipeline: {
                    updatePolicy: "skipIfUnchanged",
                    maxCharsPerChunk: 8_000,
                },
            },
            signal,
        );
        while (true) {
            signal.throwIfAborted();
            const job = await this.host.getJob(result.jobId);
            if (!job)
                throw new Error("Agent session ingestion job disappeared");
            if (job.state === "complete") break;
            if (["failed", "cancelled", "partial"].includes(job.state))
                throw new Error(
                    `Agent session episode ingestion ${job.state}: ${job.error ?? "see job receipt"}`,
                );
            await new Promise<void>((resolve) => setTimeout(resolve, 25));
        }
        const source = {
            sourceId: result.sourceId,
            revisionId: result.revisionId,
        };
        return source;
    }

    private async checkpoint(stored: StoredSession): Promise<void> {
        await this.host.withEligible(
            stored.receipt.corpusId,
            stored.sources,
            () => this.save(stored),
        );
    }

    public async get(
        request: AgentSessionReadRequest,
    ): Promise<AgentSessionImportReceipt | undefined> {
        const { key } = this.location(request);
        const stored = await this.enqueueCheckpoint(key, () =>
            this.readReceipt(request),
        );
        if (!stored) return undefined;
        await this.host.withEligible(
            request.corpusId,
            stored.sources,
            async () => {},
        );
        return structuredClone(stored.receipt);
    }

    private async readReceipt(request: AgentSessionReadRequest) {
        const { key, directory } = this.location(request);
        const failure = this.failures.get(key);
        if (failure) throw failure;
        let stamp: string;
        try {
            stamp = await this.receiptStamp(directory);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            this.receipts.delete(key);
            return undefined;
        }
        const cached = this.receipts.get(key);
        const stored =
            cached?.stamp === stamp ? cached : await this.load(request);
        if (!stored) return undefined;
        if (cached?.stamp !== stamp)
            this.receipts.set(key, {
                stamp,
                receipt: structuredClone(stored.receipt),
                sources: structuredClone(stored.sources),
            });
        if (this.receipts.size > 256)
            this.receipts.delete(this.receipts.keys().next().value!);
        return stored;
    }

    private async receiptStamp(directory: string): Promise<string> {
        const info = await lstat(path.join(directory, "session.json"), {
            bigint: true,
        });
        if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n)
            throw new Error("Unsafe agent session checkpoint");
        return `${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
    }

    public async cancel(
        request: AgentSessionReadRequest,
    ): Promise<AgentSessionImportReceipt> {
        const { key } = this.location(request);
        this.active
            .get(key)
            ?.controller.abort(new Error("Agent session import cancelled"));
        await this.active.get(key)?.work;
        const stored = await this.load(request);
        if (!stored) throw new Error("Unknown agent session import");
        if (stored.pending) {
            stored.receipt.state = "cancelled";
            stored.receipt.error =
                "Retry the same idempotency key to resume cancelled work";
            await this.save(stored);
        }
        return structuredClone(stored.receipt);
    }

    public async search(
        request: AgentMemorySearchRequest,
    ): Promise<AgentMemorySearchResult> {
        validateIdentifier(request.corpusId);
        scopeFor(request);
        if (
            typeof request.query !== "string" ||
            !request.query.trim() ||
            request.query.length > 4000 ||
            (request.limit !== undefined &&
                (!Number.isInteger(request.limit) ||
                    request.limit < 1 ||
                    request.limit > 20))
        )
            throw new Error("Invalid bounded agent memory search");
        const root = path.join(this.root, request.corpusId, "agent-sessions");
        const sessionIds = await directories(root);
        if (!sessionIds.length) return { memories: [], warnings: [] };
        const matches = await this.host.search({
            corpusId: request.corpusId,
            query: request.query,
            tags: ["agent-session"],
            limit: 50,
        });
        const sources = new Set(matches.matches.map((match) => match.sourceId));
        const memories: AgentMemoryArtifact[] = [];
        const warnings = [...matches.warnings];
        for (const id of sessionIds) {
            const stored = await readJson<StoredSession>(
                path.join(root, id, "session.json"),
            );
            if (!stored) throw new Error("Agent session checkpoint is missing");
            const scoped = Object.entries(stored.scope).every(
                ([key, value]) =>
                    request[key as keyof AgentSessionScope] === value,
            );
            if (!scoped) {
                warnings.push(
                    "Agent memory omitted: repository/commit/environment applicability was not matched",
                );
                continue;
            }
            if (
                !stored.memories.some((memory) =>
                    memory.evidence.some((entry) =>
                        sources.has(entry.sourceId),
                    ),
                )
            )
                continue;
            await this.host.withEligible(
                request.corpusId,
                stored.sources,
                async () => {
                    memories.push(
                        ...stored.memories.filter((memory) =>
                            memory.evidence.some((entry) =>
                                sources.has(entry.sourceId),
                            ),
                        ),
                    );
                },
            );
        }
        return {
            memories: structuredClone(memories.slice(0, request.limit ?? 5)),
            warnings: [...new Set(warnings)],
        };
    }

    public async purge(corpusId: string, sourceId?: string): Promise<void> {
        validateIdentifier(corpusId);
        this.purging.add(corpusId);
        try {
            await Promise.all(
                [...this.admissions.entries()]
                    .filter(([key]) => key.startsWith(`${corpusId}:`))
                    .map(([, admission]) => admission),
            );
            await this.purgeSessions(corpusId, sourceId);
        } finally {
            this.purging.delete(corpusId);
        }
    }

    private async purgeSessions(
        corpusId: string,
        sourceId?: string,
    ): Promise<void> {
        const root = path.join(this.root, corpusId, "agent-sessions");
        for (const id of await directories(root)) {
            const directory = path.join(root, id);
            const stored = await readJson<StoredSession>(
                path.join(directory, "session.json"),
            );
            if (!stored) throw new Error("Agent session checkpoint is missing");
            if (
                sourceId &&
                !stored.sources.some(
                    (source) => source.sourceId === sourceId,
                ) &&
                !stored.pending?.episodes.some(
                    (item) =>
                        digest([
                            "agent-session-episode-v1",
                            stored.receipt.sessionId,
                            item.episode.episodeId,
                        ]) === sourceId,
                )
            )
                continue;
            const { key, tombstone } = this.location(stored.receipt);
            this.removed.add(key);
            this.receipts.delete(key);
            this.failures.delete(key);
            this.active
                .get(key)
                ?.controller.abort(
                    new Error("Agent session evidence was removed"),
                );
            await this.checkpointWork.get(key);
            await this.writes.get(key);
            await writeRunbookJson(
                tombstone,
                JSON.stringify({ schemaVersion: 1, invalidated: true }),
            );
            await rm(directory, { recursive: true, force: true });
        }
    }

    public async close(): Promise<void> {
        this.closed = true;
        for (const active of this.active.values())
            active.controller.abort(
                new Error("Agent session importer is closing"),
            );
        await Promise.all([...this.active.values()].map((entry) => entry.work));
        await Promise.all(this.checkpointWork.values());
        await Promise.all(this.writes.values());
    }
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { recordSearchTiming } from "@typeagent/knowpro";

export class ReadCacheInvalidatedError extends Error {
    constructor() {
        super("Memory read cache was invalidated during preparation");
        this.name = "ReadCacheInvalidatedError";
    }
}

export class ImmutableReadCache<T> {
    private readonly entries = new Map<
        string,
        { corpusId: string; value: T; bytes: number }
    >();
    private readonly pending = new Map<
        string,
        { corpusId: string; promise: Promise<T> }
    >();
    private readonly epochs = new Map<string, number>();
    private bytes = 0;
    private closed = false;

    constructor(
        private readonly stage: string,
        private readonly maxEntries = 64,
        private readonly maxBytes = 64 * 1024 * 1024,
    ) {
        if (
            !Number.isSafeInteger(maxEntries) ||
            maxEntries < 1 ||
            !Number.isSafeInteger(maxBytes) ||
            maxBytes < 1
        )
            throw new Error("Read cache limits must be positive integers");
    }

    has(key: string): boolean {
        return this.entries.has(key);
    }

    hasSpace(bytes: number): boolean {
        return (
            !this.closed &&
            this.entries.size < this.maxEntries &&
            this.bytes + bytes <= this.maxBytes
        );
    }

    canRetain(bytes: number): boolean {
        return !this.closed && bytes <= this.maxBytes;
    }

    guard(corpusId: string): () => void {
        if (this.closed) throw new ReadCacheInvalidatedError();
        const epoch = this.epochs.get(corpusId) ?? 0;
        this.epochs.set(corpusId, epoch);
        return () => {
            if (this.closed || epoch !== (this.epochs.get(corpusId) ?? 0))
                throw new ReadCacheInvalidatedError();
        };
    }

    evict(key: string): void {
        const entry = this.entries.get(key);
        if (entry) this.bytes -= entry.bytes;
        this.entries.delete(key);
    }

    async get(
        key: string,
        corpusId: string,
        load: () => Promise<{ value: T; bytes: number }>,
    ): Promise<T> {
        const assertCurrent = this.guard(corpusId);
        const hit = this.entries.get(key);
        if (hit) {
            this.entries.delete(key);
            this.entries.set(key, hit);
            recordSearchTiming(`${this.stage}.cache`, 0, {
                corpusId,
                hit: true,
                entryBytes: hit.bytes,
            });
            return hit.value;
        }
        const shared = this.pending.get(key);
        recordSearchTiming(`${this.stage}.cache`, 0, {
            corpusId,
            hit: false,
            shared: !!shared,
        });
        if (shared) return shared.promise;
        const promise = Promise.resolve().then(async () => {
            const entry = await load();
            assertCurrent();
            if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0)
                throw new Error("Read cache entry has an invalid byte size");
            if (entry.bytes <= this.maxBytes) {
                while (
                    this.entries.size >= this.maxEntries ||
                    this.bytes + entry.bytes > this.maxBytes
                ) {
                    const oldest = this.entries.keys().next().value;
                    if (oldest === undefined) break;
                    const removed = this.entries.get(oldest)!;
                    this.bytes -= removed.bytes;
                    this.entries.delete(oldest);
                }
                this.entries.set(key, { corpusId, ...entry });
                this.bytes += entry.bytes;
            }
            return entry.value;
        });
        const work = { corpusId, promise };
        this.pending.set(key, work);
        try {
            return await promise;
        } finally {
            if (this.pending.get(key) === work) this.pending.delete(key);
        }
    }

    invalidate(corpusId?: string): void {
        const corpora = new Set([
            ...this.epochs.keys(),
            ...[...this.entries.values()].map((item) => item.corpusId),
            ...[...this.pending.values()].map((item) => item.corpusId),
        ]);
        if (corpusId) corpora.add(corpusId);
        for (const id of corpora)
            if (!corpusId || id === corpusId)
                this.epochs.set(id, (this.epochs.get(id) ?? 0) + 1);
        for (const [key, entry] of this.entries)
            if (!corpusId || entry.corpusId === corpusId) {
                this.bytes -= entry.bytes;
                this.entries.delete(key);
            }
        for (const [key, entry] of this.pending)
            if (!corpusId || entry.corpusId === corpusId)
                this.pending.delete(key);
    }

    close(): void {
        this.closed = true;
        this.invalidate();
    }
}

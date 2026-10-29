// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** Service-local, absolute-expiry LRU. Forget callers must invalidate eagerly. */
export class UnderstandingStore<T extends { corpusId: string }> {
    private readonly entries = new Map<
        string,
        {
            value: T;
            bytes: number;
            expires: number;
            timer: ReturnType<typeof setTimeout>;
        }
    >();
    private bytes = 0;
    private epoch = 0;
    private closed = false;

    constructor(private readonly now: () => number = Date.now) {}

    get version() {
        return this.epoch;
    }

    get(id: string): T {
        const entry = this.entries.get(id);
        if (!entry || entry.expires <= this.now()) {
            this.delete(id);
            throw new Error(
                "Understanding expired or unavailable; start a new question.",
            );
        }
        this.entries.delete(id);
        this.entries.set(id, entry);
        return entry.value;
    }

    put(id: string, value: T, epoch: number): number {
        if (this.closed || epoch !== this.epoch)
            throw new Error(
                "Understanding invalidated during preparation; retry.",
            );
        const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
        if (bytes > 512 * 1024)
            throw new Error("Understanding snapshot exceeds byte budget");
        this.delete(id);
        while (
            this.entries.size >= 64 ||
            this.bytes + bytes > 8 * 1024 * 1024
        ) {
            const oldest = this.entries.keys().next().value;
            if (oldest === undefined) break;
            this.delete(oldest);
        }
        const expires = this.now() + 15 * 60_000;
        const timer = setTimeout(() => this.delete(id), 15 * 60_000);
        timer.unref();
        this.entries.set(id, { value, bytes, expires, timer });
        this.bytes += bytes;
        return expires;
    }

    delete(id: string): void {
        const entry = this.entries.get(id);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.bytes -= entry.bytes;
        this.entries.delete(id);
    }

    invalidate(corpusId?: string): void {
        this.epoch++;
        for (const [id, entry] of this.entries)
            if (!corpusId || entry.value.corpusId === corpusId) this.delete(id);
    }

    close(): void {
        this.closed = true;
        this.invalidate();
    }
}

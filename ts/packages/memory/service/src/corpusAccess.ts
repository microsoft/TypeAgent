// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AsyncLocalStorage } from "node:async_hooks";

type WriteLease = { release: () => void; held: boolean; active: boolean };

export interface CommittedCorpusAccess {
    read<T>(operation: () => Promise<T>): Promise<T>;
    publish(): Promise<void>;
}

export class CorpusAccess {
    private writeTail: Promise<void> = Promise.resolve();
    private readonly readers = new Set<Promise<void>>();
    private readonly writers = new Set<Promise<unknown>>();
    private readonly lease = new AsyncLocalStorage<WriteLease>();
    private readonly snapshotReaders = new Set<Promise<void>>();

    public constructor(
        private readonly assertReadable?: () => void,
        private readonly committed?: CommittedCorpusAccess,
    ) {}

    public get isWriting(): boolean {
        const lease = this.lease.getStore();
        return !!lease?.active && lease.held;
    }

    public get isWriterContext(): boolean {
        return !!this.lease.getStore()?.active;
    }

    public read<T>(operation: () => Promise<T>): Promise<T> {
        const run = async () => {
            this.assertReadable?.();
            const value = await operation();
            this.assertReadable?.();
            return value;
        };
        if (this.committed && !this.isWriting) {
            const result = this.committed.read(run);
            const settled = result.then(
                () => {},
                () => {},
            );
            this.snapshotReaders.add(settled);
            void settled.then(() => this.snapshotReaders.delete(settled));
            return result;
        }
        const result = this.isWriting ? run() : this.writeTail.then(run);
        const settled = result.then(
            () => undefined,
            () => undefined,
        );
        this.readers.add(settled);
        void settled.then(() => this.readers.delete(settled));
        return result;
    }

    public backgroundRead<T>(operation: () => Promise<T>): Promise<T> {
        return this.lease.exit(() => this.read(operation));
    }

    public write<T>(operation: () => Promise<T>): Promise<T> {
        const reservation = this.reserve();
        const lease: WriteLease = {
            release: reservation.release,
            held: true,
            active: true,
        };
        const result = reservation.ready.then(() =>
            this.lease.run(lease, async () => {
                try {
                    const value = await operation();
                    await this.committed?.publish();
                    return value;
                } finally {
                    lease.active = false;
                    lease.release();
                }
            }),
        );
        this.writers.add(result);
        void result.then(
            () => this.writers.delete(result),
            () => this.writers.delete(result),
        );
        return result;
    }

    // Only detached preparation belongs here. Callers must revalidate before
    // installing results or continuing with state captured before the release.
    public async outsideWrite<T>(operation: () => Promise<T>): Promise<T> {
        const lease = this.lease.getStore();
        if (!lease?.active || !lease.held)
            throw new Error(
                "Detached preparation requires an exclusive writer",
            );
        await this.committed?.publish();
        lease.held = false;
        lease.release();
        try {
            return await operation();
        } finally {
            const reservation = this.reserve();
            lease.release = reservation.release;
            await reservation.ready;
            lease.held = true;
        }
    }

    private reserve(): { ready: Promise<unknown>; release: () => void } {
        const ready = Promise.all([this.writeTail, ...this.readers]);
        let release!: () => void;
        // Later readers wait behind this reservation, not detached preparation.
        this.writeTail = new Promise<void>((resolve) => {
            release = resolve;
        });
        return { ready, release };
    }

    public async idle(): Promise<void> {
        while (
            this.writers.size ||
            this.readers.size ||
            this.snapshotReaders.size
        )
            await Promise.allSettled([
                ...this.writers,
                ...this.readers,
                ...this.snapshotReaders,
            ]);
        await this.writeTail;
    }
}

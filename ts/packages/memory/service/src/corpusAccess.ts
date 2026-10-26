// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AsyncLocalStorage } from "node:async_hooks";

type WriteLease = { release: () => void; held: boolean; active: boolean };

export class CorpusAccess {
    private writeTail: Promise<void> = Promise.resolve();
    private readonly readers = new Set<Promise<void>>();
    private readonly writers = new Set<Promise<unknown>>();
    private readonly lease = new AsyncLocalStorage<WriteLease>();

    public constructor(private readonly assertReadable?: () => void) {}

    public read<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.writeTail.then(() => {
            this.assertReadable?.();
            return operation();
        });
        const settled = result.then(
            () => undefined,
            () => undefined,
        );
        this.readers.add(settled);
        void settled.then(() => this.readers.delete(settled));
        return result;
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
                    return await operation();
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
        while (this.writers.size || this.readers.size)
            await Promise.allSettled([...this.writers, ...this.readers]);
        await this.writeTail;
    }
}

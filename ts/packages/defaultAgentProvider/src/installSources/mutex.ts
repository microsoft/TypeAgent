// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Simple in-process async mutex (design §4.1, §12 Q5). Serializes the whole
// install op (resolve -> materialize -> record write) and all agents.json
// reads/writes so concurrent installs never interleave into the shared
// node_modules or the records file.
export class AsyncMutex {
    private tail: Promise<void> = Promise.resolve();

    async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
        const prev = this.tail;
        let release!: () => void;
        this.tail = new Promise<void>((resolve) => {
            release = resolve;
        });
        // Wait for the previous holder to finish before running.
        await prev;
        try {
            return await fn();
        } finally {
            release();
        }
    }
}

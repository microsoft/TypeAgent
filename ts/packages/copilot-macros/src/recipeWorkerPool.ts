// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Worker } from "node:worker_threads";

interface Assets {
    workerUrl: URL;
    quickjsModulePath?: string;
}

let assets: Assets | undefined;
let generation = 0;
const pools = new Set<RecipeWorkerPool>();

export function configureRecipeWorkerAssets(value: Assets): void {
    assets = { ...value, workerUrl: new URL(value.workerUrl.href) };
    generation++;
    for (const pool of pools) pool.invalidate();
}

interface Entry {
    worker: Worker;
    generation: number;
    busy: boolean;
    used: boolean;
    failed: boolean;
    idleTimer?: ReturnType<typeof setTimeout>;
    termination?: Promise<number>;
}

interface Waiter {
    started: number;
    signal: AbortSignal;
    abort: () => void;
    resolve: (lease: RecipeWorkerLease) => void;
    reject: (error: Error) => void;
}

export interface RecipeWorkerLease {
    worker: Worker;
    queueMs: number;
    reused: boolean;
    release(healthy: boolean): Promise<void>;
}

export class RecipeWorkerPool {
    private readonly entries = new Map<Worker, Entry>();
    private readonly waiters: Waiter[] = [];
    private closed = false;

    constructor(private readonly capacity = 8) {
        if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 8)
            throw new Error("Worker capacity must be between 1 and 8.");
        pools.add(this);
    }

    acquire(signal: AbortSignal): Promise<RecipeWorkerLease> {
        if (this.closed)
            return Promise.reject(new Error("Recipe worker owner is closed."));
        if (signal.aborted)
            return Promise.reject(new Error("Worker admission cancelled."));
        if (this.waiters.length >= 64)
            return Promise.reject(
                new Error("Recipe worker admission queue is full."),
            );
        return new Promise((resolve, reject) => {
            const waiter: Waiter = {
                started: performance.now(),
                signal,
                resolve,
                reject,
                abort: () => {
                    const index = this.waiters.indexOf(waiter);
                    if (index !== -1) this.waiters.splice(index, 1);
                    signal.removeEventListener("abort", waiter.abort);
                    reject(new Error("Worker admission cancelled."));
                },
            };
            signal.addEventListener("abort", waiter.abort, { once: true });
            this.waiters.push(waiter);
            this.drain();
        });
    }

    private create(): Entry {
        const worker = new Worker(
            assets?.workerUrl ??
                new URL("./recipeExecutorWorker.js", import.meta.url),
            {
                workerData: { quickjsModulePath: assets?.quickjsModulePath },
                resourceLimits: { maxOldGenerationSizeMb: 64, stackSizeMb: 4 },
            },
        );
        const entry: Entry = {
            worker,
            generation,
            busy: false,
            used: false,
            failed: false,
        };
        this.entries.set(worker, entry);
        worker.on("error", (error: Error) => {
            entry.failed = true;
            if (!entry.busy) console.error("Idle recipe worker failed.", error);
        });
        worker.on("exit", (code) => {
            if (!entry.busy && !entry.termination)
                console.error("Idle recipe worker exited unexpectedly.", code);
            clearTimeout(entry.idleTimer);
            this.entries.delete(worker);
            this.drain();
        });
        return entry;
    }

    private drain(): void {
        if (this.closed) return;
        while (this.waiters.length) {
            let entry = [...this.entries.values()].find(
                (value) =>
                    !value.busy &&
                    !value.failed &&
                    value.generation === generation,
            );
            if (!entry && this.entries.size >= this.capacity) return;
            const waiter = this.waiters.shift()!;
            waiter.signal.removeEventListener("abort", waiter.abort);
            try {
                entry ??= this.create();
                const selected = entry;
                clearTimeout(entry.idleTimer);
                entry.busy = true;
                entry.worker.ref();
                const reused = entry.used;
                entry.used = true;
                let released = false;
                waiter.resolve({
                    worker: entry.worker,
                    queueMs: performance.now() - waiter.started,
                    reused,
                    release: async (healthy) => {
                        if (released) return;
                        released = true;
                        if (
                            !healthy ||
                            selected.failed ||
                            this.closed ||
                            selected.generation !== generation
                        ) {
                            await this.retire(selected);
                        } else {
                            selected.busy = false;
                            selected.worker.unref();
                            selected.idleTimer = setTimeout(
                                () => this.retireIdle(selected),
                                30_000,
                            );
                            selected.idleTimer.unref();
                            this.drain();
                        }
                    },
                });
            } catch (error) {
                waiter.reject(
                    error instanceof Error ? error : new Error(String(error)),
                );
            }
        }
    }

    private retire(entry: Entry): Promise<number> {
        clearTimeout(entry.idleTimer);
        entry.failed = true;
        entry.busy = true;
        entry.termination ??= entry.worker.terminate();
        return entry.termination;
    }

    private retireIdle(entry: Entry): void {
        void this.retire(entry).catch((error: unknown) => {
            console.error("Failed to terminate an idle recipe worker.", error);
        });
    }

    invalidate(): void {
        for (const entry of this.entries.values())
            if (!entry.busy) this.retireIdle(entry);
    }

    async close(): Promise<void> {
        this.closed = true;
        pools.delete(this);
        for (const waiter of this.waiters.splice(0)) {
            waiter.signal.removeEventListener("abort", waiter.abort);
            waiter.reject(new Error("Recipe worker owner is closed."));
        }
        await Promise.all(
            [...this.entries.values()].map((entry) => this.retire(entry)),
        );
    }
}

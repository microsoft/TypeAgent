// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";
import {
    RequestBudget,
    runWithRequestBudget,
    type RequestBudgetLimits,
} from "@typeagent/aiclient";
import {
    recordSearchTiming,
    runWithSearchTiming,
    timeSearchStage,
} from "@typeagent/knowpro";

export interface MaintenanceStatus {
    mode: "automatic" | "manual";
    paused: boolean;
    settled: boolean;
    pending: string[];
    running: string[];
    failures: Array<{ key: string; error: string }>;
    deferred: Array<{ key: string; reason: string }>;
    coalesced: number;
    reason?: "deadline" | "paused" | "budget";
}

interface Work {
    corpusId: string;
    generation: string | undefined;
    execute: (signal: AbortSignal) => Promise<void>;
    queuedAt: number;
    readyAt: number;
}

export class MaintenanceScheduler {
    private readonly pending = new Map<string, Work>();
    private readonly running = new Map<string, Promise<void>>();
    private readonly failures = new Map<string, string>();
    private readonly reportedFailures = new Map<string, string>();
    private readonly parked = new Map<string, string>();
    private readonly context = new AsyncLocalStorage<AbortSignal>();
    private readonly shutdown = new AbortController();
    private timer: ReturnType<typeof setTimeout> | undefined;
    private holds = 0;
    private draining = false;
    private drainSignal: AbortSignal | undefined;
    private coalesced = 0;

    public constructor(
        private readonly blocked: (corpusId: string) => boolean,
        private readonly mode: "automatic" | "manual" = "automatic",
        private readonly budget?: RequestBudgetLimits,
    ) {
        if (mode !== "automatic" && mode !== "manual")
            throw new Error("Unsupported maintenance execution mode");
    }

    public get signal(): AbortSignal {
        return this.context.getStore() ?? this.shutdown.signal;
    }

    public isDeferred(corpusId: string): boolean {
        return (
            this.shutdown.signal.aborted ||
            this.holds > 0 ||
            (this.mode === "manual" && !this.draining) ||
            this.blocked(corpusId)
        );
    }

    public defer(): () => void {
        this.shutdown.signal.throwIfAborted();
        this.holds++;
        let released = false;
        return () => {
            if (released) return;
            released = true;
            this.holds--;
            this.wake();
        };
    }

    public request(
        corpusId: string,
        family: string,
        generation: string | undefined,
        execute: Work["execute"],
        quietMs = 0,
    ): void {
        if (this.shutdown.signal.aborted) return;
        if (!Number.isFinite(quietMs) || quietMs < 0 || quietMs > 60000)
            throw new Error(
                "Maintenance quiet period must be 0 to 60000 milliseconds",
            );
        const key = `${corpusId}:${family}`;
        if (this.pending.has(key) || this.running.has(key)) this.coalesced++;
        const prior = this.pending.get(key);
        const queuedAt = prior?.queuedAt ?? performance.now();
        this.pending.set(key, {
            corpusId,
            generation,
            execute,
            queuedAt,
            readyAt: performance.now() + quietMs,
        });
        if (!prior || prior.generation !== generation) {
            this.failures.delete(key);
            this.parked.delete(key);
        }
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        this.wake();
    }

    public wake(): void {
        if (
            this.timer ||
            this.running.size ||
            ![...this.pending].some(
                ([key, work]) =>
                    !this.parked.has(key) &&
                    !this.failures.has(key) &&
                    !this.isDeferred(work.corpusId),
            )
        )
            return;
        const earliest = Math.min(
            ...[...this.pending]
                .filter(
                    ([key, work]) =>
                        !this.parked.has(key) &&
                        !this.failures.has(key) &&
                        !this.isDeferred(work.corpusId),
                )
                .map(([, work]) => work.readyAt),
        );
        this.timer = setTimeout(
            () => {
                this.timer = undefined;
                this.dispatch();
            },
            this.draining ? 250 : Math.max(250, earliest - performance.now()),
        );
        this.timer.unref();
    }

    public cancel(corpusId: string, family: string): void {
        const key = `${corpusId}:${family}`;
        this.pending.delete(key);
        this.failures.delete(key);
        this.parked.delete(key);
        for (const target of this.reportedFailures.keys())
            if (target.startsWith(`${key}:`))
                this.reportedFailures.delete(target);
    }

    public reportFailure(
        corpusId: string,
        family: string,
        targetId: string,
        error?: string,
    ): void {
        const key = `${corpusId}:${family}:${targetId}`;
        if (error === undefined) this.reportedFailures.delete(key);
        else this.reportedFailures.set(key, error);
    }

    public park(corpusId: string, family: string, reason: string): void {
        this.parked.set(`${corpusId}:${family}`, reason);
    }

    private dispatch(): void {
        const next = [...this.pending].find(
            ([key, work]) =>
                !this.failures.has(key) &&
                !this.parked.has(key) &&
                (this.draining || work.readyAt <= performance.now()) &&
                !this.isDeferred(work.corpusId),
        );
        if (!next) {
            this.wake();
            return;
        }
        const [key, work] = next;
        const signal = this.drainSignal
            ? AbortSignal.any([this.shutdown.signal, this.drainSignal])
            : this.shutdown.signal;
        const task = Promise.resolve()
            .then(() =>
                this.context.run(signal, () =>
                    runWithSearchTiming(
                        undefined,
                        "memory.maintenance",
                        async () => {
                            signal.throwIfAborted();
                            recordSearchTiming(
                                "maintenance.queue.wait",
                                performance.now() - work.queuedAt,
                                {
                                    pending: this.pending.size,
                                    coalesced: this.coalesced,
                                },
                            );
                            const execute = () =>
                                timeSearchStage("maintenance.work", () =>
                                    work.execute(signal),
                                );
                            await (this.budget
                                ? runWithRequestBudget(
                                      new RequestBudget(this.budget),
                                      execute,
                                  )
                                : execute());
                            if (
                                this.pending.get(key) === work &&
                                !this.parked.has(key) &&
                                !this.isDeferred(work.corpusId)
                            )
                                this.pending.delete(key);
                        },
                        {
                            corpusId: work.corpusId,
                            indexGeneration: work.generation,
                        },
                    ),
                ),
            )
            .catch((error: unknown) => {
                this.failures.set(
                    key,
                    error instanceof Error ? error.message : String(error),
                );
            })
            .finally(() => {
                this.running.delete(key);
                this.wake();
            });
        this.running.set(key, task);
    }

    public status(): MaintenanceStatus {
        return {
            mode: this.mode,
            paused: this.holds > 0,
            settled:
                !this.pending.size &&
                !this.running.size &&
                !this.failures.size &&
                !this.reportedFailures.size,
            pending: [...this.pending.keys()],
            running: [...this.running.keys()],
            failures: [...this.failures, ...this.reportedFailures].map(
                ([key, error]) => ({
                    key,
                    error,
                }),
            ),
            deferred: [...this.parked].map(([key, reason]) => ({
                key,
                reason,
            })),
            coalesced: this.coalesced,
        };
    }

    public async drain(
        timeoutMs = 30_000,
        signal?: AbortSignal,
    ): Promise<MaintenanceStatus> {
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
            throw new Error("Maintenance drain timeout must be positive");
        this.shutdown.signal.throwIfAborted();
        signal?.throwIfAborted();
        if (this.draining) throw new Error("Maintenance drain already active");
        if (this.holds) return { ...this.status(), reason: "paused" };
        this.draining = true;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        const deadline = AbortSignal.timeout(timeoutMs);
        this.drainSignal = signal
            ? AbortSignal.any([deadline, signal])
            : deadline;
        try {
            this.wake();
            while (
                (this.pending.size || this.running.size) &&
                !this.failures.size
            ) {
                signal?.throwIfAborted();
                if (deadline.aborted)
                    return { ...this.status(), reason: "deadline" };
                if (
                    !this.running.size &&
                    this.pending.size &&
                    [...this.pending.keys()].every((key) =>
                        this.parked.has(key),
                    )
                )
                    return { ...this.status(), reason: "budget" };
                await delay(10);
            }
            return this.status();
        } finally {
            this.draining = false;
            this.drainSignal = undefined;
        }
    }

    public async close(): Promise<void> {
        this.shutdown.abort(new Error("Memory service is closing"));
        clearTimeout(this.timer);
        this.timer = undefined;
        await Promise.all(this.running.values());
    }
}

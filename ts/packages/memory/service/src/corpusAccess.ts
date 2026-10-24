// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AsyncLocalStorage } from "node:async_hooks";
import {
    isSearchTimingEnabled,
    recordSearchTiming,
    timeSearchStage,
} from "@typeagent/knowpro";

export type CorpusAccessPriority =
    | "critical"
    | "interactive"
    | "ingestion"
    | "maintenance";

export const corpusAccessPolicy = "foreground-fair-v1";
const ordinaryPriorities = ["interactive", "ingestion", "maintenance"] as const;
const priorityContext = new AsyncLocalStorage<CorpusAccessPriority>();
const agingAdmissions = 8;

export function withCorpusAccessPriority<T>(
    priority: CorpusAccessPriority,
    operation: () => T,
): T {
    return priorityContext.run(priority, operation);
}

type Entry = { access: "read" | "write"; run: () => void };

export class CorpusAccess {
    private readonly queues: Record<CorpusAccessPriority, Entry[]> = {
        critical: [],
        interactive: [],
        ingestion: [],
        maintenance: [],
    };
    private readonly served: Record<CorpusAccessPriority, number> = {
        critical: 0,
        interactive: 0,
        ingestion: 0,
        maintenance: 0,
    };
    private admissions = 0;
    private readers = 0;
    private writer = false;
    private readonly idleWaiters = new Set<() => void>();

    public constructor(private readonly assertReadable?: () => void) {}

    public read<T>(operation: () => Promise<T>): Promise<T> {
        return this.enqueue("read", () => {
            this.assertReadable?.();
            return operation();
        });
    }

    public write<T>(operation: () => Promise<T>): Promise<T> {
        return this.enqueue("write", operation);
    }

    private enqueue<T>(
        access: Entry["access"],
        operation: () => Promise<T>,
    ): Promise<T> {
        const priority = priorityContext.getStore() ?? "interactive";
        const queuedAt = isSearchTimingEnabled()
            ? performance.now()
            : undefined;
        return new Promise<T>((resolve, reject) => {
            if (!this.queues[priority].length)
                this.served[priority] = this.admissions;
            this.queues[priority].push({
                access,
                run: AsyncLocalStorage.bind(() => {
                    const attributes = {
                        access,
                        priority,
                        pending: this.pending,
                    };
                    if (queuedAt !== undefined)
                        recordSearchTiming(
                            "access.queue.wait",
                            performance.now() - queuedAt,
                            attributes,
                        );
                    void Promise.resolve()
                        .then(() =>
                            timeSearchStage(
                                "access.work",
                                operation,
                                attributes,
                            ),
                        )
                        .then(
                            (value) => {
                                this.release(access);
                                resolve(value);
                            },
                            (error: unknown) => {
                                this.release(access);
                                reject(error);
                            },
                        );
                }),
            });
            this.dispatch();
        });
    }

    private get pending(): number {
        return Object.values(this.queues).reduce(
            (count, queue) => count + queue.length,
            0,
        );
    }

    private nextPriority(): CorpusAccessPriority | undefined {
        if (this.queues.critical.length) return "critical";
        const waiting = ordinaryPriorities.filter(
            (priority) => this.queues[priority].length,
        );
        const aged = waiting.filter(
            (priority) =>
                this.admissions - this.served[priority] >= agingAdmissions,
        );
        aged.sort((left, right) => this.served[left] - this.served[right]);
        return aged[0] ?? waiting[0];
    }

    private dispatch(): void {
        while (!this.writer) {
            const priority = this.nextPriority();
            if (!priority) break;
            const next = this.queues[priority][0]!;
            if (next.access === "write" && this.readers) break;
            this.queues[priority].shift();
            if (priority !== "critical") this.admissions++;
            this.served[priority] = this.admissions;
            if (next.access === "write") this.writer = true;
            else this.readers++;
            next.run();
        }
        if (!this.writer && !this.readers && !this.pending) {
            for (const resolve of this.idleWaiters) resolve();
            this.idleWaiters.clear();
        }
    }

    private release(access: Entry["access"]): void {
        if (access === "write") this.writer = false;
        else this.readers--;
        this.dispatch();
    }

    public async idle(): Promise<void> {
        if (!this.writer && !this.readers && !this.pending) return;
        await new Promise<void>((resolve) => this.idleWaiters.add(resolve));
    }
}

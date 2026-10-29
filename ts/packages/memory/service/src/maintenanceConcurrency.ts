// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createLimiter } from "@typeagent/common-utils";
import { recordSearchTiming, timeSearchStage } from "@typeagent/knowpro";
import { AsyncLocalStorage } from "node:async_hooks";
import type { ChatModel } from "@typeagent/aiclient";

export interface MaintenanceConcurrency {
    builds?: number;
    modelRequests?: number;
}

export function resolveMaintenanceConcurrency(
    options: MaintenanceConcurrency = {},
): Required<MaintenanceConcurrency> {
    const builds = options.builds ?? 1;
    const modelRequests = options.modelRequests ?? 24;
    for (const [name, value, maximum] of [
        ["builds", builds, 8],
        ["modelRequests", modelRequests, 24],
    ] as const)
        if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
            throw new Error(
                `Maintenance ${name} must be an integer from 1 to ${maximum}`,
            );
    return { builds, modelRequests };
}

export type MaintenanceModelScheduler = <T>(
    work: () => Promise<T>,
    signal?: AbortSignal,
) => Promise<T>;

export function resolveMaintenanceBuildPriority(
    reserveShortSlot = false,
    prioritizeShortBuilds?: boolean,
): boolean {
    if (reserveShortSlot && prioritizeShortBuilds)
        throw new Error(
            "Short build priority and reservation cannot both be enabled",
        );
    return prioritizeShortBuilds ?? !reserveShortSlot;
}

interface BuildLease {
    long: boolean;
    release: (() => void) | undefined;
    shouldYield: () => boolean;
    acquire: (signal?: AbortSignal) => Promise<() => void>;
}

const buildLease = new AsyncLocalStorage<BuildLease>();

interface WaitingBuild {
    long: boolean;
    admit: () => void;
}

export async function yieldMaintenanceBuild(
    signal: AbortSignal,
    drain?: () => Promise<void>,
): Promise<void> {
    signal.throwIfAborted();
    const lease = buildLease.getStore();
    if (!lease?.long || !lease.shouldYield()) return;
    await drain?.();
    signal.throwIfAborted();
    if (!lease.shouldYield()) return;
    await timeSearchStage("build.checkpoint.yield", async () => {
        lease.release?.();
        lease.release = undefined;
        lease.release = await lease.acquire(signal);
        signal.throwIfAborted();
    });
}

function createMaintenanceAdmission(capacity: number, priority: boolean) {
    const waiting: WaitingBuild[] = [];
    let active = 0;
    let shortBurst = 0;
    function dispatch() {
        while (active < capacity && waiting.length) {
            const native = waiting.findIndex((entry) => entry.long);
            const short = waiting.findIndex((entry) => !entry.long);
            let index = 0;
            if (priority && short >= 0)
                index = native < 0 || shortBurst < 3 ? short : native;
            const [entry] = waiting.splice(index, 1);
            shortBurst = entry.long || native < 0 ? 0 : shortBurst + 1;
            active++;
            entry.admit();
        }
    }
    function acquire(long: boolean, signal?: AbortSignal): Promise<() => void> {
        signal?.throwIfAborted();
        return new Promise((resolve, reject) => {
            const abort = () => {
                const index = waiting.indexOf(entry);
                if (index < 0) return;
                waiting.splice(index, 1);
                signal?.removeEventListener("abort", abort);
                reject(signal?.reason);
                dispatch();
            };
            const entry: WaitingBuild = {
                long,
                admit: () => {
                    signal?.removeEventListener("abort", abort);
                    let released = false;
                    resolve(() => {
                        if (released) return;
                        released = true;
                        active--;
                        dispatch();
                    });
                },
            };
            waiting.push(entry);
            signal?.addEventListener("abort", abort, { once: true });
            dispatch();
        });
    }
    return {
        acquire,
        hasShortWaiter: () => waiting.some((entry) => !entry.long),
    };
}

export function createMaintenanceBuildScheduler(
    concurrency: number,
    reserveShortSlot = false,
    prioritizeShortBuilds?: boolean,
) {
    const priority = resolveMaintenanceBuildPriority(
        reserveShortSlot,
        prioritizeShortBuilds,
    );
    const { builds } = resolveMaintenanceConcurrency({ builds: concurrency });
    const { acquire, hasShortWaiter } = createMaintenanceAdmission(
        builds,
        priority,
    );
    async function run<T>(work: () => Promise<T>, long: boolean): Promise<T> {
        const lease: BuildLease = {
            long,
            release: await acquire(long),
            acquire: (signal) => acquire(long, signal),
            shouldYield: () => priority && hasShortWaiter(),
        };
        try {
            return await buildLease.run(lease, work);
        } finally {
            lease.release?.();
        }
    }
    const native = createLimiter(
        reserveShortSlot ? Math.max(1, builds - 1) : builds,
    );
    return <T>(work: () => Promise<T>, long: boolean): Promise<T> =>
        reserveShortSlot && long
            ? native(() => run(work, long))
            : run(work, long);
}

const extractionScheduler = new AsyncLocalStorage<MaintenanceModelScheduler>();
const extractionModels = new WeakSet<ChatModel>();

export function withMaintenanceExtraction<T>(
    scheduler: MaintenanceModelScheduler,
    work: () => T,
): T {
    return extractionScheduler.run(scheduler, work);
}

export function maintenanceExtractionModel(model: ChatModel): ChatModel {
    if (extractionModels.has(model)) return model;
    const complete = model.complete.bind(model);
    // Translators can retain the original model in a closure, so decorate it in place.
    model.complete = (...args: Parameters<ChatModel["complete"]>) => {
        const schedule = extractionScheduler.getStore();
        return schedule
            ? schedule(() => complete(...args), args[4])
            : complete(...args);
    };
    extractionModels.add(model);
    return model;
}

export function createMaintenanceModelScheduler(
    concurrency: number,
): MaintenanceModelScheduler {
    const { modelRequests } = resolveMaintenanceConcurrency({
        modelRequests: concurrency,
    });
    const { acquire } = createMaintenanceAdmission(modelRequests, false);
    return async (work, signal) => {
        signal?.throwIfAborted();
        const queued = performance.now();
        const release = await acquire(false, signal);
        try {
            signal?.throwIfAborted();
            recordSearchTiming(
                "maintenance.model.queue",
                performance.now() - queued,
            );
            return await work();
        } finally {
            release();
        }
    };
}

export function scheduleMaintenanceModel<T>(
    scheduler: MaintenanceModelScheduler | undefined,
    work: () => Promise<T>,
    signal: AbortSignal,
): Promise<T> {
    signal.throwIfAborted();
    return scheduler ? scheduler(work, signal) : work();
}

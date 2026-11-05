// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { recordSearchTiming, timeSearchStage } from "./searchTiming.js";

export type PreparedIndexingSettings = {
    workers: number;
    window: number;
    signal?: AbortSignal;
};

export async function prepareInOrder<T>(
    count: number,
    settings: PreparedIndexingSettings,
    prepare: (sequence: number, signal: AbortSignal) => Promise<T>,
    apply: (value: T, sequence: number) => void,
): Promise<void> {
    if (
        !Number.isSafeInteger(settings.workers) ||
        settings.workers < 1 ||
        !Number.isSafeInteger(settings.window) ||
        settings.window < settings.workers
    )
        throw new Error("Invalid ordered preparation worker/window limits");
    const controller = new AbortController();
    const signal = settings.signal
        ? AbortSignal.any([settings.signal, controller.signal])
        : controller.signal;
    const slots: Promise<void>[] = Array.from(
        { length: settings.workers },
        () => Promise.resolve(),
    );
    const pending = new Map<number, Promise<T>>();
    let highWater = 0;
    const admit = (sequence: number) => {
        const slot = sequence % settings.workers;
        const work = slots[slot]
            .then(async () => {
                signal.throwIfAborted();
                return timeSearchStage(
                    "ingestion.unit.prepare",
                    () => prepare(sequence, signal),
                    { sequence },
                );
            })
            .catch((error: unknown) => {
                controller.abort(error);
                throw error;
            });
        // Slot availability and result delivery have separate promises.
        slots[slot] = work.then(
            () => {},
            () => {},
        );
        pending.set(sequence, work);
        highWater = Math.max(highWater, pending.size);
    };
    try {
        for (
            let sequence = 0;
            sequence < Math.min(count, settings.window);
            sequence++
        )
            admit(sequence);
        for (let sequence = 0; sequence < count; sequence++) {
            const value = await pending.get(sequence)!;
            signal.throwIfAborted();
            timeSearchStage(
                "ingestion.unit.apply",
                () => apply(value, sequence),
                { sequence },
            );
            pending.delete(sequence);
            if (sequence + settings.window < count)
                admit(sequence + settings.window);
        }
    } finally {
        controller.abort();
        await Promise.allSettled(pending.values());
        recordSearchTiming("ingestion.window", 0, {
            window: settings.window,
            workers: settings.workers,
            highWater,
        });
    }
}

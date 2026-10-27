// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { recordSearchTiming, timeSearchStage } from "@typeagent/knowpro";

export interface OrderedTopicPacket {
    start: number;
    end: number;
    fingerprint: string;
}

type Outcome<T> =
    | { success: true; value: T }
    | { success: false; error: unknown };

export async function runOrderedTopicBatches<P extends OrderedTopicPacket, T>(
    count: number,
    concurrency: 1 | 2,
    signal: AbortSignal,
    prepare: (start: number, ordinal: number) => P,
    execute: (packet: P, signal: AbortSignal) => Promise<T>,
    commit: (packet: P, value: T, ordinal: number) => Promise<void>,
): Promise<void> {
    const pending = new Map<
        number,
        {
            packet: P;
            controller: AbortController;
            promise: Promise<Outcome<T>>;
        }
    >();
    const started = new Set<Promise<Outcome<T>>>();
    let failure: { error: unknown } | undefined;
    const abort = (reason: unknown) =>
        pending.forEach((entry) => entry.controller.abort(reason));
    const cancelled = () => abort(signal.reason);
    const checkFailure = () => {
        if (failure) throw failure.error;
    };
    signal.addEventListener("abort", cancelled, { once: true });
    function launch(packet: P) {
        signal.throwIfAborted();
        const controller = new AbortController();
        const promise: Promise<Outcome<T>> = Promise.resolve()
            .then(() => {
                controller.signal.throwIfAborted();
                return execute(packet, controller.signal);
            })
            .then(
                (value) => ({ success: true, value }),
                (error: unknown) => {
                    if (!controller.signal.aborted) {
                        failure ??= { error };
                        abort(error);
                    }
                    return { success: false, error };
                },
            );
        pending.set(packet.start, { packet, controller, promise });
        started.add(promise);
        void promise.then(() => started.delete(promise));
        return pending.get(packet.start)!;
    }
    try {
        let position = 0;
        let ordinal = 1;
        while (position < count) {
            signal.throwIfAborted();
            checkFailure();
            const packet = prepare(position, ordinal);
            let entry = pending.get(position);
            if (entry && entry.packet.fingerprint !== packet.fingerprint) {
                recordSearchTiming("topic.curation.speculation.discard", 0, {
                    ordinal,
                    reason: "packet-or-expansion-changed",
                });
                for (const [start, queued] of pending) {
                    if (start < position) continue;
                    queued.controller.abort(
                        new Error("Topic proposal superseded"),
                    );
                    pending.delete(start);
                }
                // Drain invalidated calls before reusing their worker slots.
                await Promise.all(started);
                checkFailure();
                entry = undefined;
            }
            entry ??= launch(packet);
            let next = packet.end;
            for (let slot = 1; slot < concurrency && next < count; slot++) {
                const queued =
                    pending.get(next) ?? launch(prepare(next, ordinal + slot));
                next = queued.packet.end;
            }
            const outcomePromise = entry.promise;
            const outcome = await timeSearchStage(
                "topic.curation.wait",
                () => outcomePromise,
                { ordinal },
            );
            signal.throwIfAborted();
            checkFailure();
            if (!outcome.success) throw outcome.error;
            recordSearchTiming("topic.curation.speculation.commit", 0, {
                ordinal,
                outstanding: pending.size,
            });
            await timeSearchStage(
                "topic.curation.commit",
                () => commit(packet, outcome.value, ordinal),
                { ordinal },
            );
            pending.delete(position);
            position = packet.end;
            ordinal++;
        }
    } finally {
        abort(new Error("Topic curation stopped"));
        signal.removeEventListener("abort", cancelled);
        await Promise.all(started);
    }
}

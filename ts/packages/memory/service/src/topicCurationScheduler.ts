// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { recordSearchTiming, timeSearchStage } from "@typeagent/knowpro";
import { yieldMaintenanceBuild } from "./maintenanceConcurrency.js";

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
    commit: (packet: P, value: T, ordinal: number) => Promise<void | boolean>,
): Promise<void> {
    const pending = new Map<
        number,
        {
            packet: P;
            controller: AbortController;
            promise: Promise<Outcome<T>>;
            attempt: number;
            state: { executed: boolean; completed: boolean };
        }
    >();
    const started = new Set<Promise<Outcome<T>>>();
    let failure: { error: unknown } | undefined;
    let attempts = 0;
    const abortEntry = (
        entry: NonNullable<ReturnType<typeof pending.get>>,
        reason: unknown,
    ) => {
        if (entry.controller.signal.aborted) return;
        entry.controller.abort(reason);
        recordSearchTiming("topic.curation.speculation.abort", 0, {
            attempt: entry.attempt,
            fingerprint: entry.packet.fingerprint,
            executed: entry.state.executed,
            completed: entry.state.completed,
        });
    };
    const abort = (reason: unknown) =>
        pending.forEach((entry) => abortEntry(entry, reason));
    const cancelled = () => abort(signal.reason);
    const checkFailure = () => {
        if (failure) throw failure.error;
    };
    signal.addEventListener("abort", cancelled, { once: true });
    function launch(packet: P) {
        signal.throwIfAborted();
        const controller = new AbortController();
        const attempt = ++attempts;
        const attributes = { attempt, fingerprint: packet.fingerprint };
        recordSearchTiming(
            "topic.curation.speculation.proposed",
            0,
            attributes,
        );
        const state = { executed: false, completed: false };
        const promise: Promise<Outcome<T>> = Promise.resolve()
            .then(() => {
                controller.signal.throwIfAborted();
                state.executed = true;
                recordSearchTiming(
                    "topic.curation.speculation.started",
                    0,
                    attributes,
                );
                return timeSearchStage(
                    "topic.curation.speculation.execute",
                    () => execute(packet, controller.signal),
                    attributes,
                );
            })
            .then(
                (value) => {
                    state.completed = true;
                    recordSearchTiming(
                        "topic.curation.speculation.completed",
                        0,
                        {
                            ...attributes,
                            aborted: controller.signal.aborted,
                        },
                    );
                    return { success: true, value };
                },
                (error: unknown) => {
                    recordSearchTiming(
                        "topic.curation.speculation.failed",
                        0,
                        {
                            ...attributes,
                            executed: state.executed,
                            aborted: controller.signal.aborted,
                        },
                        "error",
                    );
                    if (!controller.signal.aborted) {
                        failure ??= { error };
                        abort(error);
                    }
                    return { success: false, error };
                },
            );
        const launched = { packet, controller, promise, attempt, state };
        pending.set(packet.start, launched);
        started.add(promise);
        void promise.then(() => started.delete(promise));
        return launched;
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
                for (const [start, queued] of pending) {
                    if (start < position) continue;
                    recordSearchTiming(
                        "topic.curation.speculation.discard",
                        0,
                        {
                            ordinal,
                            attempt: queued.attempt,
                            fingerprint: queued.packet.fingerprint,
                            executed: queued.state.executed,
                            completed: queued.state.completed,
                            reason: "packet-or-expansion-changed",
                        },
                    );
                    abortEntry(queued, new Error("Topic proposal superseded"));
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
            const checkpointed = await timeSearchStage(
                "topic.curation.commit",
                () => commit(packet, outcome.value, ordinal),
                { ordinal },
            );
            recordSearchTiming("topic.curation.speculation.commit", 0, {
                ordinal,
                attempt: entry.attempt,
                fingerprint: packet.fingerprint,
                outstanding: pending.size,
                checkpointed: checkpointed === true,
            });
            if (checkpointed)
                await yieldMaintenanceBuild(signal, async () => {
                    await Promise.all(started);
                    checkFailure();
                });
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

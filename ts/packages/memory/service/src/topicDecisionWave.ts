// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createLimiter, type Limiter } from "@typeagent/common-utils";
import {
    executeTopicDecision,
    resolveTopicDecisionExecution,
    type TopicDecisionOptions,
    type TopicDecisionPacket,
} from "./topicDecision.js";

export async function executeTopicDecisionWave(
    options: TopicDecisionOptions,
    packets: TopicDecisionPacket[],
    signal: AbortSignal,
    reason: string,
    limiter: Limiter = createLimiter(
        resolveTopicDecisionExecution(options).concurrency,
    ),
) {
    signal.throwIfAborted();
    const controller = new AbortController();
    const waveSignal = AbortSignal.any([signal, controller.signal]);
    let failure: { error: unknown } | undefined;
    const results = await Promise.allSettled(
        packets.map(async (packet) => {
            const queued = performance.now();
            try {
                return await limiter(async () => {
                    waveSignal.throwIfAborted();
                    const queueMs = performance.now() - queued;
                    try {
                        return await executeTopicDecision(
                            {
                                ...options,
                                onReceipt: (receipt) =>
                                    options.onReceipt?.({
                                        ...receipt,
                                        queueMs,
                                        concurrency:
                                            resolveTopicDecisionExecution(
                                                options,
                                            ).concurrency,
                                    }),
                            },
                            packet,
                            waveSignal,
                            reason,
                        );
                    } catch (error) {
                        failure ??= { error };
                        controller.abort(error);
                        throw error;
                    }
                });
            } catch (error) {
                failure ??= { error };
                controller.abort(error);
                throw error;
            }
        }),
    );
    if (failure) throw failure.error;
    signal.throwIfAborted();
    return results.map((result) => {
        if (result.status === "rejected") throw result.reason;
        return result.value;
    });
}

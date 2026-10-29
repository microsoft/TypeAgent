// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ChatModel } from "@typeagent/aiclient";
import {
    cancellableSearchModel,
    currentSearchAbortSignal,
    runWithSearchCancellation,
} from "../src/searchCancellation.js";

test("query models receive the active abort signal and preserve rejection identity", async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    const reason = new Error("cancelled");
    const model: ChatModel = {
        completionSettings: {},
        complete: async (_prompt, _settings, _schema, _callback, signal) => {
            received = signal;
            signal?.throwIfAborted();
            return { success: true, data: "{}" };
        },
    };
    const wrapped = cancellableSearchModel(model);
    await runWithSearchCancellation(controller.signal, () =>
        wrapped.complete("query"),
    );
    expect(received).toBe(controller.signal);
    expect(currentSearchAbortSignal()).toBeUndefined();
    controller.abort(reason);
    expect(() =>
        runWithSearchCancellation(controller.signal, () =>
            wrapped.complete("query"),
        ),
    ).toThrow(reason);
});

test("concurrent query scopes do not share cancellation", async () => {
    const a = new AbortController();
    const b = new AbortController();
    const seen: AbortSignal[] = [];
    const model: ChatModel = {
        completionSettings: {},
        complete: async () => {
            await Promise.resolve();
            const signal = currentSearchAbortSignal();
            if (signal) seen.push(signal);
            return { success: true, data: "{}" };
        },
    };
    const wrapped = cancellableSearchModel(model);
    await Promise.all([
        runWithSearchCancellation(a.signal, () => wrapped.complete("a")),
        runWithSearchCancellation(b.signal, () => wrapped.complete("b")),
    ]);
    expect(seen).toEqual([a.signal, b.signal]);
});

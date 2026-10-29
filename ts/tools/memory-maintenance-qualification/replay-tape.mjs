// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
    assertReplayIdentity,
    atomicWriteJson,
    hashValue,
    positiveInteger,
} from "./replay-artifacts.mjs";

export class ReplayCaptureComplete extends Error {}
export class ReplayBudgetExceeded extends Error {}

function serializedError(error) {
    if (error === null || typeof error !== "object")
        return { name: "Error", message: String(error) };
    return {
        name: error.constructor?.name ?? error.name ?? "Error",
        message: error.message ?? String(error),
        ...(error.code === undefined ? {} : { code: error.code }),
        ...(error.failure === undefined ? {} : { failure: error.failure }),
    };
}

async function cancellable(work, signal) {
    signal.throwIfAborted();
    let abort;
    const cancelled = new Promise((_, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
    });
    try {
        return await Promise.race([Promise.resolve().then(work), cancelled]);
    } finally {
        signal.removeEventListener("abort", abort);
    }
}

export async function createReplayTape({
    mode,
    file,
    responses,
    identity,
    maxCalls = 10000,
    timeoutMs = 180000,
    signal,
    occurrences = {},
    authorizedLive = false,
}) {
    assert.ok(
        ["capture", "record", "playback"].includes(mode),
        "Invalid tape mode",
    );
    assert.ok(
        mode !== "record" || authorizedLive === true,
        "Recording requires explicit live authorization",
    );
    assert.ok(
        mode !== "playback" || responses,
        "Playback requires --responses",
    );
    maxCalls = positiveInteger(maxCalls, undefined, "max-calls");
    timeoutMs = positiveInteger(timeoutMs, undefined, "timeout-ms");
    assert.ok(
        timeoutMs <= 2147483647,
        "Replay deadline exceeds supported timer range",
    );
    assert.ok(
        identity && typeof identity === "object",
        "Replay identity is required",
    );
    identity = structuredClone(identity);
    const identityHash = hashValue(identity);
    assert.ok(
        occurrences &&
            typeof occurrences === "object" &&
            Object.values(occurrences).every(
                (count) => Number.isSafeInteger(count) && count >= 0,
            ),
        "Invalid replay occurrence cursor",
    );
    const controller = new AbortController();
    const activeSignal = signal
        ? AbortSignal.any([signal, controller.signal])
        : controller.signal;
    const timer = setTimeout(
        () => controller.abort(new Error("Replay deadline exceeded")),
        timeoutMs,
    );
    const counts = new Map(Object.entries(occurrences));
    const calls = [];
    const checks = new Map();
    const inspections = new Map();
    let recordedChecks;
    let recordedInspections;
    let providerCalls = 0,
        closed = false,
        writing = Promise.resolve();
    const snapshot = () => ({
        schemaVersion: 1,
        budget: { maxCalls, timeoutMs },
        identity,
        calls: structuredClone(calls),
        occurrences: Object.fromEntries(counts),
        providerCalls,
        checks: Object.fromEntries(checks),
        inspections: Object.fromEntries(inspections),
    });
    const flush = () => {
        const document = snapshot();
        writing = writing.then(() => atomicWriteJson(file, document));
        return writing;
    };
    let recorded;
    try {
        if (mode === "playback") {
            const source = JSON.parse(await readFile(responses, "utf8"));
            assert.equal(source.schemaVersion, 1);
            assertReplayIdentity(source.identity, identity);
            recorded = new Map();
            recordedChecks = source.checks ?? {};
            recordedInspections = source.inspections ?? {};
            for (const call of source.calls) {
                assert.equal(
                    call.requestHash,
                    hashValue(call.binding),
                    "Recorded request binding changed",
                );
                const key = `${call.requestHash}:${call.occurrence}`;
                assert.ok(
                    !recorded.has(key),
                    "Duplicate recorded request occurrence",
                );
                recorded.set(key, call);
            }
        }
        await flush();
    } catch (error) {
        clearTimeout(timer);
        throw error;
    }
    return {
        mode,
        budget: { maxCalls, timeoutMs },
        signal: activeSignal,
        occurrences: () => Object.fromEntries(counts),
        get providerCalls() {
            return providerCalls;
        },
        inspectRequest(
            binding,
            inspect,
            reviveError = (error) =>
                Object.assign(new Error(error.message), error),
        ) {
            assert.ok(!closed, "Replay tape is closed");
            activeSignal.throwIfAborted();
            const frozen = JSON.parse(JSON.stringify(binding));
            const key = hashValue(frozen);
            if (mode === "capture") {
                inspections.set(key, { binding: frozen, status: "captured" });
                throw new ReplayCaptureComplete(
                    "Generative inspection captured without provider initialization",
                );
            }
            if (mode === "playback") {
                const saved = recordedInspections[key];
                assert.ok(
                    saved,
                    "Recorded generative inspection does not match",
                );
                assert.deepEqual(
                    saved.binding,
                    frozen,
                    "Recorded generative inspection binding changed",
                );
                if (saved.status === "failed") throw reviveError(saved.error);
                assert.equal(
                    saved.status,
                    "complete",
                    "Recorded generative inspection is incomplete",
                );
                assert.equal(
                    saved.resultHash,
                    hashValue(saved.result),
                    "Recorded generative wire inspection changed",
                );
                inspections.set(key, saved);
                return structuredClone(saved.result);
            }
            try {
                const result = inspect();
                inspections.set(key, {
                    binding: frozen,
                    status: "complete",
                    result: structuredClone(result),
                    resultHash: hashValue(result),
                });
                return result;
            } catch (error) {
                inspections.set(key, {
                    binding: frozen,
                    status: "failed",
                    error: serializedError(error),
                });
                throw error;
            }
        },
        nativeCheck(binding, work, reviveError) {
            assert.ok(!closed, "Replay tape is closed");
            activeSignal.throwIfAborted();
            if (mode === "capture") return;
            const frozen = JSON.parse(JSON.stringify(binding));
            const key = hashValue(frozen);
            if (mode === "playback") {
                const saved = recordedChecks[key];
                assert.ok(
                    saved,
                    "Recorded native admission check does not match",
                );
                assert.deepEqual(
                    saved.binding,
                    frozen,
                    "Recorded native admission binding changed",
                );
                checks.set(key, saved);
                if (saved.error) throw reviveError(saved.error);
            } else {
                try {
                    work();
                    checks.set(key, { binding: frozen });
                } catch (error) {
                    checks.set(key, {
                        binding: frozen,
                        error: serializedError(error),
                    });
                    throw error;
                }
            }
        },
        async invoke(kind, binding, invokeProvider, requestSignal) {
            assert.ok(!closed, "Replay tape is closed");
            const effectiveSignal = requestSignal
                ? AbortSignal.any([activeSignal, requestSignal])
                : activeSignal;
            effectiveSignal.throwIfAborted();
            if (calls.length >= maxCalls)
                throw new ReplayBudgetExceeded("Replay call limit reached");
            const frozen = JSON.parse(
                JSON.stringify({ ...binding, kind, identityHash }),
            );
            const requestHash = hashValue(frozen);
            const occurrence = (counts.get(requestHash) ?? 0) + 1;
            counts.set(requestHash, occurrence);
            const row = {
                ordinal: calls.length + 1,
                requestHash,
                occurrence,
                binding: frozen,
                status: "pending",
            };
            calls.push(row);
            try {
                await flush();
                if (mode === "capture") {
                    row.status = "captured";
                    throw new ReplayCaptureComplete(
                        "Request captured without provider initialization",
                    );
                }
                let result;
                if (mode === "playback") {
                    const saved = recorded.get(`${requestHash}:${occurrence}`);
                    assert.ok(
                        saved,
                        "Recorded response does not match request identity or occurrence",
                    );
                    assert.deepEqual(
                        saved.binding,
                        frozen,
                        "Recorded response binding does not match",
                    );
                    if (saved.status === "failed") {
                        assert.ok(saved.error, "Recorded failure is missing");
                        throw Object.assign(
                            new Error(saved.error.message),
                            saved.error,
                        );
                    }
                    assert.equal(
                        saved.status,
                        "complete",
                        "Recorded response is incomplete",
                    );
                    assert.equal(
                        saved.resultHash,
                        hashValue(saved.result),
                        "Recorded response changed",
                    );
                    result = structuredClone(saved.result);
                } else {
                    providerCalls++;
                    result = await cancellable(
                        () => invokeProvider(effectiveSignal),
                        effectiveSignal,
                    );
                }
                effectiveSignal.throwIfAborted();
                row.status = "complete";
                row.result = structuredClone(result);
                row.resultHash = hashValue(result);
                return result;
            } catch (error) {
                if (row.status !== "captured") row.status = "failed";
                row.error = serializedError(error);
                throw error;
            } finally {
                await flush();
            }
        },
        async close() {
            if (closed) return;
            closed = true;
            clearTimeout(timer);
            controller.abort(new Error("Replay finished"));
            await flush();
        },
    };
}

export function nativeReplayModel(
    tape,
    identity,
    modelFactory,
    reviveError = (error) => Object.assign(new Error(error.message), error),
) {
    identity = structuredClone(identity);
    let model;
    const getModel = () => {
        model ??= modelFactory();
        assertReplayIdentity(
            {
                provider: model.provider,
                providerSource: model.providerSource,
                model: model.model,
                configGeneration: model.configGeneration,
            },
            identity,
        );
        return model;
    };
    return {
        ...identity,
        checkRequest(request) {
            return tape.nativeCheck(
                { model: identity, request },
                () => getModel().checkRequest?.(request),
                reviveError,
            );
        },
        decide(request, options) {
            const frozenRequest = structuredClone(request);
            return tape.invoke(
                "native",
                { model: identity, request: frozenRequest },
                (signal) =>
                    getModel().decide(frozenRequest, { ...options, signal }),
                options?.signal,
            );
        },
    };
}

export function generativeReplayCompletion(tape, identity, completeFactory) {
    identity = structuredClone(identity);
    let complete;
    return (rules, payload, signal, timingName, ordinal, schema) => {
        const frozenPayload = structuredClone(payload),
            frozenSchema = structuredClone(schema);
        return tape.invoke(
            "generative",
            {
                model: identity,
                rules,
                payload: frozenPayload,
                schema: frozenSchema,
            },
            (effectiveSignal) => {
                complete ??= completeFactory();
                return complete(
                    rules,
                    frozenPayload,
                    effectiveSignal,
                    timingName,
                    ordinal,
                    frozenSchema,
                );
            },
            signal,
        );
    };
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";

export async function boundedJudge(
    model,
    instructions,
    packet,
    schema,
    signal,
    capture,
) {
    signal.throwIfAborted();
    const messages = [
        { role: "system", content: instructions },
        { role: "user", content: JSON.stringify(packet) },
    ];
    const trace = { messages, schema, startedEpochMs: Date.now() };
    const started = performance.now();
    try {
        assert.equal(
            typeof model.inspectRequest,
            "function",
            "Judge requires complete-request context preflight",
        );
        const format = { name: "wiki_quality", strict: true, schema };
        trace.inspection = model.inspectRequest(messages, format);
        assert.ok(
            trace.inspection.constraints?.metadata === "configured",
            "Judge needs configured context/output/safety bounds",
        );
        const bounds = trace.inspection.constraints;
        assert.ok(
            bounds.declaredLimits &&
                (bounds.declaredLimits.inputTokens ||
                    bounds.declaredLimits.contextTokens),
            "Judge needs explicit input or context ceilings",
        );
        trace.response = await model.complete(
            messages,
            undefined,
            format,
            undefined,
            signal,
        );
        assert.ok(trace.response.success, trace.response.message);
        signal.throwIfAborted();
        return JSON.parse(trace.response.data);
    } catch (error) {
        trace.error = { name: error.name, message: error.message };
        throw error;
    } finally {
        trace.durationMs = performance.now() - started;
        await capture?.(trace);
    }
}

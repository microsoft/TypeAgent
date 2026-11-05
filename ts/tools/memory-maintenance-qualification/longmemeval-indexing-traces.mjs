// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";

export function createTraceSummary() {
    const stages = new Map();
    return {
        add(span) {
            assert.equal(typeof span.stage, "string");
            assert.ok(span.stage.length);
            assert.ok(Number.isFinite(span.elapsedMs) && span.elapsedMs >= 0);
            let stage = stages.get(span.stage);
            if (!stage) {
                stage = {
                    stage: span.stage,
                    representation: "aggregated-spans",
                    spanCount: 0,
                    totalElapsedMs: 0,
                    minElapsedMs: span.elapsedMs,
                    maxElapsedMs: span.elapsedMs,
                    statuses: new Map(),
                    metadata: new Map(),
                };
                stages.set(span.stage, stage);
            }
            stage.spanCount++;
            stage.totalElapsedMs += span.elapsedMs;
            stage.minElapsedMs = Math.min(stage.minElapsedMs, span.elapsedMs);
            stage.maxElapsedMs = Math.max(stage.maxElapsedMs, span.elapsedMs);
            const status = span.status ?? "unobserved";
            stage.statuses.set(status, (stage.statuses.get(status) ?? 0) + 1);
            for (const [name, value] of Object.entries(span.metadata ?? {})) {
                if (typeof value !== "number") continue;
                assert.ok(Number.isFinite(value), "Nonfinite trace metadata");
                const observed = stage.metadata.get(name) ?? {
                    observations: 0,
                    min: value,
                    max: value,
                };
                observed.observations++;
                observed.min = Math.min(observed.min, value);
                observed.max = Math.max(observed.max, value);
                stage.metadata.set(name, observed);
            }
        },
        summaries() {
            return [...stages.values()].map(
                ({ statuses, metadata, ...stage }) => ({
                    ...stage,
                    statusCounts: Object.fromEntries(statuses),
                    numericMetadata: Object.fromEntries(
                        [...metadata].map(([key, value]) => [
                            key,
                            { ...value },
                        ]),
                    ),
                }),
            );
        },
    };
}

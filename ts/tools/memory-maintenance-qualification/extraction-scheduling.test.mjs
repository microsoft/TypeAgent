// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import {
    simulateExtraction,
    syntheticExtractionParts,
} from "./extraction-scheduling.mjs";

test("lookahead removes batch barriers without weakening owner/revision dependencies", () => {
    for (const count of [24, 536]) {
        const parts = syntheticExtractionParts(count);
        const baseline = simulateExtraction(parts, false);
        const candidate = simulateExtraction(parts, true);
        assert.equal(candidate.outputDigest, baseline.outputDigest);
        assert.equal(candidate.attempts, count);
        assert.ok(candidate.peak <= 8);
        assert.ok(candidate.wallMs < baseline.wallMs);
        const tasks = new Map(
            candidate.observations.map((task) => [task.id, task]),
        );
        for (const task of tasks.values())
            if (task.predecessor)
                assert.ok(task.startMs >= tasks.get(task.predecessor).endMs);
        for (let i = 1; i < candidate.endpoints.length; i++)
            for (const part of parts.filter(
                (part) => part.group === candidate.endpoints[i].group,
            ))
                assert.ok(
                    tasks.get(part.id).startMs >=
                        candidate.endpoints[i - 1].extractionReadyMs,
                );
    }
});

test("a single temporal chain has no lookahead benefit", () => {
    const parts = syntheticExtractionParts(24).map((part) => ({
        ...part,
        owner: "one-chain",
        revision: "one-source",
    }));
    assert.equal(
        simulateExtraction(parts, true).wallMs,
        simulateExtraction(parts, false).wallMs,
    );
});

test("fixed two-batch windows do not start a later window before the current one drains", () => {
    const parts = syntheticExtractionParts(48);
    const result = simulateExtraction(parts, true, 8, "fixed");
    const observations = new Map(
        result.observations.map((task) => [task.id, task]),
    );
    for (const group of new Set(parts.map((part) => part.group))) {
        const current = parts.filter((part) => part.group === group);
        const firstWindowEnd = Math.max(
            ...current
                .slice(0, 16)
                .map((part) => observations.get(part.id).endMs),
        );
        for (const part of current.slice(16))
            assert.ok(observations.get(part.id).startMs >= firstWindowEnd);
    }
    assert.equal(
        result.outputDigest,
        simulateExtraction(parts, false).outputDigest,
    );
    assert.throws(() => simulateExtraction(parts, true, 8, "unknown"));
});

test("invalid identity, duration and group order fail closed", () => {
    const parts = syntheticExtractionParts(24);
    assert.throws(
        () => simulateExtraction([parts[0], parts[0]], true),
        /Duplicate/,
    );
    assert.throws(() =>
        simulateExtraction([{ ...parts[0], durationMs: NaN }], true),
    );
    assert.throws(
        () =>
            simulateExtraction(
                [parts[0], { ...parts[1], group: "other" }, parts[2]],
                true,
            ),
        /contiguous/,
    );
});

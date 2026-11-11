// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { hashValue } from "./replay-artifacts.mjs";

function extractionGroups(parts) {
    assert.ok(Array.isArray(parts) && parts.length > 0);
    const groups = [];
    const seenGroups = new Set();
    const identities = new Set();
    for (const part of parts) {
        assert.ok(typeof part.id === "string" && part.id.length > 0);
        assert.ok(!identities.has(part.id), "Duplicate part identity");
        identities.add(part.id);
        assert.ok(typeof part.group === "string" && part.group.length > 0);
        assert.ok(typeof part.owner === "string" && part.owner.length > 0);
        assert.ok(
            typeof part.revision === "string" && part.revision.length > 0,
        );
        assert.ok(Number.isFinite(part.durationMs) && part.durationMs > 0);
        if (groups.at(-1)?.[0].group !== part.group) {
            assert.ok(!seenGroups.has(part.group), "Groups must be contiguous");
            seenGroups.add(part.group);
            groups.push([]);
        }
        groups.at(-1).push(part);
    }
    return groups;
}

export function simulateExtraction(
    parts,
    lookahead,
    capacity = 8,
    windowMode = "sliding",
) {
    assert.equal(typeof lookahead, "boolean");
    assert.ok(Number.isSafeInteger(capacity) && capacity > 0);
    assert.ok(["sliding", "fixed"].includes(windowMode));
    const groups = extractionGroups(parts);
    let clock = 0,
        peak = 0;
    const observations = [];
    const endpoints = [];
    const predecessors = new Map();
    const completed = new Map();
    for (const group of groups) {
        assert.ok(
            new Set(group.map(({ revision }) => revision)).size <= 2,
            "Group exceeds two source revisions",
        );
        const tasks = group.map((part, ordinal) => {
            const chain = JSON.stringify([part.revision, part.owner]);
            const predecessor = predecessors.get(chain);
            predecessors.set(chain, part.id);
            return { ...part, ordinal, predecessor };
        });
        const pending = [...tasks];
        const running = new Map();
        while (pending.length || running.size) {
            const firstUnfinished = Math.min(
                ...pending.map((part) => part.ordinal),
                ...[...running.values()].map(({ part }) => part.ordinal),
            );
            const firstBatch = Math.floor(firstUnfinished / capacity);
            const lookaheadEnd =
                windowMode === "fixed"
                    ? (Math.floor(firstUnfinished / (capacity * 2)) + 1) *
                      capacity *
                      2
                    : firstUnfinished + capacity * 2;
            for (let i = 0; i < pending.length && running.size < capacity; ) {
                const part = pending[i];
                if (
                    (lookahead && part.ordinal >= lookaheadEnd) ||
                    (!lookahead &&
                        Math.floor(part.ordinal / capacity) !== firstBatch) ||
                    (part.predecessor && !completed.has(part.predecessor))
                ) {
                    i++;
                    continue;
                }
                pending.splice(i, 1);
                running.set(part.id, {
                    part,
                    startMs: clock,
                    endMs: clock + part.durationMs,
                });
            }
            assert.ok(running.size, "No schedulable work");
            peak = Math.max(peak, running.size);
            clock = Math.min(
                ...[...running.values()].map((task) => task.endMs),
            );
            for (const [id, task] of running) {
                if (task.endMs !== clock) continue;
                running.delete(id);
                const evidence = task.part.predecessor
                    ? completed.get(task.part.predecessor)
                    : null;
                const output = hashValue([id, evidence]);
                completed.set(id, output);
                observations.push({
                    id,
                    predecessor: task.part.predecessor ?? null,
                    startMs: task.startMs,
                    endMs: task.endMs,
                    output,
                });
            }
        }
        endpoints.push({ group: group[0].group, extractionReadyMs: clock });
    }
    const outputs = parts.map(({ id }) => [id, completed.get(id)]);
    return {
        wallMs: clock,
        peak,
        attempts: observations.length,
        lookaheadLimit: capacity * (lookahead ? 2 : 1),
        outputDigest: hashValue(outputs),
        observations,
        endpoints,
    };
}

export function syntheticExtractionParts(count) {
    assert.ok(Number.isSafeInteger(count) && count > 0);
    return Array.from({ length: count }, (_, ordinal) => {
        const offset = ordinal % 24;
        const group = String(Math.floor(ordinal / 24));
        return {
            id: `part-${ordinal}`,
            group,
            revision: `source-${group}-${offset < 12 ? 0 : 1}`,
            owner: offset < 9 ? "long-chain" : `independent-${offset % 5}`,
            durationMs: offset < 9 ? 20 : 8 + (ordinal % 7),
        };
    });
}

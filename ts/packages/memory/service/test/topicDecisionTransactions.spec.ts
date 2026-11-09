// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    applyTopicTransaction,
    createTopicTransaction,
} from "../src/topicDecisionTransactions.js";
import type { TopicConcept, TopicCuration } from "../src/topicTypes.js";

function concept(id: string, member = id): TopicConcept {
    return {
        id,
        label: id,
        scope: "Reference",
        purpose: "Understand",
        memberIds: [member],
        citations: [],
        salience: 4,
        summary: "",
    };
}
const empty = (): TopicCuration => ({ concepts: [], deferred: [] });

test("disjoint inserts and deferred appends merge without lost updates", () => {
    const base = empty();
    const current = {
        concepts: [concept("a")],
        deferred: [{ nodeId: "d0", reason: "low" }],
    };
    const staged = {
        concepts: [concept("b")],
        deferred: [{ nodeId: "d1", reason: "low" }],
    };
    const merged = applyTopicTransaction(
        current,
        createTopicTransaction(base, staged, new Set(), false),
    );
    expect(merged).toEqual({
        valid: true,
        curation: {
            concepts: [concept("a"), concept("b")],
            deferred: [...current.deferred, ...staged.deferred],
        },
    });
    expect(base).toEqual(empty());
    expect(current.concepts).toHaveLength(1);
});

test("disjoint existing updates retain order and each other's writes", () => {
    const base = { concepts: [concept("a"), concept("b")], deferred: [] };
    const current = structuredClone(base);
    current.concepts[0].salience = 6;
    const staged = structuredClone(base);
    staged.concepts[1].purpose = "Changed";
    const merged = applyTopicTransaction(
        current,
        createTopicTransaction(base, staged, new Set(["b"]), false),
    );
    expect(merged.valid).toBe(true);
    if (merged.valid) {
        expect(merged.curation.concepts.map((entry) => entry.id)).toEqual([
            "a",
            "b",
        ]);
        expect(merged.curation.concepts[0].salience).toBe(6);
        expect(merged.curation.concepts[1].purpose).toBe("Changed");
    }
});

test.each(["read", "write"])(
    "changed %s concepts invalidate even unselected reads",
    (mode) => {
        const base = { concepts: [concept("a")], deferred: [] };
        const current = structuredClone(base);
        current.concepts[0].summary = "A newer summary";
        const staged = structuredClone(base);
        if (mode === "write") staged.concepts[0].salience = 6;
        const transaction = createTopicTransaction(
            base,
            staged,
            new Set(mode === "read" ? ["a"] : []),
            false,
        );
        expect(applyTopicTransaction(current, transaction)).toEqual({
            valid: false,
            reason: "concept-read-changed",
        });
    },
);

test("whole-universe predicates detect newly inserted concepts", () => {
    expect(
        applyTopicTransaction(
            { concepts: [concept("new")], deferred: [] },
            createTopicTransaction(empty(), empty(), new Set(), true),
        ),
    ).toEqual({ valid: false, reason: "concept-universe-changed" });
});

test("fallback replacement deletes only with a matching full-universe read", () => {
    const base = { concepts: [concept("a"), concept("b")], deferred: [] };
    const staged = {
        concepts: [concept("b"), concept("replacement", "a")],
        deferred: [],
    };
    expect(() =>
        createTopicTransaction(base, staged, new Set(), false),
    ).toThrow("universe read");
    expect(
        applyTopicTransaction(
            base,
            createTopicTransaction(base, staged, new Set(["a"]), true),
        ),
    ).toEqual({
        valid: true,
        curation: staged,
    });
});

test("concept-ID collisions and focal-node ownership collisions reject publication", () => {
    const transaction = createTopicTransaction(
        empty(),
        { concepts: [concept("a", "n")], deferred: [] },
        new Set(),
        false,
    );
    expect(
        applyTopicTransaction(
            { concepts: [concept("a", "other")], deferred: [] },
            transaction,
        ),
    ).toEqual({
        valid: false,
        reason: "concept-insert-collision",
    });
    expect(
        applyTopicTransaction(
            { concepts: [concept("b", "n")], deferred: [] },
            transaction,
        ),
    ).toEqual({
        valid: false,
        reason: "node-ownership-changed",
    });
    expect(
        applyTopicTransaction(
            { concepts: [], deferred: [{ nodeId: "n", reason: "low" }] },
            transaction,
        ),
    ).toEqual({
        valid: false,
        reason: "node-ownership-changed",
    });
});

test("existing deferrals cannot be silently rewritten", () => {
    expect(() =>
        createTopicTransaction(
            { concepts: [], deferred: [{ nodeId: "d", reason: "old" }] },
            { concepts: [], deferred: [{ nodeId: "d", reason: "new" }] },
            new Set(),
            false,
        ),
    ).toThrow("rewrote existing deferrals");
});

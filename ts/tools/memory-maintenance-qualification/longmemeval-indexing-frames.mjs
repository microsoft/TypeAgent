// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";

function row(schema, itemKey, values, eligible = true) {
    return {
        schemaId: schema.id,
        schemaRevision: 1,
        itemKey,
        values,
        eligible,
        origin: "source",
        granularity: "record",
        evidence: [],
        opposition: [],
    };
}
function projection(rows) {
    return {
        ownerKey: "pilot",
        revisionId: "frozen",
        fingerprint: "frozen",
        dependencies: [{ sourceId: "pilot", revisionId: "frozen" }],
        rows,
    };
}
function stores(modules, schema, rows) {
    const instances = [
        new modules.kp.dataFrame.MemoryFrameProjectionStore(),
        new modules.storage.sqlite.SqliteFrameProjectionStore(":memory:"),
    ];
    for (const store of instances) {
        store.registerSchema(schema);
        store.stage(projection(rows));
        store.commit(projection(rows));
    }
    return instances;
}
function verify(stores, schema, predicate, expected, include = false) {
    const timings = stores.map((store) => {
        const start = performance.now();
        const parse = JSON.parse;
        let parsedRows = 0;
        let rows;
        JSON.parse = (...args) => {
            const value = Reflect.apply(parse, JSON, args);
            if (
                value?.schemaId === schema.id &&
                typeof value.itemKey === "string"
            )
                parsedRows++;
            return value;
        };
        try {
            rows = store.query(
                schema,
                predicate,
                new Map([["pilot", "frozen"]]),
                include,
            );
        } finally {
            JSON.parse = parse;
        }
        assert.deepEqual(
            rows.map((item) => item.itemKey).sort(),
            [...expected].sort(),
        );
        return {
            elapsedMs: performance.now() - start,
            matchedRows: rows.length,
            parsedRows,
        };
    });
    return timings;
}

export function frameInventory(modules, construction) {
    const schema = {
        id: "pilot.turns",
        revision: 1,
        description: "Original session positions and roles",
        fields: {
            session: { type: "number" },
            turn: { type: "number" },
            role: { type: "string" },
        },
    };
    const rows = construction.sessions.flatMap((session) =>
        session.turns.map((turn, i) =>
            row(schema, `${session.position}:${i}`, {
                session: session.position,
                turn: i,
                role: turn.role,
            }),
        ),
    );
    const instances = stores(modules, schema, rows);
    try {
        const expected = [];
        for (const session of construction.sessions)
            for (const [i, turn] of session.turns.entries())
                if (session.position === 0 && i < 2 && turn.role === "user")
                    expected.push(`${session.position}:${i}`);
        const samples = verify(
            instances,
            schema,
            {
                and: [
                    { fieldId: "session", op: "eq", value: 0 },
                    { fieldId: "turn", op: "lt", value: 2 },
                    { fieldId: "role", op: "eq", value: "user" },
                ],
            },
            expected,
        );
        return { sourceRows: rows.length, expectedIds: expected, samples };
    } finally {
        instances.forEach((store) => store.close());
    }
}

export function frameEdges(modules) {
    const schema = {
        id: "pilot.edge",
        revision: 1,
        description: "Synthetic scaling and temporal edges, not official data",
        fields: {
            instant: { type: "instant" },
            calendar: { type: "calendar", optional: true },
        },
    };
    const rows = Array.from({ length: 4096 }, (_, i) =>
        row(
            schema,
            String(i),
            {
                instant: {
                    kind: "instant",
                    raw: new Date(
                        Date.UTC(2026, 0, 1) + i * 60000,
                    ).toISOString(),
                },
                ...(i === 0
                    ? { calendar: { kind: "calendar", raw: "2026-01" } }
                    : {}),
            },
            i < 32,
        ),
    );
    const instances = stores(modules, schema, rows);
    const bounds = {
        and: [
            {
                fieldId: "instant",
                op: "gte",
                value: { kind: "instant", raw: "2026-01-01T01:01:00+01:00" },
            },
            {
                fieldId: "instant",
                op: "lt",
                value: { kind: "instant", raw: "2026-01-01T00:03:00Z" },
            },
        ],
    };
    try {
        const samples = verify(instances, schema, bounds, ["1", "2"]);
        const eligibility = verify(
            instances,
            schema,
            { and: [] },
            Array.from({ length: 32 }, (_, i) => String(i)),
        );
        verify(
            instances,
            schema,
            {
                and: [
                    {
                        fieldId: "calendar",
                        op: "eq",
                        value: { kind: "calendar", raw: "2026-01" },
                    },
                ],
            },
            ["0"],
        );
        for (const store of instances)
            assert.throws(() =>
                store.query(
                    schema,
                    {
                        and: [
                            {
                                fieldId: "instant",
                                op: "eq",
                                value: { kind: "calendar", raw: "2026-01-01" },
                            },
                        ],
                    },
                    new Map([["pilot", "frozen"]]),
                    false,
                ),
            );
        const plan = instances[1].explainQuery(schema, bounds);
        assert.ok(plan.join("\n").includes("frame_values_number"));
        assert.deepEqual(
            instances[1].query(
                schema,
                { and: [] },
                new Map([["pilot", "stale"]]),
                false,
            ),
            [],
        );
        return {
            synthetic: true,
            sourceRows: 4096,
            expectedIds: ["1", "2"],
            samples,
            eligibility,
            queryPlan: plan,
        };
    } finally {
        instances.forEach((store) => store.close());
    }
}

export function normalizationEdges(modules) {
    const index = new modules.kp.TermToSemanticRefIndex();
    index.addTerm("  CAF\u00c9\tSERVICE ", 0);
    index.addTerm("cafe\u0301\u00a0service", 0);
    const matches = index.lookupTerm("cafe\u0301\u00a0service");
    assert.equal(matches.length, 1, "Unicode normalization lookup failed");
    const data = index.serialize();
    const restored = new modules.kp.TermToSemanticRefIndex(data);
    assert.deepEqual(restored.lookupTerm("CAF\u00c9 SERVICE"), matches);
    return {
        status: "passed",
        normalizationVersion: data.normalizationVersion,
    };
}

export function frameSnapshot(modules, filename) {
    const schema = {
        id: "pilot.snapshot",
        revision: 1,
        description: "Synthetic concurrent replacement oracle",
        fields: { ordinal: { type: "number" } },
    };
    const reader = new modules.storage.sqlite.SqliteFrameProjectionStore(
        filename,
    );
    const writer = new modules.storage.sqlite.SqliteFrameProjectionStore(
        filename,
    );
    try {
        writer.registerSchema(schema);
        const original = projection([row(schema, "original", { ordinal: 0 })]);
        writer.stage(original);
        writer.commit(original);
        const next = {
            ...projection([row(schema, "replacement", { ordinal: 1 })]),
            revisionId: "next",
            fingerprint: "next",
            dependencies: [{ sourceId: "pilot", revisionId: "next" }],
        };
        let replaced = false;
        const owners = new Map([["pilot", "frozen"]]);
        owners.get = (key) => {
            if (!replaced) {
                replaced = true;
                writer.stage(next);
                writer.commit(next);
            }
            return Map.prototype.get.call(owners, key);
        };
        const first = reader.query(schema, { and: [] }, owners, false);
        assert.ok(replaced, "Concurrent replacement was not exercised");
        assert.deepEqual(
            first.map((entry) => entry.itemKey),
            ["original"],
            "Mixed metadata/hydration snapshots",
        );
        const after = reader.query(
            schema,
            { and: [] },
            new Map([["pilot", "next"]]),
            false,
        );
        assert.deepEqual(
            after.map((entry) => entry.itemKey),
            ["replacement"],
        );
        return {
            status: "passed",
            mode: "two-WAL-connections",
            duringRead: ["original"],
            subsequentRead: ["replacement"],
        };
    } finally {
        reader.close();
        writer.close();
    }
}

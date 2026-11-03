// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    dataFrame as df,
    ComparisonOp,
    createPropertySearchTerm,
} from "@typeagent/knowpro";
import { SqliteDataFrame } from "../src/sqlite/sqliteDataFrame.js";
import { SqliteFrameProjectionStore } from "../src/sqlite/sqliteFrameProjection.js";
import { createDatabase } from "../src/sqlite/sqliteCommon.js";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

describe.each(["memory", "sqlite"] as const)(
    "legacy dataframe %s",
    (backend) => {
        test("comparison direction, same-row identity, full records and parameter binding", () => {
            const db =
                backend === "sqlite"
                    ? createDatabase(":memory:", false)
                    : undefined;
            const columns: [string, df.DataFrameColumnDef][] = [
                ["id", { type: "string" }],
                ["component", { type: "string" }],
                ["amount", { type: "number" }],
            ];
            const frame = db
                ? new SqliteDataFrame(db, "measurements", columns)
                : new df.DataFrame("measurements", columns);
            try {
                df.addRowToFrame(frame, 0, {
                    id: "a",
                    component: "api",
                    amount: 10,
                });
                df.addRowToFrame(frame, 0, {
                    id: "b",
                    component: "batch",
                    amount: 40,
                });
                df.addRowToFrame(frame, 1, {
                    id: "c",
                    component: "api",
                    amount: 50,
                });
                df.addRowToFrame(frame, 2, {
                    id: "d",
                    component: "O'Brien",
                    amount: 5,
                });
                const ids = (rows: df.DataFrameRow[] | undefined) =>
                    rows?.map((r) => r.record.id).sort() ?? [];
                expect(
                    ids(frame.getRow("amount", 40, ComparisonOp.Gte)),
                ).toEqual(["b", "c"]);
                expect(
                    ids(frame.getRow("amount", 40, ComparisonOp.Gt)),
                ).toEqual(["c"]);
                expect(
                    ids(frame.getRow("amount", 40, ComparisonOp.Lte)),
                ).toEqual(["a", "b", "d"]);
                expect(
                    ids(frame.getRow("amount", 40, ComparisonOp.Lt)),
                ).toEqual(["a", "d"]);
                expect(
                    ids(frame.getRow("amount", 40, ComparisonOp.Eq)),
                ).toEqual(["b"]);
                const terms = df.getDataFrameTermGroups(
                    new Map([[frame.name, frame]]),
                    {
                        booleanOp: "and",
                        terms: [
                            createPropertySearchTerm(
                                "measurements.component",
                                "api",
                            ),
                            {
                                ...createPropertySearchTerm(
                                    "measurements.amount",
                                    "30",
                                ),
                                compareOp: ComparisonOp.Gte,
                            },
                        ],
                    },
                )[0];
                expect(ids(frame.findRows(terms))).toEqual(["c"]);
                expect(frame.findRows(terms)?.[0].record).toEqual({
                    id: "c",
                    component: "api",
                    amount: 50,
                });
                terms.terms = [
                    {
                        columnName: "component",
                        columnValue: { term: { text: "O'Brien" } },
                    },
                ];
                expect(ids(frame.findRows(terms))).toEqual(["d"]);
                terms.booleanOp = "or_max";
                terms.terms = [
                    {
                        columnName: "component",
                        columnValue: { term: { text: "api" } },
                    },
                    {
                        columnName: "amount",
                        columnValue: { term: { text: "30" } },
                        compareOp: ComparisonOp.Gte,
                    },
                ];
                expect(ids(frame.findRows(terms))).toEqual(["c"]);
            } finally {
                db?.close();
            }
        });
    },
);

const schema: df.FrameSchema = {
    id: "test.items",
    revision: 1,
    description: "Typed test items",
    fields: {
        component: { type: "string" },
        amount: { type: "number" },
        passed: { type: "boolean" },
        date: { type: "calendar", optional: true },
        instant: { type: "instant", optional: true },
        missing: { type: "number", optional: true },
    },
};
function projection(
    fingerprint: string,
    amounts = [10, 40, 50],
): df.FrameOwnerProjection {
    return {
        ownerKey: "source:one",
        revisionId: fingerprint,
        fingerprint,
        dependencies: [{ sourceId: "one", revisionId: fingerprint }],
        rows: amounts.map((amount, i) => ({
            schemaId: schema.id,
            schemaRevision: 1,
            itemKey: String(i),
            values: {
                component: i === 1 ? "batch" : "api",
                amount,
                passed: i !== 1,
                date: { kind: "calendar", raw: "2026-11-02" },
                instant: { kind: "instant", raw: "2026-11-02T12:00:00+05:00" },
            },
            valueStates: { missing: "unavailable" },
            eligible: true,
            origin: "source",
            granularity: "record",
            evidence: [],
            opposition: [],
        })),
    };
}
describe.each(["memory", "sqlite"] as const)(
    "frame projection %s",
    (backend) => {
        let store: df.FrameProjectionStore;
        beforeEach(() => {
            store =
                backend === "memory"
                    ? new df.MemoryFrameProjectionStore()
                    : new SqliteFrameProjectionStore(":memory:");
            store.registerSchema(schema);
        });
        afterEach(() => store.close());
        test("typed same-item filtering, temporal domains and missing values", () => {
            const owner = projection("first");
            store.stage(owner);
            store.commit(owner);
            const owners = new Map([[owner.ownerKey, owner.fingerprint]]);
            const query = (terms: df.FrameComparison[]) =>
                store.query(schema, { and: terms }, owners, false);
            expect(
                query([
                    { fieldId: "component", op: "eq", value: "api" },
                    { fieldId: "amount", op: "gte", value: 30 },
                    { fieldId: "passed", op: "eq", value: true },
                ]).map((r) => r.itemKey),
            ).toEqual(["2"]);
            expect(query([{ fieldId: "missing", op: "eq", value: 0 }])).toEqual(
                [],
            );
            expect(
                query([
                    {
                        fieldId: "date",
                        op: "gte",
                        value: { kind: "calendar", raw: "2026-11-02" },
                    },
                ]),
            ).toHaveLength(3);
            expect(
                query([
                    {
                        fieldId: "date",
                        op: "lt",
                        value: { kind: "calendar", raw: "2026-11-02" },
                    },
                ]),
            ).toEqual([]);
            expect(
                query([
                    {
                        fieldId: "instant",
                        op: "eq",
                        value: { kind: "instant", raw: "2026-11-02T07:00:00Z" },
                    },
                ]),
            ).toHaveLength(3);
            expect(() =>
                query([
                    {
                        fieldId: "instant",
                        op: "eq",
                        value: { kind: "calendar", raw: "2026-11-02" },
                    },
                ]),
            ).toThrow("Invalid instant");
            expect(() =>
                query([{ fieldId: "amount", op: "eq", value: "40" }]),
            ).toThrow("Invalid number");
        });
        test("idempotent replacement, stale intent rejection and empty snapshot retraction", () => {
            const first = projection("first");
            store.stage(first);
            store.commit(first);
            store.stage(first);
            store.commit(first);
            const second = projection("second", [20]);
            store.stage(first);
            store.stage(second);
            expect(() => store.commit(first)).toThrow("stale");
            store.commit(second);
            expect(
                store.query(
                    schema,
                    { and: [] },
                    new Map([[first.ownerKey, first.fingerprint]]),
                    false,
                ),
            ).toEqual([]);
            expect(
                store.query(
                    schema,
                    { and: [] },
                    new Map([[second.ownerKey, second.fingerprint]]),
                    false,
                ),
            ).toHaveLength(1);
            const empty = projection("empty", []);
            store.stage(empty);
            store.commit(empty);
            expect(
                store.query(
                    schema,
                    { and: [] },
                    new Map([[empty.ownerKey, empty.fingerprint]]),
                    false,
                ),
            ).toEqual([]);
            store.retainOwners(new Set());
            expect(store.receipts()).toEqual([]);
            expect(() => store.commit(second)).toThrow("stale");
        });
        test("schema revisions are immutable and duplicate item keys fail before acceptance", () => {
            expect(() =>
                store.registerSchema({ ...schema, description: "Changed" }),
            ).toThrow("immutable");
            const owner = projection("duplicate");
            owner.rows.push(owner.rows[0]);
            expect(() => store.stage(owner)).toThrow("Duplicate");
            expect(store.receipts()).toEqual([]);
        });
        test("prototype-named fields require own values and reject undeclared keys", () => {
            const special = {
                ...schema,
                id: "prototype.fields",
                fields: {
                    constructor: { type: "string" as const, optional: true },
                    toString: { type: "string" as const, optional: true },
                },
            };
            store.registerSchema(special);
            const owner = projection("prototype");
            owner.rows = [
                {
                    ...owner.rows[0],
                    schemaId: special.id,
                    values: { constructor: "observed", toString: "observed" },
                    valueStates: {},
                },
            ];
            store.stage(owner);
            store.commit(owner);
            const predicate: df.FramePredicate = {
                and: [
                    { fieldId: "constructor", op: "eq", value: "observed" },
                    { fieldId: "toString", op: "eq", value: "observed" },
                ],
            };
            const owners = new Map([[owner.ownerKey, owner.fingerprint]]);
            expect(store.query(special, predicate, owners, false)).toHaveLength(
                1,
            );
            owner.rows[0].values = {};
            store.stage(owner);
            store.commit(owner);
            expect(store.query(special, predicate, owners, false)).toEqual([]);
            const invalid = projection("unknown");
            invalid.rows[0].values = {
                ...invalid.rows[0].values,
                toString: "unexpected",
            };
            expect(() => store.stage(invalid)).toThrow("Unknown frame field");
            const required = {
                ...special,
                id: "prototype.required",
                fields: { constructor: { type: "string" as const } },
            };
            store.registerSchema(required);
            owner.rows[0].schemaId = required.id;
            expect(() => store.stage(owner)).toThrow(
                "Missing frame field constructor",
            );
        });
        test("revision CAS and unrelated pending-schema retention survive dependency purge", () => {
            const old = projection("same-fingerprint");
            const next = { ...old, revisionId: "different-revision" };
            store.stage(next);
            expect(() => store.commit(old)).toThrow("stale");
            expect(() => store.fail(old, "obsolete")).toThrow("stale");
            const pendingSchema = { ...schema, id: "pending.schema" };
            store.registerSchema(pendingSchema);
            const pending = {
                ...projection("pending"),
                ownerKey: "source:other",
                dependencies: [{ sourceId: "other", revisionId: "pending" }],
                rows: projection("pending").rows.map((row) => ({
                    ...row,
                    schemaId: pendingSchema.id,
                })),
            };
            store.stage(pending);
            store.purgeDependency("one");
            expect(store.schemas()).toContainEqual(pendingSchema);
            store.commit(pending);
            expect(
                store.query(
                    pendingSchema,
                    { and: [] },
                    new Map([[pending.ownerKey, pending.fingerprint]]),
                    false,
                ),
            ).toHaveLength(3);
        });
        test("Unicode string ordering and invalid surrogate rejection agree across backends", () => {
            const owner = projection("unicode");
            owner.rows[0].values.component = "\uE000";
            owner.rows[1].values.component = "\u{1F600}";
            store.stage(owner);
            store.commit(owner);
            expect(
                store
                    .query(
                        schema,
                        {
                            and: [
                                {
                                    fieldId: "component",
                                    op: "gt",
                                    value: "\uE000",
                                },
                            ],
                        },
                        new Map([[owner.ownerKey, owner.fingerprint]]),
                        false,
                    )
                    .map((row) => row.itemKey),
            ).toEqual(["1"]);
            owner.rows[0].values.component = "\uD800";
            expect(() => store.stage(owner)).toThrow("Invalid string");
        });
        test("failed receipts cannot serve facts and dependency purge includes pending intents", () => {
            const owner = projection("failed");
            store.stage(owner);
            store.fail(owner, "Projection unavailable");
            expect(store.receipts()[0].state).toBe("failed");
            expect(
                store.query(
                    schema,
                    { and: [] },
                    new Map([[owner.ownerKey, owner.fingerprint]]),
                    true,
                ),
            ).toEqual([]);
            store.stage(owner);
            store.commit(owner);
            const pending = {
                ...projection("pending"),
                dependencies: [{ sourceId: "other", revisionId: "pending" }],
            };
            store.stage(pending);
            store.purgeDependency("one");
            expect(store.receipts()).toEqual([]);
            expect(() => store.commit(pending)).toThrow("stale");
        });
    },
);

test("SQLite catalog/intent survive reopen, use typed indexes and reject unknown future database versions", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "frame-reopen-"));
    const filename = path.join(root, "frames.db");
    let store = new SqliteFrameProjectionStore(filename);
    try {
        store.registerSchema(schema);
        const owner = projection("replay");
        store.stage(owner);
        store.close();
        store = new SqliteFrameProjectionStore(filename);
        expect(store.receipts()[0].state).toBe("pending");
        store.commit(owner);
        const plan = store.explainQuery(schema, {
            and: [{ fieldId: "amount", op: "gte", value: 30 }],
        });
        expect(plan.join("\n")).toContain("frame_values_number");
        expect(
            store.query(
                schema,
                { and: [{ fieldId: "amount", op: "gte", value: 30 }] },
                new Map([[owner.ownerKey, owner.fingerprint]]),
                false,
            ),
        ).toHaveLength(2);
        store.close();
        const db = createDatabase(filename, false);
        db.pragma("user_version=999");
        db.close();
        expect(() => new SqliteFrameProjectionStore(filename)).toThrow(
            "Unsupported",
        );
    } finally {
        store.close();
        rmSync(root, { recursive: true, force: true });
    }
});

test("SQLite rollback restores rows and receipt, allowing retry on the same provider", () => {
    let fail = true;
    const store = new SqliteFrameProjectionStore(":memory:", (point) => {
        if (point === "rows" && fail) throw new Error("injected rollback");
    });
    try {
        store.registerSchema(schema);
        const owner = projection("rollback");
        store.stage(owner);
        expect(() => store.commit(owner)).toThrow("injected rollback");
        expect(store.receipts()[0].state).toBe("pending");
        expect(
            store.query(
                schema,
                { and: [] },
                new Map([[owner.ownerKey, owner.fingerprint]]),
                false,
            ),
        ).toEqual([]);
        fail = false;
        store.commit(owner);
        expect(
            store.query(
                schema,
                { and: [] },
                new Map([[owner.ownerKey, owner.fingerprint]]),
                false,
            ),
        ).toHaveLength(3);
    } finally {
        store.close();
    }
});

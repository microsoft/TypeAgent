// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type * as sqlite from "better-sqlite3";
import { dataFrame as df, recordSearchTiming } from "@typeagent/knowpro";
import { createDatabase } from "./sqliteCommon.js";

export class SqliteFrameProjectionStore implements df.FrameProjectionStore {
    private readonly db: sqlite.Database;

    constructor(
        filename: string,
        private readonly checkpoint?: (point: "rows" | "receipt") => void,
    ) {
        this.db = createDatabase(filename, false);
        const version = this.db.pragma("user_version", { simple: true });
        if (version !== 0 && version !== 1 && version !== 2) {
            this.db.close();
            throw new Error(
                `Unsupported frame projection database version ${String(version)}`,
            );
        }
        try {
            this.db.transaction(() => {
                this.db.exec(`
                CREATE TABLE IF NOT EXISTS frame_schemas (
                    id TEXT NOT NULL, revision INTEGER NOT NULL, value TEXT NOT NULL,
                    PRIMARY KEY(id, revision));
                CREATE TABLE IF NOT EXISTS frame_owners (
                    owner TEXT PRIMARY KEY, revision TEXT NOT NULL, fingerprint TEXT NOT NULL,
                    state TEXT NOT NULL, error TEXT);
                CREATE TABLE IF NOT EXISTS frame_dependencies (
                    owner TEXT NOT NULL, source TEXT NOT NULL, revision TEXT NOT NULL,
                    PRIMARY KEY(owner,source,revision));
                CREATE INDEX IF NOT EXISTS frame_dependency_source ON frame_dependencies(source,owner);
                CREATE TABLE IF NOT EXISTS frame_rows (
                    id INTEGER PRIMARY KEY, owner TEXT NOT NULL, schema_id TEXT NOT NULL,
                    schema_revision INTEGER NOT NULL, item_key TEXT NOT NULL, value TEXT NOT NULL,
                    UNIQUE(owner, schema_id, schema_revision, item_key));
                CREATE INDEX IF NOT EXISTS frame_rows_owner ON frame_rows(owner);
                CREATE INDEX IF NOT EXISTS frame_rows_schema ON frame_rows(schema_id,schema_revision,id);
                CREATE TABLE IF NOT EXISTS frame_owner_schemas (
                    owner TEXT NOT NULL, schema_id TEXT NOT NULL, schema_revision INTEGER NOT NULL,
                    PRIMARY KEY(owner,schema_id,schema_revision));
                INSERT OR IGNORE INTO frame_owner_schemas
                    SELECT DISTINCT owner,schema_id,schema_revision FROM frame_rows;
                CREATE TABLE IF NOT EXISTS frame_values (
                    row_id INTEGER NOT NULL, schema_id TEXT NOT NULL, schema_revision INTEGER NOT NULL,
                    field TEXT NOT NULL, text_value TEXT, number_value REAL);
                CREATE INDEX IF NOT EXISTS frame_values_text
                    ON frame_values(schema_id, schema_revision, field, text_value, row_id);
                CREATE INDEX IF NOT EXISTS frame_values_number
                    ON frame_values(schema_id, schema_revision, field, number_value, row_id);
                CREATE INDEX IF NOT EXISTS frame_values_row ON frame_values(row_id);
            `);
                const columns = this.db.pragma("table_info(frame_rows)") as {
                    name: string;
                }[];
                if (!columns.some((column) => column.name === "eligible")) {
                    this.db.exec(
                        "ALTER TABLE frame_rows ADD COLUMN eligible INTEGER NOT NULL DEFAULT 0",
                    );
                    const update = this.db.prepare(
                        "UPDATE frame_rows SET eligible=? WHERE id=?",
                    );
                    let last = 0;
                    while (true) {
                        const rows = this.db
                            .prepare(
                                "SELECT id,value FROM frame_rows WHERE id>? ORDER BY id LIMIT 128",
                            )
                            .all(last) as { id: number; value: string }[];
                        if (!rows.length) break;
                        for (const row of rows) {
                            const value: df.FrameRow = JSON.parse(row.value);
                            update.run(Number(value.eligible), row.id);
                            last = row.id;
                        }
                    }
                }
                this.db.pragma("user_version = 2");
            })();
        } catch (error) {
            this.db.close();
            throw error;
        }
    }

    registerSchema(schema: df.FrameSchema): void {
        df.assertFrameSchema(schema);
        const old = this.db
            .prepare(
                "SELECT value FROM frame_schemas WHERE id=? AND revision=?",
            )
            .get(schema.id, schema.revision) as { value: string } | undefined;
        const value = JSON.stringify(schema);
        if (old && old.value !== value)
            throw new Error("Frame schema revision is immutable");
        this.db
            .prepare("INSERT OR IGNORE INTO frame_schemas VALUES (?, ?, ?)")
            .run(schema.id, schema.revision, value);
    }
    schemas(): df.FrameSchema[] {
        return (
            this.db
                .prepare(
                    "SELECT value FROM frame_schemas ORDER BY id, revision",
                )
                .all() as { value: string }[]
        ).map((row) => JSON.parse(row.value));
    }
    receipts(): df.FrameProjectionReceipt[] {
        return (
            this.db
                .prepare("SELECT * FROM frame_owners ORDER BY owner")
                .all() as {
                owner: string;
                revision: string;
                fingerprint: string;
                state: df.FrameProjectionReceipt["state"];
                error: string | null;
            }[]
        ).map((row) => ({
            ownerKey: row.owner,
            revisionId: row.revision,
            fingerprint: row.fingerprint,
            state: row.state,
            ...(row.error ? { error: row.error } : {}),
        }));
    }
    stage(projection: df.FrameOwnerProjection): void {
        df.validateFrameRows(projection, this.schemas());
        this.db.transaction(() => {
            this.db
                .prepare(
                    `INSERT INTO frame_owners VALUES (?, ?, ?, 'pending', NULL)
            ON CONFLICT(owner) DO UPDATE SET revision=excluded.revision,
                fingerprint=excluded.fingerprint, state='pending', error=NULL`,
                )
                .run(
                    projection.ownerKey,
                    projection.revisionId,
                    projection.fingerprint,
                );
            this.writeDependencies(projection);
            this.writeSchemaReferences(projection);
        })();
    }
    commit(projection: df.FrameOwnerProjection): void {
        const schemas = this.schemas();
        this.db.transaction(() => {
            const intent = this.db
                .prepare(
                    "SELECT state, fingerprint, revision FROM frame_owners WHERE owner=?",
                )
                .get(projection.ownerKey) as
                | { state: string; fingerprint: string; revision: string }
                | undefined;
            if (
                intent?.state !== "pending" ||
                intent.revision !== projection.revisionId ||
                intent.fingerprint !== projection.fingerprint
            )
                throw new Error("Frame projection intent is stale");
            df.validateFrameRows(projection, schemas);
            this.deleteRows(projection.ownerKey);
            this.db
                .prepare("DELETE FROM frame_dependencies WHERE owner=?")
                .run(projection.ownerKey);
            this.writeDependencies(projection);
            this.db
                .prepare("DELETE FROM frame_owner_schemas WHERE owner=?")
                .run(projection.ownerKey);
            this.writeSchemaReferences(projection);
            const insert = this.db.prepare(
                "INSERT INTO frame_rows(owner,schema_id,schema_revision,item_key,value,eligible) VALUES (?,?,?,?,?,?)",
            );
            const value = this.db.prepare(
                "INSERT INTO frame_values VALUES (?,?,?,?,?,?)",
            );
            for (const row of projection.rows) {
                const schema = schemas.find(
                    (s) =>
                        s.id === row.schemaId &&
                        s.revision === row.schemaRevision,
                )!;
                const id = insert.run(
                    projection.ownerKey,
                    row.schemaId,
                    row.schemaRevision,
                    row.itemKey,
                    JSON.stringify(row),
                    Number(row.eligible),
                ).lastInsertRowid;
                for (const [field, raw] of Object.entries(row.values)) {
                    if (df.frameRecordValue(row.valueStates, field)) continue;
                    for (const scalar of Array.isArray(raw) ? raw : [raw]) {
                        const key = df.frameValueKey(
                            schema.fields[field],
                            scalar,
                        );
                        if (key !== undefined)
                            value.run(
                                id,
                                row.schemaId,
                                row.schemaRevision,
                                field,
                                typeof key === "string" ? key : null,
                                typeof key === "number" ? key : null,
                            );
                    }
                }
            }
            this.checkpoint?.("rows");
            this.db
                .prepare("UPDATE frame_owners SET state='ready' WHERE owner=?")
                .run(projection.ownerKey);
            this.checkpoint?.("receipt");
        })();
    }
    private writeDependencies(projection: df.FrameOwnerProjection): void {
        const insert = this.db.prepare(
            "INSERT OR IGNORE INTO frame_dependencies VALUES (?,?,?)",
        );
        for (const dep of projection.dependencies)
            insert.run(projection.ownerKey, dep.sourceId, dep.revisionId);
    }
    private writeSchemaReferences(projection: df.FrameOwnerProjection): void {
        const insert = this.db.prepare(
            "INSERT OR IGNORE INTO frame_owner_schemas VALUES (?,?,?)",
        );
        for (const row of projection.rows)
            insert.run(projection.ownerKey, row.schemaId, row.schemaRevision);
    }
    fail(projection: df.FrameOwnerProjection, error: string): void {
        const updated = this.db
            .prepare(
                "UPDATE frame_owners SET state='failed',error=? WHERE owner=? AND fingerprint=? AND revision=? AND state='pending'",
            )
            .run(
                error,
                projection.ownerKey,
                projection.fingerprint,
                projection.revisionId,
            );
        if (updated.changes !== 1)
            throw new Error("Frame projection intent is stale");
    }
    purgeDependency(sourceId: string): void {
        const removed = new Set(
            (
                this.db
                    .prepare(
                        "SELECT owner FROM frame_dependencies WHERE source=?",
                    )
                    .all(sourceId) as { owner: string }[]
            ).map((row) => row.owner),
        );
        this.retainOwners(
            new Set(
                this.receipts()
                    .filter((r) => !removed.has(r.ownerKey))
                    .map((r) => r.ownerKey),
            ),
        );
        this.db.exec(
            "DELETE FROM frame_schemas WHERE NOT EXISTS (SELECT 1 FROM frame_owner_schemas WHERE schema_id=frame_schemas.id AND schema_revision=frame_schemas.revision)",
        );
    }
    retainSchemas(keys: ReadonlySet<string>): void {
        this.db.transaction(() => {
            const remove = this.db.prepare(
                "DELETE FROM frame_schemas WHERE id=? AND revision=?",
            );
            for (const schema of this.schemas())
                if (!keys.has(JSON.stringify([schema.id, schema.revision])))
                    remove.run(schema.id, schema.revision);
        })();
    }
    private deleteRows(owner: string): void {
        this.db
            .prepare(
                "DELETE FROM frame_values WHERE row_id IN (SELECT id FROM frame_rows WHERE owner=?)",
            )
            .run(owner);
        this.db.prepare("DELETE FROM frame_rows WHERE owner=?").run(owner);
    }
    retainOwners(keys: ReadonlySet<string>): void {
        this.db.transaction(() => {
            for (const receipt of this.receipts())
                if (!keys.has(receipt.ownerKey)) {
                    this.deleteRows(receipt.ownerKey);
                    this.db
                        .prepare("DELETE FROM frame_owners WHERE owner=?")
                        .run(receipt.ownerKey);
                    this.db
                        .prepare("DELETE FROM frame_dependencies WHERE owner=?")
                        .run(receipt.ownerKey);
                    this.db
                        .prepare(
                            "DELETE FROM frame_owner_schemas WHERE owner=?",
                        )
                        .run(receipt.ownerKey);
                }
        })();
    }
    private queryStatement(
        schema: df.FrameSchema,
        predicate: df.FramePredicate,
        includeUnconfirmed: boolean = true,
    ) {
        const terms = df.frameComparisons(schema, predicate);
        const params: (string | number)[] = [schema.id, schema.revision];
        const ops = {
            eq: "=",
            neq: "!=",
            lt: "<",
            lte: "<=",
            gt: ">",
            gte: ">=",
        };
        const clauses = terms.map((term) => {
            const key = df.frameValueKey(
                schema.fields[term.fieldId],
                term.value,
            )!;
            params.push(schema.id, schema.revision, term.fieldId, key);
            return `r.id IN (SELECT row_id FROM frame_values v WHERE
                v.schema_id=? AND v.schema_revision=? AND v.field=?
                AND v.${typeof key === "number" ? "number_value" : "text_value"} ${ops[term.op]} ?)`;
        });
        const where = terms.length
            ? clauses.join("and" in predicate ? " AND " : " OR ")
            : "and" in predicate
              ? "1"
              : "0";
        const sql = `SELECT r.id,o.owner,o.revision,o.fingerprint FROM frame_rows r
            JOIN frame_owners o ON r.owner=o.owner WHERE o.state='ready'
            AND r.schema_id=? AND r.schema_revision=? AND (${where})
            ${includeUnconfirmed ? "" : "AND r.eligible=1"} ORDER BY r.id`;
        return { sql, params };
    }
    explainQuery(
        schema: df.FrameSchema,
        predicate: df.FramePredicate,
    ): string[] {
        const { sql, params } = this.queryStatement(schema, predicate);
        return (
            this.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as {
                detail: string;
            }[]
        ).map((row) => row.detail);
    }
    query(
        schema: df.FrameSchema,
        predicate: df.FramePredicate,
        owners: ReadonlyMap<string, string>,
        includeUnconfirmed: boolean,
    ): df.FrameMatch[] {
        return this.db.transaction(() => {
            const metadataStarted = performance.now();
            const { sql, params } = this.queryStatement(
                schema,
                predicate,
                includeUnconfirmed,
            );
            const rows = this.db.prepare(sql).all(...params) as {
                id: number;
                owner: string;
                revision: string;
                fingerprint: string;
            }[];
            const eligible = rows.filter(
                (entry) => owners.get(entry.owner) === entry.fingerprint,
            );
            recordSearchTiming(
                "query.frame.metadata",
                performance.now() - metadataStarted,
                {
                    candidateRows: rows.length,
                    eligibleRows: eligible.length,
                },
            );
            const exactStarted = performance.now();
            const result: df.FrameMatch[] = [];
            for (let start = 0; start < eligible.length; start += 128) {
                const batch = eligible.slice(start, start + 128);
                const values = new Map(
                    (
                        this.db
                            .prepare(
                                `SELECT id,value FROM frame_rows WHERE id IN (${batch.map(() => "?").join(",")})`,
                            )
                            .all(...batch.map((entry) => entry.id)) as {
                            id: number;
                            value: string;
                        }[]
                    ).map((entry) => [entry.id, entry.value]),
                );
                for (const entry of batch) {
                    const value = values.get(entry.id);
                    if (value === undefined)
                        throw new Error("Missing frame candidate row");
                    const row: df.FrameRow = JSON.parse(value);
                    if (df.matchesFrame(row, schema, predicate))
                        result.push({
                            ...row,
                            ownerKey: entry.owner,
                            ownerRevisionId: entry.revision,
                        });
                }
            }
            recordSearchTiming(
                "query.frame.exact",
                performance.now() - exactStarted,
                {
                    candidateRows: eligible.length,
                    hydrationQueries: Math.ceil(eligible.length / 128),
                    hydratedRows: eligible.length,
                    matchedRows: result.length,
                },
            );
            return result;
        })();
    }
    close(): void {
        this.db.close();
    }
}

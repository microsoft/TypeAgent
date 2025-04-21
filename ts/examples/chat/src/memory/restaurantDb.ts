// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import * as sqlite from "better-sqlite3";
import * as kp from "knowpro";
import * as ms from "memory-storage";

export class RestaurantDb {
    private db: sqlite.Database;
    public geo: GeoTable;
    public dataFrames: kp.DataFrameCollection;

    constructor(dbPath: string) {
        this.db = ms.sqlite.createDatabase(dbPath, true);
        this.geo = new GeoTable(this.db);
        this.dataFrames = new Map<string, kp.IDataFrame>([
            [this.geo.name, this.geo],
        ]);
    }

    public close() {
        if (this.db) {
            this.db.close();
        }
    }
}

export class GeoTable implements kp.IDataFrame {
    public readonly name;
    public readonly columns: kp.DataFrameColumns;
    private sql_getAll: sqlite.Statement;
    private sql_add: sqlite.Statement;

    constructor(public db: sqlite.Database) {
        this.name = "geo";
        this.columns = new Map<string, kp.DataFrameColumnDef>([
            ["latitude", { type: "string" }],
            ["longitude", { type: "string" }],
        ]);
        this.ensureTable();
        this.sql_getAll = this.sqlGetAll();
        this.sql_add = this.sqlAdd();
    }

    public addRows(...rows: kp.DataFrameRow[]): void {
        for (const row of rows) {
            const geoRow: GeoRow = {
                id: 0,
                sourceRef: JSON.stringify(row.sourceRef),
                latitude: row.record.latitude?.toString(),
                longitude: row.record.longitude?.toString(),
            };
            this.sql_add.run(
                geoRow.sourceRef,
                geoRow.latitude,
                geoRow.longitude,
            );
        }
    }

    public getRow(
        columnName: string,
        columnValue: kp.DataFrameValue,
        op: kp.ComparisonOp,
    ): kp.DataFrameRow[] | undefined {
        let sql = `SELECT * from ${this.name} WHERE ${columnName} ${ms.sqlite.comparisonOpToSql(op)} ?`;
        let stmt = this.db.prepare(sql);
        let row = stmt.get(ms.sqlite.valueToSql(columnValue));
        if (row === undefined) {
            return undefined;
        }
        return [this.toDataFrameRow(row as GeoRow)];
    }

    findRows(
        searchTerms: kp.DataFrameTermGroup,
    ): kp.DataFrameRow[] | undefined {
        throw new Error("Method not implemented.");
    }

    public findSources(
        searchTerms: kp.DataFrameTermGroup,
    ): kp.RowSourceRef[] | undefined {
        //throw new Error("Method not implemented.");
        let sql = `SELECT sourceRef from ${this.name} WHERE `;
        const where = ms.sqlite.dataFrameTermGroupToSql(
            searchTerms,
            this.columns,
        );
        sql += where;
        const sources: kp.RowSourceRef[] = [];
        const stmt = this.db.prepare(sql);
        for (const row of stmt.iterate()) {
            const geoRow = row as GeoRow;
            sources.push(JSON.parse(geoRow.sourceRef));
        }
        return sources;
    }

    public *[Symbol.iterator](): Iterator<kp.DataFrameRow, any, any> {
        for (let row of this.sql_getAll.iterate()) {
            const value = this.toDataFrameRow(row as GeoRow);
            if (value !== undefined) {
                yield value;
            }
        }
    }

    private toDataFrameRow(row: GeoRow): kp.DataFrameRow {
        return {
            sourceRef: JSON.parse(row.sourceRef),
            record: row,
        };
    }

    private sqlGetAll() {
        return this.db.prepare(`SELECT * FROM ${this.name}`);
    }

    private sqlAdd() {
        return this.db.prepare(
            `INSERT INTO ${this.name} (sourceRef, latitude, longitude) VALUES (?, ?, ?)`,
        );
    }

    private ensureTable() {
        let schemaSql = `CREATE TABLE IF NOT EXISTS ${this.name} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sourceRef TEXT NOT NULL,
            latitude TEXT,
            longitude TEXT
    )`;
        this.db.exec(schemaSql);
    }
}

type GeoRow = {
    id: number;
    sourceRef: string;
    latitude?: string | undefined;
    longitude?: string | undefined;
};

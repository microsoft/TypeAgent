// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sqlite from "better-sqlite3";
import * as kp from "knowpro";
import { sql_makeInPlaceholders } from "./sqliteCommon.js";

export class SqliteDataFrame implements kp.hybrid.IDataFrame {
    public columns: kp.hybrid.DataFrameColumns;

    private sql_add: sqlite.Statement;
    private sql_getAll: sqlite.Statement;
    private recordColumnNames: string[];

    constructor(
        public db: sqlite.Database,
        public name: string,
        columns:
            | kp.hybrid.DataFrameColumns
            | [string, kp.hybrid.DataFrameColumnDef][],
        ensureDb: boolean = true,
    ) {
        if (Array.isArray(columns)) {
            this.columns = new Map<string, kp.hybrid.DataFrameColumnDef>(
                columns,
            );
        } else {
            this.columns = columns;
        }

        if (ensureDb) {
            this.ensureDb();
        }
        this.recordColumnNames = this.prepareColumnNames(this.columns.keys());
        this.sql_add = this.sqlAdd();
        this.sql_getAll = this.sqlGetAll();
    }

    public addRows(...rows: kp.hybrid.DataFrameRow[]): void {
        for (const row of rows) {
            const rowValues = this.getAddValues(row);
            this.sql_add.run(rowValues);
        }
    }

    public getRow(
        columnName: string,
        columnValue: kp.hybrid.DataFrameValue,
        op: kp.ComparisonOp,
    ): kp.hybrid.DataFrameRow[] | undefined {
        const stmt = this.sqlGet(columnName, op);
        let rows: kp.hybrid.DataFrameRow[] = [];
        for (const row of stmt.iterate(columnValue)) {
            rows.push(this.toDataFrameRow(row));
        }
        return rows;
    }

    public findRows(
        searchTerms: kp.hybrid.DataFrameTermGroup,
    ): kp.hybrid.DataFrameRow[] | undefined {
        const dfRows: kp.hybrid.DataFrameRow[] = [];
        const stmt = this.queryRows(searchTerms);
        for (const row of stmt.iterate()) {
            dfRows.push(this.toDataFrameRow(row));
        }
        return dfRows;
    }

    public findSources(
        searchTerms: kp.hybrid.DataFrameTermGroup,
    ): kp.hybrid.RowSourceRef[] | undefined {
        const sources: kp.hybrid.RowSourceRef[] = [];
        const stmt = this.queryRows(searchTerms);
        for (const row of stmt.iterate()) {
            sources.push(this.deserializeSourceRef(row as SqliteDataFrameRow));
        }
        return sources;
    }

    public *[Symbol.iterator](): Iterator<kp.hybrid.DataFrameRow> {
        for (let row of this.sql_getAll.iterate()) {
            const value = this.toDataFrameRow(row);
            if (value !== undefined) {
                yield value;
            }
        }
    }

    private queryRows(
        searchTerms: kp.hybrid.DataFrameTermGroup,
    ): sqlite.Statement {
        let sql = `SELECT sourceRef from ${this.name} WHERE `;
        const where = dataFrameTermGroupToSql(searchTerms, this.columns);
        sql += where;
        return this.db.prepare(sql);
    }

    private toDataFrameRow(row: unknown): kp.hybrid.DataFrameRow {
        return {
            sourceRef: this.deserializeSourceRef(row as SqliteDataFrameRow),
            record: row as kp.hybrid.DataFrameRecord,
        };
    }

    private deserializeSourceRef(
        row: SqliteDataFrameRow,
    ): kp.hybrid.RowSourceRef {
        return JSON.parse(row.sourceRef);
    }

    private getAddValues(row: kp.hybrid.DataFrameRow) {
        let values: any[] = [];
        values.push(this.serializeSourceRef(row.sourceRef));
        for (const colName of this.recordColumnNames) {
            values.push(row.record[colName]);
        }
        return values;
    }

    private prepareColumnNames(names: IterableIterator<string> | string[]) {
        const colNames = [...names].sort();
        return colNames;
    }

    private serializeSourceRef(sr: kp.hybrid.RowSourceRef) {
        return JSON.stringify(sr);
    }

    private sqlGet(columnName: string, op: kp.ComparisonOp) {
        let sql = `SELECT * from ${this.name} WHERE ${columnName} ${comparisonOpToSql(op)} ?`;
        return this.db.prepare(sql);
    }

    private sqlGetAll() {
        return this.db.prepare(`SELECT * FROM ${this.name}`);
    }

    private sqlAdd() {
        const columnNames = ["sourceRef", ...this.recordColumnNames];
        const sql = `INSERT INTO ${this.name} (${columnNames.join(", ")}) VALUES (${sql_makeInPlaceholders(columnNames.length)})`;
        return this.db.prepare(sql);
    }

    private ensureDb() {
        let schemaSql = dataFrameToSqlSchema(this.name, this.columns);
        this.db.exec(schemaSql);
    }
}

export interface SqliteDataFrameRow {
    sourceRef: string;
}

export function dataFrameTermGroupToSql(
    group: kp.hybrid.DataFrameTermGroup,
    colDefs: kp.hybrid.DataFrameColumns,
): string {
    let clauses: string[] = [];
    for (let searchTerm of group.terms) {
        const colDef = colDefs.get(searchTerm.columnName);
        if (!colDef) {
            throw new Error(
                `Column ${searchTerm.columnName} not found in ${group.dataFrame.name}`,
            );
        }
        clauses.push(dataFrameSearchTermToSql(searchTerm, colDef));
    }
    const boolOp = boolOpToSql(group);
    return clauses.length > 1 ? `(${clauses.join(boolOp)})` : clauses[0];
}

export function dataFrameSearchTermToSql(
    term: kp.hybrid.DataFrameSearchTerm,
    colDef: kp.hybrid.DataFrameColumnDef,
): string {
    const op = comparisonOpToSql(term.compareOp ?? kp.ComparisonOp.Eq);
    const val = searchTermToSql(term.columnValue, colDef);
    return `${term.columnName} ${op} ${val}`;
}

export function searchTermToSql(
    valueTerm: kp.SearchTerm,
    columnDef: kp.hybrid.DataFrameColumnDef,
): string {
    const valueText = valueTerm.term.text;
    if (columnDef.type === "number") {
        return valueText;
    }
    return `'${valueText}'`;
}

export function boolOpToSql(group: kp.hybrid.DataFrameTermGroup): string {
    switch (group.booleanOp) {
        case "and":
            return " AND ";
        case "or":
        case "or_max":
            return " OR ";
    }
}

export function comparisonOpToSql(op: kp.ComparisonOp): string {
    switch (op) {
        case kp.ComparisonOp.Eq:
            return "=";
        case kp.ComparisonOp.Lt:
            return "<";
        case kp.ComparisonOp.Lte:
            return "<=";
        case kp.ComparisonOp.Gt:
            return ">";
        case kp.ComparisonOp.Gte:
            return ">=";
        case kp.ComparisonOp.Neq:
            return "!=";
    }
}

export function dataFrameToSqlSchema(
    dfName: string,
    colDefs: kp.hybrid.DataFrameColumns,
): string {
    if (colDefs.size === 0) {
        return "";
    }
    let columns: string[] = [];
    columns.push("rowId INTEGER PRIMARY KEY AUTOINCREMENT");
    columns.push("sourceRef TEXT NOT NULL");
    for (const [columnName, columnDef] of colDefs) {
        columns.push(columnDefToSqlSchema(columnName, columnDef));
    }
    let schemaSql = `CREATE TABLE IF NOT EXISTS ${dfName} (\n${columns.join(", \n")}\n)`;
    return schemaSql;
}

function columnDefToSqlSchema(
    columnName: string,
    columnDef: kp.hybrid.DataFrameColumnDef,
): string {
    let sql = columnName;
    if (columnDef.type === "string") {
        sql += " TEXT";
    } else {
        sql += " REAL";
    }
    if (columnDef.optional !== undefined && columnDef.optional === false) {
        sql += " NOT NULL";
    }

    return sql;
}

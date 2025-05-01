// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sqlite from "better-sqlite3";
import * as kp from "knowpro";
import { sql_makeInPlaceholders } from "./sqliteCommon.js";

export class SqliteDataFrame implements kp.dataFrame.IDataFrame {
    public columns: kp.dataFrame.DataFrameColumns;

    private sql_add: sqlite.Statement;
    private sql_getAll: sqlite.Statement;
    private recordColumnNames: string[];

    constructor(
        public db: sqlite.Database,
        public name: string,
        columns:
            | kp.dataFrame.DataFrameColumns
            | [string, kp.dataFrame.DataFrameColumnDef][],
        ensureDb: boolean = true,
    ) {
        if (Array.isArray(columns)) {
            this.columns = new Map<string, kp.dataFrame.DataFrameColumnDef>(
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

    public addRows(...rows: kp.dataFrame.DataFrameRow[]): void {
        for (const row of rows) {
            const rowValues = this.getAddValues(row);
            this.sql_add.run(rowValues);
        }
    }

    public getRow(
        columnName: string,
        columnValue: kp.dataFrame.DataFrameValue,
        op: kp.ComparisonOp,
    ): kp.dataFrame.DataFrameRow[] | undefined {
        const stmt = this.sqlGet(columnName, op);
        let rows: kp.dataFrame.DataFrameRow[] = [];
        for (const row of stmt.iterate(columnValue)) {
            rows.push(this.toDataFrameRow(row));
        }
        return rows;
    }

    public findRows(
        searchTerms: kp.dataFrame.DataFrameTermGroup,
    ): kp.dataFrame.DataFrameRow[] | undefined {
        const dfRows: kp.dataFrame.DataFrameRow[] = [];
        const stmt = this.queryRows(searchTerms);
        for (const row of stmt.iterate()) {
            dfRows.push(this.toDataFrameRow(row));
        }
        return dfRows;
    }

    public findSources(
        searchTerms: kp.dataFrame.DataFrameTermGroup,
    ): kp.dataFrame.RowSourceRef[] | undefined {
        const sources: kp.dataFrame.RowSourceRef[] = [];
        const stmt = this.queryRows(searchTerms);
        for (const row of stmt.iterate()) {
            sources.push(this.deserializeSourceRef(row as SqliteDataFrameRow));
        }
        return sources;
    }

    public *[Symbol.iterator](): Iterator<kp.dataFrame.DataFrameRow> {
        for (let row of this.sql_getAll.iterate()) {
            const value = this.toDataFrameRow(row);
            if (value !== undefined) {
                yield value;
            }
        }
    }

    private queryRows(
        searchTerms: kp.dataFrame.DataFrameTermGroup,
    ): sqlite.Statement {
        let sql = `SELECT sourceRef from ${this.name} WHERE `;
        const where = dataFrameTermGroupToSql(searchTerms, this.columns);
        sql += where;
        return this.db.prepare(sql);
    }

    private toDataFrameRow(row: unknown): kp.dataFrame.DataFrameRow {
        return {
            sourceRef: this.deserializeSourceRef(row as SqliteDataFrameRow),
            record: row as kp.dataFrame.DataFrameRecord,
        };
    }

    private deserializeSourceRef(
        row: SqliteDataFrameRow,
    ): kp.dataFrame.RowSourceRef {
        return JSON.parse(row.sourceRef);
    }

    private getAddValues(row: kp.dataFrame.DataFrameRow) {
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

    private serializeSourceRef(sr: kp.dataFrame.RowSourceRef) {
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
        let schemaSql = dataFrameToSchemaSql(this.name, this.columns);
        if (!schemaSql) {
            throw new Error(`No schema for Sqlite data frame ${this.name}`);
        }
        this.db.exec(schemaSql);
        let indexSql = dataFrameToIndexSql(this.name, this.columns);
        if (indexSql) {
            this.db.exec(indexSql);
        }
    }
}

export interface SqliteDataFrameRow {
    sourceRef: string;
}

export function dataFrameTermGroupToSql(
    group: kp.dataFrame.DataFrameTermGroup,
    colDefs: kp.dataFrame.DataFrameColumns,
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
    term: kp.dataFrame.DataFrameSearchTerm,
    colDef: kp.dataFrame.DataFrameColumnDef,
): string {
    const op = comparisonOpToSql(term.compareOp ?? kp.ComparisonOp.Eq);
    const val = searchTermToSql(term.columnValue, colDef);
    return `${term.columnName} ${op} ${val}`;
}

export function searchTermToSql(
    valueTerm: kp.SearchTerm,
    columnDef: kp.dataFrame.DataFrameColumnDef,
): string {
    const valueText = valueTerm.term.text;
    if (columnDef.type === "number") {
        return valueText;
    }
    return `'${valueText}'`;
}

export function boolOpToSql(group: kp.dataFrame.DataFrameTermGroup): string {
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

export function dataFrameToSchemaSql(
    dfName: string,
    colDefs: kp.dataFrame.DataFrameColumns,
): string {
    if (colDefs.size === 0) {
        return "";
    }
    let columns: string[] = [];
    columns.push("rowId INTEGER PRIMARY KEY AUTOINCREMENT");
    columns.push("sourceRef TEXT NOT NULL");
    for (const [columnName, columnDef] of colDefs) {
        columns.push(columnDefToSchemaSql(columnName, columnDef));
    }
    let schemaSql = `CREATE TABLE IF NOT EXISTS ${dfName} (\n${columns.join(", \n")}\n)`;
    return schemaSql;
}

export function dataFrameToIndexSql(
    dfName: string,
    colDefs: kp.dataFrame.DataFrameColumns,
): string {
    if (colDefs.size === 0) {
        return "";
    }
    let indexes: string[] = [];
    for (const [columnName, columnDef] of colDefs) {
        if (columnDef.index) {
            indexes.push(columnDefToIndexSql(dfName, columnName, columnDef));
        }
    }
    return indexes.join("\n");
}

function columnDefToSchemaSql(
    columnName: string,
    columnDef: kp.dataFrame.DataFrameColumnDef,
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

function columnDefToIndexSql(
    dfName: string,
    columnName: string,
    columnDef: kp.dataFrame.DataFrameColumnDef,
) {
    let sql = `CREATE INDEX IF NOT EXISTS idx_${columnName} ON ${dfName} (${columnName});`;
    return sql;
}

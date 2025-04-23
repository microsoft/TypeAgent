// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sqlite from "better-sqlite3";
import * as kp from "knowpro";
import { sql_makeInPlaceholders } from "./sqliteCommon.js";

export class SqliteDataFrame<TRow extends SqliteDataFrameRow>
    implements kp.hybrid.IDataFrame
{
    private sql_add: sqlite.Statement;
    private sql_getAll: sqlite.Statement;

    constructor(
        public db: sqlite.Database,
        public name: string,
        public columns: kp.hybrid.DataFrameColumns,
        ensureDb: boolean = true,
    ) {
        if (ensureDb) {
            this.ensureDb();
        }
        this.sql_add = this.sqlAdd();
        this.sql_getAll = this.sqlGetAll();
    }

    public addRows(...rows: kp.hybrid.DataFrameRow[]): void {
        for (const row of rows) {
            const rowValues = this.getAddValues(row);
            this.sql_add.run(...rowValues);
        }
    }

    public getRow(
        columnName: string,
        columnValue: kp.hybrid.DataFrameValue,
        op: kp.ComparisonOp,
    ): kp.hybrid.DataFrameRow[] | undefined {
        let stmt = this.sqlGet(columnName, op);
        let row = stmt.get(valueToSql(columnValue));
        if (row === undefined) {
            return undefined;
        }
        return [this.toDataFrameRow(row)];
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
        const colNames = this.prepareColumnNames(Object.keys(row.record));
        for (const colName of colNames) {
            values.push(row.record[colName]);
        }
        return values;
    }

    private getColumnNames() {
        const colNames = this.prepareColumnNames(this.columns.keys());
        return ["sourceRef", ...colNames];
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
        const columnNames = this.getColumnNames();
        const sql = `INSERT INTO ${this.name} (${columnNames.join(", ")}) VALUES ${sql_makeInPlaceholders(columnNames.length)}`;
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

export function valueToSql(value: kp.hybrid.DataFrameValue) {
    return typeof value === "number" ? value : `${value}`;
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
) {
    let schemaSql = `CREATE TABLE IF NOT EXISTS ${dfName} (
        rowId INTEGER PRIMARY KEY AUTOINCREMENT,
        sourceRef TEXT NOT NULL
    `;
    for (const [columnName, columnDef] of colDefs) {
        schemaSql += ",\n";
        schemaSql += columnDefToSqlSchema(columnName, columnDef);
    }
    schemaSql += `\n)`;
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

    return sql.toUpperCase();
}

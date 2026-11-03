// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type * as sqlite from "better-sqlite3";
import * as kp from "@typeagent/knowpro";
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
        const rows: kp.dataFrame.DataFrameRow[] = [];
        if (!this.columns.has(columnName))
            throw new Error(`Column ${columnName} not found in ${this.name}`);
        if (columnValue === undefined) return undefined;
        const stmt = this.sqlGet(columnName, op);
        for (const row of stmt.iterate(columnValue)) {
            rows.push(this.toDataFrameRow(row));
        }
        return rows.length ? rows : undefined;
    }

    public findRows(
        searchTerms: kp.dataFrame.DataFrameTermGroup,
    ): kp.dataFrame.DataFrameRow[] | undefined {
        const dfRows: kp.dataFrame.DataFrameRow[] = [];
        const { stmt, values } = this.queryRows(searchTerms);
        for (const row of stmt.iterate(...values)) {
            dfRows.push(this.toDataFrameRow(row));
        }
        return dfRows.length ? dfRows : undefined;
    }

    public findSources(
        searchTerms: kp.dataFrame.DataFrameTermGroup,
    ): kp.dataFrame.RowSourceRef[] | undefined {
        const sources: kp.dataFrame.RowSourceRef[] = [];
        const { stmt, values } = this.queryRows(searchTerms);
        for (const row of stmt.iterate(...values)) {
            sources.push(this.deserializeSourceRef(row as SqliteDataFrameRow));
        }
        return sources.length ? sources : undefined;
    }

    public *[Symbol.iterator](): Iterator<kp.dataFrame.DataFrameRow> {
        for (const row of this.sql_getAll.iterate()) {
            const value = this.toDataFrameRow(row);
            if (value !== undefined) {
                yield value;
            }
        }
    }

    private queryRows(searchTerms: kp.dataFrame.DataFrameTermGroup): {
        stmt: sqlite.Statement;
        values: (string | number)[];
    } {
        const values = searchTerms.terms.map((term) => {
            const def = this.columns.get(term.columnName);
            if (!def)
                throw new Error(`Unknown dataframe column ${term.columnName}`);
            if (def.type === "string") return term.columnValue.term.text;
            const number = Number(term.columnValue.term.text);
            if (!term.columnValue.term.text.trim() || !Number.isFinite(number))
                throw new Error(
                    `Invalid numeric dataframe value for ${term.columnName}`,
                );
            return number;
        });
        let sql = `SELECT * from ${quoteIdentifier(this.name)} WHERE `;
        const where = dataFrameTermGroupToSql(searchTerms, this.columns);
        if (searchTerms.booleanOp === "or_max" && searchTerms.terms.length) {
            const hits = searchTerms.terms
                .map(
                    (term) =>
                        `CASE WHEN ${dataFrameSearchTermToSql(term, this.columns.get(term.columnName)!)} THEN 1 ELSE 0 END`,
                )
                .join(" + ");
            return {
                stmt: this.db.prepare(`WITH matched AS (
                    SELECT *, (${hits}) AS df_hits FROM ${quoteIdentifier(this.name)}
                ) SELECT * FROM matched WHERE df_hits>0 AND df_hits=(SELECT MAX(df_hits) FROM matched)`),
                values,
            };
        }
        sql += where;
        return { stmt: this.db.prepare(sql), values };
    }

    private toDataFrameRow(row: unknown): kp.dataFrame.DataFrameRow {
        const record: kp.dataFrame.DataFrameRecord = {};
        const data = row as Record<string, unknown>;
        for (const name of this.columns.keys()) {
            const value = data[name];
            if (
                value !== null &&
                typeof value !== "number" &&
                typeof value !== "string"
            )
                throw new Error(`Invalid stored dataframe value for ${name}`);
            record[name] = value === null ? undefined : value;
        }
        return {
            sourceRef: this.deserializeSourceRef(row as SqliteDataFrameRow),
            record,
        };
    }

    private deserializeSourceRef(
        row: SqliteDataFrameRow,
    ): kp.dataFrame.RowSourceRef {
        return JSON.parse(row.sourceRef);
    }

    private getAddValues(row: kp.dataFrame.DataFrameRow) {
        const values: (string | number | null)[] = [];
        values.push(this.serializeSourceRef(row.sourceRef));
        for (const colName of this.recordColumnNames) {
            values.push(row.record[colName] ?? null);
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
        const sql = `SELECT * from ${quoteIdentifier(this.name)} WHERE ${quoteIdentifier(columnName)} ${comparisonOpToSql(op)} ?`;
        return this.db.prepare(sql);
    }

    private sqlGetAll() {
        return this.db.prepare(`SELECT * FROM ${quoteIdentifier(this.name)}`);
    }

    private sqlAdd() {
        const columnNames = ["sourceRef", ...this.recordColumnNames];
        const sql = `INSERT INTO ${quoteIdentifier(this.name)} (${columnNames.map(quoteIdentifier).join(", ")}) VALUES (${sql_makeInPlaceholders(columnNames.length)})`;
        return this.db.prepare(sql);
    }

    private ensureDb() {
        const schemaSql = dataFrameToSchemaSql(this.name, this.columns);
        if (!schemaSql) {
            throw new Error(`No schema for Sqlite data frame ${this.name}`);
        }
        this.db.exec(schemaSql);
        const indexSql = dataFrameToIndexSql(this.name, this.columns);
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
    const clauses: string[] = [];
    for (const searchTerm of group.terms) {
        const colDef = colDefs.get(searchTerm.columnName);
        if (!colDef) {
            throw new Error(
                `Column ${searchTerm.columnName} not found in ${group.dataFrame.name}`,
            );
        }
        clauses.push(dataFrameSearchTermToSql(searchTerm, colDef));
    }
    const boolOp = boolOpToSql(group);
    return clauses.length > 1
        ? `(${clauses.join(boolOp)})`
        : (clauses[0] ?? "0");
}

export function dataFrameSearchTermToSql(
    term: kp.dataFrame.DataFrameSearchTerm,
    _colDef: kp.dataFrame.DataFrameColumnDef,
): string {
    const op = comparisonOpToSql(term.compareOp ?? kp.ComparisonOp.Eq);
    return `${quoteIdentifier(term.columnName)} ${op} ?`;
}

export function searchTermToSql(
    valueTerm: kp.SearchTerm,
    columnDef: kp.dataFrame.DataFrameColumnDef,
): string {
    const valueText = valueTerm.term.text;
    if (columnDef.type === "number") {
        if (!valueText.trim() || !Number.isFinite(Number(valueText)))
            throw new Error("Invalid numeric dataframe value");
        return String(Number(valueText));
    }
    return `'${valueText.replaceAll("'", "''")}'`;
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
    throw new Error(`Invalid dataframe comparison operator ${op}`);
}

export function dataFrameToSchemaSql(
    dfName: string,
    colDefs: kp.dataFrame.DataFrameColumns,
): string {
    if (colDefs.size === 0) {
        return "";
    }
    const columns: string[] = [];
    columns.push("rowId INTEGER PRIMARY KEY AUTOINCREMENT");
    columns.push("sourceRef TEXT NOT NULL");
    for (const [columnName, columnDef] of colDefs) {
        columns.push(columnDefToSchemaSql(columnName, columnDef));
    }
    const schemaSql = `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(dfName)} (\n${columns.join(", \n")}\n)`;
    return schemaSql;
}

export function dataFrameToIndexSql(
    dfName: string,
    colDefs: kp.dataFrame.DataFrameColumns,
): string {
    if (colDefs.size === 0) {
        return "";
    }
    const indexes: string[] = [];
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
    let sql = quoteIdentifier(columnName);
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
    const sql = `CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`idx_${dfName}_${columnName}`)} ON ${quoteIdentifier(dfName)} (${quoteIdentifier(columnName)});`;
    return sql;
}

function quoteIdentifier(name: string): string {
    if (!name || name.includes("\0"))
        throw new Error("Invalid dataframe identifier");
    return `"${name.replaceAll('"', '""')}"`;
}

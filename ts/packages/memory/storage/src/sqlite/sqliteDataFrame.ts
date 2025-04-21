// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sqlite from "better-sqlite3";
import * as kp from "knowpro";

export class SqliteDataFrame implements kp.IDataFrame {
    constructor(
        public db: sqlite.Database,
        public name: string,
        public columns: kp.DataFrameColumns,
        ensureExists: boolean = true,
    ) {
        if (ensureExists) {
            this.ensureDb();
        }
    }

    public addRows(...rows: kp.DataFrameRow[]): void {
        throw new Error("Method not implemented.");
    }

    public getRow(
        columnName: string,
        columnValue: kp.DataFrameValue,
        op: kp.ComparisonOp,
    ): kp.DataFrameRow[] | undefined {
        throw new Error("Method not implemented.");
    }

    findRows(
        searchTerms: kp.DataFrameTermGroup,
    ): kp.DataFrameRow[] | undefined {
        throw new Error("Method not implemented.");
    }

    findSources(
        searchTerms: kp.DataFrameTermGroup,
    ): kp.RowSourceRef[] | undefined {
        throw new Error("Method not implemented.");
    }

    [Symbol.iterator](): Iterator<kp.DataFrameRow, any, any> {
        throw new Error("Method not implemented.");
    }

    private ensureDb(): void {
        if (this.columns.size === 0) {
            return;
        }
        let schemaSql = `CREATE TABLE IF NOT EXISTS ${this.name} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sourceRef TEXT NOT NULL
        `;
        for (const [columnName, columnDef] of this.columns) {
            schemaSql += ",\n";
            schemaSql += this.columnDefToSql(columnName, columnDef);
        }
        schemaSql += `\n)`;
        this.db.exec(schemaSql);
    }

    private columnDefToSql(
        columnName: string,
        columnDef: kp.DataFrameColumnDef,
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
    /*
    private sqlFindRows(termGroup: kp.DataFrameTermGroup) {
        const where = dataFrameTermGroupToSql(termGroup, this.columns);
        let sql = `SELECT * from ${this.name}\n WHERE ${where}`;
        return sql;
    }
        */
}

export function dataFrameTermGroupToSql(
    group: kp.DataFrameTermGroup,
    colDefs: kp.DataFrameColumns,
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
    term: kp.DataFrameSearchTerm,
    colDef: kp.DataFrameColumnDef,
): string {
    const op = comparisonOpToSql(term.compareOp ?? kp.ComparisonOp.Eq);
    const val = searchTermToSql(term.columnValue, colDef);
    return `${term.columnName} ${op} ${val}`;
}

export function searchTermToSql(
    valueTerm: kp.SearchTerm,
    columnDef: kp.DataFrameColumnDef,
): string {
    const valueText = valueTerm.term.text;
    if (columnDef.type === "number") {
        return valueText;
    }
    return `'${valueText}'`;
}

export function valueToSql(value: kp.DataFrameValue) {
    return typeof value === "number" ? value : `${value}`;
}

export function boolOpToSql(group: kp.DataFrameTermGroup): string {
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

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sqlite from "better-sqlite3";
import * as kp from "knowpro";

export class SqliteDataFrame implements kp.hybrid.IDataFrame {
    constructor(
        public db: sqlite.Database,
        public name: string,
        public columns: kp.hybrid.DataFrameColumns,
    ) {}

    public addRows(...rows: kp.hybrid.DataFrameRow[]): void {
        throw new Error("Method not implemented.");
    }

    public getRow(
        columnName: string,
        columnValue: kp.hybrid.DataFrameValue,
        op: kp.ComparisonOp,
    ): kp.hybrid.DataFrameRow[] | undefined {
        throw new Error("Method not implemented.");
    }

    public findRows(
        searchTerms: kp.hybrid.DataFrameTermGroup,
    ): kp.hybrid.DataFrameRow[] | undefined {
        throw new Error("Method not implemented.");
    }

    public findSources(
        searchTerms: kp.hybrid.DataFrameTermGroup,
    ): kp.hybrid.RowSourceRef[] | undefined {
        throw new Error("Method not implemented.");
    }

    [Symbol.iterator](): Iterator<kp.hybrid.DataFrameRow, any, any> {
        throw new Error("Method not implemented.");
    }

    protected *queryRows<TRow extends SqliteDataFrameRow>(
        searchTerms: kp.hybrid.DataFrameTermGroup,
    ): IterableIterator<TRow> {
        let sql = `SELECT sourceRef from ${this.name} WHERE `;
        const where = dataFrameTermGroupToSql(searchTerms, this.columns);
        sql += where;
        const stmt = this.db.prepare(sql);
        for (const row of stmt.iterate()) {
            yield row as TRow;
        }
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

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextRange } from "./interfaces.js";
import { ComparisonOp } from "./queryCmp.js";

/**
 * Data Frame definition.
 * Since TypeScript type information is NOT available at runtime, we need to
 * build and keep this metadata to validate DataFrameActions: column names etc
 */
export type DataFrameDef = {
    /**
     * Name of the data frame. Default is DataFrame
     */
    name: string;
    /**
     * Columns in the data frame
     */
    columns: DataFrameColumnDef[];
};

export type ValueType = "number" | "string";

/**
 * A column in a data frame
 */
export type DataFrameColumnDef = {
    name: string;
    type?: ValueType;
};

export interface IDataFrameRow {
    sourceOrdinal: number;
    /**
     * If this data frame row was either extracted from OR
     * associated with a particular text range
     */
    range?: TextRange | undefined;
}

export type DataFrameValue = number | string;

export interface IDataFrame<TRow extends IDataFrameRow> {
    readonly definition: DataFrameDef;
    addRows(...rows: TRow[]): Promise<void>;
    findRows(
        name: string,
        value: DataFrameValue,
        op?: ComparisonOp,
    ): Promise<TRow[] | undefined>;
}

/**
 * Simple in-memory data frame that currently implements lookups using loops
 * However, these can be easily optimized
 */
export class DataFrame<TRow extends IDataFrameRow> implements IDataFrame<TRow> {
    public rows: TRow[] = [];

    constructor(public readonly definition: DataFrameDef) {}

    public addRows(...rows: TRow[]): Promise<void> {
        this.rows.push(...rows);
        return Promise.resolve();
    }

    public findRows(
        name: string,
        value: DataFrameValue,
        op?: ComparisonOp,
    ): Promise<TRow[] | undefined> {
        op ??= ComparisonOp.Eq;
        let matches: TRow[] | undefined;
        for (const row of this.rows) {
            if (this.matchRow(row, name, value, op)) {
                matches ??= [];
                matches.push(row);
            }
        }
        return Promise.resolve(matches);
    }

    private matchRow(
        row: any,
        name: string,
        value: DataFrameValue,
        op: ComparisonOp,
    ): boolean {
        const propertyValue = row[name];
        if (propertyValue === undefined) {
            return false;
        }
        switch (op) {
            default:
                return false;
            case ComparisonOp.Eq:
                return value === propertyValue;
            case ComparisonOp.Lt:
                return value < propertyValue;
            case ComparisonOp.Lte:
                return value <= propertyValue;
            case ComparisonOp.Gt:
                return value > propertyValue;
            case ComparisonOp.Gte:
                return value >= propertyValue;
            case ComparisonOp.Neq:
                return value !== propertyValue;
        }
    }
}

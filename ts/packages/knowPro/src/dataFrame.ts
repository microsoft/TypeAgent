// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { PropertySearchTerm, TextLocation } from "./interfaces.js";

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
    key: TextLocation;
}

export interface IDataFrame<TRow extends IDataFrameRow> {
    readonly definition: DataFrameDef;
    addRows(row: TRow | TRow[]): Promise<void>;
    searchTerm(searchTerm: PropertySearchTerm): TRow | undefined;
}

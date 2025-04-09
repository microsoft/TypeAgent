// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SemanticRefSearchResult } from "./interfaces.js";
import { SearchSelectExpr } from "./interfaces.js";

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

export interface IDataFrame {
    readonly definition: DataFrameDef;
    evalQuery(selectExpr: SearchSelectExpr): Promise<SemanticRefSearchResult>;
}

export class MemoryDataFrame implements IDataFrame {
    private def: DataFrameDef;

    constructor(def: DataFrameDef) {
        this.def = def;
    }

    public get definition(): DataFrameDef {
        return this.def;
    }

    public async evalQuery(
        selectExpr: SearchSelectExpr,
    ): Promise<SemanticRefSearchResult> {
        throw new Error("Method not implemented.");
    }
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

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

/**
 * A column in a data frame
 */
export type DataFrameColumnDef = {
    name: string;
    type?: string;
};

export function getColumnDef(
    frameDef: DataFrameDef,
    columnName: string,
): DataFrameColumnDef | undefined {
    return frameDef.columns.find((c) => c.name === columnName);
}

/**
 * INFER a data frame definition from a prototypical record.
 * The keys of the record become column names.
 * The types of the values become the column data types
 *
 * I am sure there is a better way to do this
 * @param obj
 */
export function dataFrameDefForType<T extends object>(record: T): DataFrameDef {
    const columns: DataFrameColumnDef[] = [];
    for (let key in Object.keys(record)) {
        const value = record[key as keyof T];
        columns.push({ name: key, type: typeof value });
    }
    return { name: "DataFrame", columns: columns };
}

export function dataFrameDefToSqlSchema(dataFrame: DataFrameDef): string {
    let sql = `${dataFrame.name}\n{\n`;
    const columns = dataFrame.columns;
    for (let i = 0; i < columns.length; ++i) {
        const col = columns[i];
        let colSql = col.type
            ? `${col.name} ${col.type}`
            : `${col.name} string`;
        if (i < columns.length - 1) {
            colSql += ",\n";
        } else {
            colSql += "\n";
        }
        sql += "  " + colSql;
    }
    return sql + "}\n";
}

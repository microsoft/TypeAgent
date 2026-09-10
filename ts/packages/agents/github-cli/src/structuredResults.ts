// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TableBlock, TableCell } from "@typeagent/agent-sdk";
import {
    ColumnSpec,
    TableBuildOptions,
    createTable,
} from "@typeagent/agent-sdk/helpers/display";

// Build a TableBlock from column specs and records. A ColumnSpec pairs a
// column definition with an accessor; the accessor is stripped here so only
// the column definition goes on the wire.
export function buildTableBlock<T>(
    colSpecs: ColumnSpec<T>[],
    records: T[],
    options?: TableBuildOptions,
): TableBlock {
    const columns = colSpecs.map(({ value: _value, ...col }) => col);
    const rows: TableCell[][] = records.map((record) =>
        colSpecs.map((col) => col.value(record)),
    );
    return createTable(columns, rows, options);
}

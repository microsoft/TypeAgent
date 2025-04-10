// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { MatchAccumulator } from "./collections.js";
import { DataFrameRow, DataFrameRowId, IDataFrame } from "./dataFrame.js";
import { PropertySearchTerm, Term } from "./interfaces.js";
import { QueryEvalContext, QueryOpExpr } from "./query.js";
import { ComparisonOp } from "./queryCmp.js";

export class MatchDataFrameColumnExpr extends QueryOpExpr<
    DataFrameRowAccumulator | undefined
> {
    constructor(
        public dataFrame: IDataFrame,
        public propertySearchTerm: PropertySearchTerm,
        public comparisonOp: ComparisonOp = ComparisonOp.Eq,
    ) {
        super();
    }

    public override eval(
        context: QueryEvalContext,
    ): DataFrameRowAccumulator | undefined {
        const matches = new DataFrameRowAccumulator();
        this.accumulateMatches(context, matches);
        if (matches.size > 0) {
            return matches;
        }
        return undefined;
    }

    private accumulateMatches(
        context: QueryEvalContext,
        matches: DataFrameRowAccumulator,
    ): void {
        const columnName =
            typeof this.propertySearchTerm.propertyName === "string"
                ? this.propertySearchTerm.propertyName
                : this.propertySearchTerm.propertyName.term.text;
        const columnValue = this.propertySearchTerm.propertyValue;
        this.accumulateColumnMatches(
            context,
            columnName,
            columnValue.term,
            matches,
        );
        if (columnValue.relatedTerms) {
            for (const relatedValue of columnValue.relatedTerms) {
                this.accumulateColumnMatches(
                    context,
                    columnName,
                    relatedValue,
                    matches,
                );
            }
        }
    }

    private accumulateColumnMatches(
        context: QueryEvalContext,
        columnName: string,
        columnValue: Term,
        matches: DataFrameRowAccumulator,
    ): void {
        if (!context.matchedPropertyTerms.has(columnName, columnValue)) {
            const rows = this.dataFrame.findRows(
                columnName,
                columnValue.text,
                this.comparisonOp,
            );
            if (rows) {
                // Future: support precomputed scores on rows?
                matches.addRowMatches(rows, 1.0, columnValue.weight);
            }
            context.matchedPropertyTerms.add(columnName, columnValue);
        }
    }
}

export class DataFrameRowAccumulator extends MatchAccumulator<DataFrameRowId> {
    constructor() {
        super();
    }

    public addRowMatches(
        rows: DataFrameRow[] | undefined,
        score: number = 1.0,
        weight: number = 1.0,
    ) {
        if (rows) {
            for (const row of rows) {
                super.add(row.rowId, score * weight, true);
            }
        }
    }
}

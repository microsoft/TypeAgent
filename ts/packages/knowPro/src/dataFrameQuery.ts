// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "assert";
import { MatchAccumulator } from "./collections.js";
import { isPropertyTerm } from "./compileLib.js";
import {
    DataFrameCollection,
    DataFrameColumnDef,
    DataFrameRow,
    DataFrameRowId,
    IDataFrame,
} from "./dataFrame.js";
import {
    PropertySearchTerm,
    SearchTerm,
    SearchTermGroup,
    Term,
} from "./interfaces.js";
import * as q from "./query.js";
import { ComparisonOp } from "./queryCmp.js";

export class MatchDataFrameColumnExpr extends q.QueryOpExpr<
    DataFrameRowAccumulator | undefined
> {
    constructor(public searchTerm: DataFrameSearchTerm) {
        super();
    }

    public override eval(
        context: q.QueryEvalContext,
    ): DataFrameRowAccumulator | undefined {
        const matches = new DataFrameRowAccumulator();
        this.accumulateMatches(context, matches);
        if (matches.size > 0) {
            return matches;
        }
        return undefined;
    }

    private accumulateMatches(
        context: q.QueryEvalContext,
        matches: DataFrameRowAccumulator,
    ): void {
        const columnValue = this.searchTerm.columnValue;
        const comparisonOp = this.searchTerm.compareOp ?? ComparisonOp.Eq;
        this.accumulateColumnMatches(
            context,
            columnValue.term,
            comparisonOp,
            matches,
        );
        if (columnValue.relatedTerms) {
            for (const relatedValue of columnValue.relatedTerms) {
                this.accumulateColumnMatches(
                    context,
                    relatedValue,
                    comparisonOp,
                    matches,
                );
            }
        }
    }

    private accumulateColumnMatches(
        context: q.QueryEvalContext,
        columnValue: Term,
        op: ComparisonOp,
        matches: DataFrameRowAccumulator,
    ): void {
        const column = this.searchTerm.qualifiedColumn;
        if (!context.matchedPropertyTerms.has(column.columnName, columnValue)) {
            const rows = column.dataFrame.findRows(
                column.columnName,
                columnValue.text,
                op,
            );
            if (rows) {
                // Future: support precomputed scores on rows?
                matches.addRows(rows, 1.0, columnValue.weight);
            }
            context.matchedPropertyTerms.add(column.columnName, columnValue);
        }
    }
}

// TODO: this code duplication can be replaced with base generics
export class MatchDataFrameRowBooleanExpr extends q.QueryOpExpr<DataFrameRowAccumulator> {
    constructor(
        public termExpressions: q.IQueryOpExpr<
            DataFrameRowAccumulator | undefined
        >[],
    ) {
        super();
    }

    protected beginMatch(context: q.QueryEvalContext) {
        context.clearMatchedTerms();
    }
}

// TODO: this code duplication can be replaced with base generics
export class MatchDataFrameRowOrExpr extends MatchDataFrameRowBooleanExpr {
    constructor(
        public termExpressions: q.IQueryOpExpr<
            DataFrameRowAccumulator | undefined
        >[],
    ) {
        super(termExpressions);
    }

    public override eval(context: q.QueryEvalContext): DataFrameRowAccumulator {
        this.beginMatch(context);
        let allMatches: DataFrameRowAccumulator | undefined;
        for (const matchExpr of this.termExpressions) {
            const rowMatches = matchExpr.eval(context);
            if (rowMatches === undefined || rowMatches.size === 0) {
                continue;
            }
            if (allMatches) {
                allMatches.addUnion(rowMatches);
            } else {
                allMatches = rowMatches;
            }
        }
        if (allMatches) {
            allMatches.calculateTotalScore();
        }
        return allMatches ?? new DataFrameRowAccumulator();
    }
}

// TODO: this code duplication can be replaced with base generics
export class MatchDataFrameRowAndExpr extends MatchDataFrameRowBooleanExpr {
    constructor(
        public termExpressions: q.IQueryOpExpr<
            DataFrameRowAccumulator | undefined
        >[],
    ) {
        super(termExpressions);
    }

    public override eval(context: q.QueryEvalContext): DataFrameRowAccumulator {
        this.beginMatch(context);

        let allMatches: DataFrameRowAccumulator | undefined;
        let iTerm = 0;
        // Loop over each search term, intersecting the returned results...
        for (; iTerm < this.termExpressions.length; ++iTerm) {
            const rowMatches = this.termExpressions[iTerm].eval(context);
            if (rowMatches === undefined || rowMatches.size === 0) {
                // We can't possibly have an 'and'
                break;
            }
            if (allMatches === undefined) {
                allMatches = rowMatches;
            } else {
                allMatches = allMatches.intersect(rowMatches);
                if (allMatches.size === 0) {
                    // we can't possibly have an 'and'
                    break;
                }
            }
        }
        if (allMatches && allMatches.size > 0) {
            if (iTerm === this.termExpressions.length) {
                allMatches.calculateTotalScore();
                allMatches.selectWithHitCount(this.termExpressions.length);
            } else {
                // And is not possible
                allMatches.clearMatches();
            }
        }
        return allMatches ?? new DataFrameRowAccumulator();
    }
}

export class MatchDataFramesExpr extends q.QueryOpExpr<
    Map<string, DataFrameRow[]>
> {
    constructor(
        public dataFrames: IDataFrame[],
        public matchExpressions: q.IQueryOpExpr<DataFrameRowAccumulator>[],
    ) {
        assert(dataFrames.length === matchExpressions.length);
        super();
    }

    public override eval(
        context: q.QueryEvalContext,
    ): Map<string, DataFrameRow[]> {
        const allRows = new Map<string, DataFrameRow[]>();
        for (let i = 0; i < this.matchExpressions.length; ++i) {
            const rowMatches = this.matchExpressions[i].eval(context);
            const rowIds = [...rowMatches.getMatchedValues()];
            const df = this.dataFrames[i];
            const rows = df.getRows(rowIds);
            allRows.set(df.name, rows);
        }
        return allRows;
    }
}

// TODO: this code duplication can be reduced with base generics
export class DataFrameRowAccumulator extends MatchAccumulator<DataFrameRowId> {
    constructor() {
        super();
    }

    public override add(value: number, score: number): void {
        let match = this.getMatch(value);
        if (match === undefined) {
            match = {
                value,
                score,
                hitCount: 1,
                relatedHitCount: 0,
                relatedScore: 0,
            };
            this.setMatch(match);
        } else if (score > match.score) {
            match.score = score;
            match.hitCount++;
        }
    }

    public addRows(
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

    public override intersect(
        other: DataFrameRowAccumulator,
    ): DataFrameRowAccumulator {
        const intersection = new DataFrameRowAccumulator();
        super.intersect(other, intersection);
        return intersection;
    }
}

export class DataFrameCompiler {
    constructor(public dataFrames: DataFrameCollection) {}

    public compile(termGroup: SearchTermGroup): q.IQueryOpExpr[] {
        const dfTermGroups = this.resolveFramesAndColumns(termGroup);
        let expressions: q.IQueryOpExpr[] = [];
        for (const dfTermGroup of dfTermGroups) {
            const termExpr = this.compileTermGroup(dfTermGroup);
            if (termExpr) {
                expressions.push(termExpr);
            }
        }
        return expressions;
    }

    private compileTermGroup(termGroup: DataFrameTermGroup) {
        if (termGroup.terms.length > 0) {
            let termExpressions: MatchDataFrameColumnExpr[] = [];
            for (const term of termGroup.terms) {
                termExpressions.push(new MatchDataFrameColumnExpr(term));
            }
            return termGroup.booleanOp === "and"
                ? new MatchDataFrameRowAndExpr(termExpressions)
                : new MatchDataFrameRowOrExpr(termExpressions);
        }
        return undefined;
    }

    /***
     * Binds terms to dataFrames and columns
     * They are grouped by the dataFrame in which columns were found
     */
    private resolveFramesAndColumns(
        termGroup: SearchTermGroup,
    ): DataFrameTermGroup[] {
        const dfTermGroups = new Map<string, DataFrameTermGroup>();
        for (const term of termGroup.terms) {
            let qualifiedColumn = undefined;
            let columnValue: SearchTerm | undefined = undefined;
            if (isPropertyTerm(term)) {
                qualifiedColumn = this.resolveColumn(
                    columnNameFromPropertyTerm(term),
                );
                columnValue = term.propertyValue;
            } else {
                // Nested or straight search terms not supported
                continue;
            }
            if (qualifiedColumn !== undefined && columnValue) {
                let dfGroup = dfTermGroups.get(qualifiedColumn.dataFrame.name);
                if (dfGroup === undefined) {
                    dfGroup = {
                        booleanOp: termGroup.booleanOp,
                        terms: [],
                    };
                    dfTermGroups.set(qualifiedColumn.dataFrame.name, dfGroup);
                }
                dfGroup.terms.push({
                    qualifiedColumn,
                    columnValue,
                });
            }
        }
        return [...dfTermGroups.values()];
    }

    private resolveColumn(
        qualifiedColumnName: string,
    ): QualifiedColumn | undefined {
        let [dfName, columnName] =
            this.getFrameAndColumnName(qualifiedColumnName);
        if (dfName) {
            const dataFrame = this.dataFrames.get(dfName);
            if (dataFrame !== undefined) {
                const columnDef = dataFrame.columns.get(columnName);
                if (columnDef !== undefined) {
                    return {
                        dataFrame,
                        columnDef,
                        columnName,
                    };
                }
            }
        } else {
            for (const dataFrame of this.dataFrames.values()) {
                const columnDef = dataFrame.columns.get(columnName);
                if (columnDef !== undefined) {
                    return { dataFrame, columnDef, columnName };
                }
            }
        }
        return undefined;
    }

    private getFrameAndColumnName(text: string): [string | undefined, string] {
        const frameNameStartAt = text.indexOf(".");
        if (frameNameStartAt >= 0) {
            return [
                text.slice(0, frameNameStartAt),
                text.slice(frameNameStartAt + 1),
            ];
        }
        return [undefined, text];
    }
}

type DataFrameTermGroup = {
    booleanOp: "and" | "or" | "or_max";
    terms: DataFrameSearchTerm[];
};

type DataFrameSearchTerm = {
    qualifiedColumn: QualifiedColumn;
    columnValue: SearchTerm;
    compareOp?: ComparisonOp;
};

type QualifiedColumn = {
    dataFrame: IDataFrame;
    columnName: string;
    columnDef: DataFrameColumnDef;
};

function columnNameFromPropertyTerm(propertySearchTerm: PropertySearchTerm) {
    return typeof propertySearchTerm.propertyName === "string"
        ? propertySearchTerm.propertyName
        : propertySearchTerm.propertyName.term.text;
}

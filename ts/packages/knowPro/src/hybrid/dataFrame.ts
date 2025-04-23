// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { MatchAccumulator, setIntersect, setUnion } from "../collections.js";
import { DataFrameCompiler } from "./dataFrameQuery.js";
import {
    ScoredMessageOrdinal,
    SearchTerm,
    SearchTermGroup,
    TextRange,
} from "../interfaces.js";
import { ComparisonOp } from "../queryCmp.js";
import { createDefaultSearchOptions, SearchOptions } from "../search.js";

/**
 * EXPERIMENTAL CODE. SUBJECT TO RAPID CHANGE
 */

export type DataFrameValueType = "number" | "string";

/**
 * A column in a data frame
 */
export type DataFrameColumnDef = {
    type: DataFrameValueType;
    optional?: boolean | undefined;
};

export type DataFrameColumns = ReadonlyMap<string, DataFrameColumnDef>;

export type RowSourceRef = {
    range: TextRange;
    score?: number | undefined;
};

export type DataFrameRow = {
    sourceRef: RowSourceRef;
    record: DataFrameRecord;
};

export type DataFrameRecord = Record<string, DataFrameValue>;
export type DataFrameValue = number | string | undefined;

export interface IDataFrame extends Iterable<DataFrameRow> {
    /**
     * Name of the data frame. Default is DataFrame
     */
    readonly name: string;
    /**
     * Columns in the data frame
     */
    readonly columns: DataFrameColumns;

    addRows(...rows: DataFrameRow[]): void;
    getRow(
        columnName: string,
        columnValue: DataFrameValue,
        op: ComparisonOp,
    ): DataFrameRow[] | undefined;
    findRows(searchTerms: DataFrameTermGroup): DataFrameRow[] | undefined;
    findSources(searchTerms: DataFrameTermGroup): RowSourceRef[] | undefined;
}

export type DataFrameCollection = ReadonlyMap<string, IDataFrame>;

export type DataFrameTermGroup = {
    booleanOp: "and" | "or" | "or_max";
    dataFrame: IDataFrame;
    terms: DataFrameSearchTerm[];
};

export type DataFrameSearchTerm = {
    columnName: string;
    columnValue: SearchTerm;
    compareOp?: ComparisonOp;
};

/**
 * Sample, in-memory data frame that currently implements lookups using loops
 * In actuality, DataFrames will use more optimal storage like Sql
 */
export class DataFrame implements IDataFrame {
    private rows: DataFrameRow[] = [];
    public columns: DataFrameColumns;

    constructor(
        public name: string,
        columns: DataFrameColumns | [string, DataFrameColumnDef][],
    ) {
        if (Array.isArray(columns)) {
            this.columns = new Map<string, DataFrameColumnDef>(columns);
        } else {
            this.columns = columns;
        }
    }

    public [Symbol.iterator](): Iterator<DataFrameRow> {
        return this.rows[Symbol.iterator]();
    }

    public addRows(...rows: DataFrameRow[]): void {
        this.rows.push(...rows);
    }

    public getRow(
        columnName: string,
        columnValue: DataFrameValue,
        compareOp: ComparisonOp,
    ): DataFrameRow[] | undefined {
        let ordinals = this.findRowOrdinals(columnName, columnValue, compareOp);
        const rows = this.getRows(ordinals);
        return rows.length > 0 ? rows : undefined;
    }

    public findRows(
        searchTerms: DataFrameTermGroup,
    ): DataFrameRow[] | undefined {
        let ordinalSet = this.searchBoolean(searchTerms);
        if (ordinalSet === undefined || ordinalSet.size === 0) {
            return undefined;
        }
        return this.getRows(ordinalSet.values());
    }

    public findSources(
        searchTerms: DataFrameTermGroup,
    ): RowSourceRef[] | undefined {
        let ordinalSet = this.searchBoolean(searchTerms);
        if (ordinalSet === undefined || ordinalSet.size === 0) {
            return undefined;
        }
        return this.getSources(ordinalSet.values());
    }

    private *findRowOrdinals(
        columnName: string,
        value: DataFrameValue,
        op?: ComparisonOp,
    ): IterableIterator<number> {
        if (!this.columns.has(columnName)) {
            return;
        }
        op ??= ComparisonOp.Eq;
        for (let rowOrdinal = 0; rowOrdinal < this.rows.length; ++rowOrdinal) {
            if (
                this.matchRecord(
                    this.rows[rowOrdinal].record,
                    columnName,
                    value,
                    op,
                )
            ) {
                yield rowOrdinal;
            }
        }
    }

    private getSources(ordinals: IterableIterator<number>) {
        const rows: RowSourceRef[] = [];
        for (const ordinal of ordinals) {
            rows.push(this.rows[ordinal].sourceRef);
        }
        return rows;
    }

    private getRows(ordinals: IterableIterator<number>) {
        const rows: DataFrameRow[] = [];
        for (const ordinal of ordinals) {
            rows.push(this.rows[ordinal]);
        }
        return rows;
    }

    private searchBoolean(
        searchTerms: DataFrameTermGroup,
    ): Set<number> | undefined {
        let ordinalSet: Set<number> | undefined;
        switch (searchTerms.booleanOp) {
            default:
                ordinalSet = this.searchOr(searchTerms);
                break;
            case "or_max":
                ordinalSet = this.searchOrMax(searchTerms);
                break;
            case "and":
                ordinalSet = this.searchAnd(searchTerms);
                break;
        }
        return ordinalSet;
    }

    private searchAnd(
        searchTerms: DataFrameTermGroup,
    ): Set<number> | undefined {
        let andSet: Set<number> | undefined;
        for (const term of searchTerms.terms) {
            andSet = setIntersect(
                andSet,
                this.findRowOrdinals(
                    term.columnName,
                    term.columnValue.term.text,
                    term.compareOp,
                ),
            );
            if (andSet === undefined || andSet.size === 0) {
                return undefined;
            }
        }
        return andSet;
    }

    private searchOr(searchTerms: DataFrameTermGroup): Set<number> | undefined {
        let orSet: Set<number> | undefined;
        for (const term of searchTerms.terms) {
            orSet = setUnion(
                orSet,
                this.findRowOrdinals(
                    term.columnName,
                    term.columnValue.term.text,
                    term.compareOp,
                ),
            );
        }
        return orSet;
    }

    private searchOrMax(
        searchTerms: DataFrameTermGroup,
    ): Set<number> | undefined {
        let matches: MatchAccumulator<number> = new MatchAccumulator();
        for (const term of searchTerms.terms) {
            for (const ordinal of this.findRowOrdinals(
                term.columnName,
                term.columnValue.term.text,
                term.compareOp,
            )) {
                matches.add(ordinal, 1.0, true);
            }
        }
        if (matches.size === 0) {
            return undefined;
        }
        const maxHitCount = matches.getMaxHitCount();
        if (maxHitCount > 1) {
            matches.selectWithHitCount(maxHitCount);
        }
        return new Set<number>(matches.getMatchedValues());
    }

    private matchRecord(
        rowData: DataFrameRecord,
        name: string,
        value: DataFrameValue,
        op: ComparisonOp,
    ): boolean {
        const propertyValue = (rowData as any)[name];
        if (value === undefined || propertyValue === undefined) {
            return false;
        }
        switch (op) {
            default:
                return false;
            case ComparisonOp.Eq:
                return value == propertyValue;
            case ComparisonOp.Lt:
                return value < propertyValue;
            case ComparisonOp.Lte:
                return value <= propertyValue;
            case ComparisonOp.Gt:
                return value > propertyValue;
            case ComparisonOp.Gte:
                return value >= propertyValue;
            case ComparisonOp.Neq:
                return value != propertyValue;
        }
    }
}

export function isDataFrameGroup(
    term: DataFrameTermGroup | DataFrameSearchTerm,
): term is DataFrameTermGroup {
    return term.hasOwnProperty("booleanOp");
}

export function searchDataFrames(
    dataFrames: DataFrameCollection,
    searchTermGroup: SearchTermGroup,
    options?: SearchOptions,
): ScoredMessageOrdinal[] | undefined {
    options ??= createDefaultSearchOptions();
    let dataFrameMatches: ScoredMessageOrdinal[] | undefined;
    const dfCompiler = new DataFrameCompiler(dataFrames);
    const dfQuery = dfCompiler.compile(searchTermGroup);
    if (dfQuery) {
        const dfResults = dfQuery.eval();
        if (dfResults) {
            dataFrameMatches = [];
            for (const match of dfResults.getMatches()) {
                dataFrameMatches.push({
                    messageOrdinal: match.value,
                    score: match.score,
                });
            }
        }
    }
    return dataFrameMatches;
}

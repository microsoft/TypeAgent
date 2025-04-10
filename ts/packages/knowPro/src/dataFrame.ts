// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { MatchAccumulator } from "./collections.js";
import { isPropertyTerm, isSearchGroupTerm } from "./compileLib.js";
import {
    IConversation,
    IMessage,
    PropertySearchTerm,
    SearchTermGroup,
    TextRange,
    WhenFilter,
} from "./interfaces.js";
import { ComparisonOp } from "./queryCmp.js";
import { searchConversationKnowledge, SearchOptions } from "./search.js";

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

export type DataFrameRowId = number;

export interface DataFrameRow<
    TRow extends IDataFrameRowData = IDataFrameRowData,
> {
    readonly rowId: DataFrameRowId;
    data: TRow;
}

export type DataFrameValue = number | string;

export interface IDataFrameRowData {
    /**
     * If this data frame row was either extracted from OR
     * associated with a particular text range
     */
    range?: TextRange | undefined;
    /**
     * Source data that this data frame row was derived from
     */
    sourceId?: number | undefined;
}

export interface IDataFrame<
    TRowData extends IDataFrameRowData = IDataFrameRowData,
> {
    /**
     * Name of the data frame. Default is DataFrame
     */
    readonly name: string;
    /**
     * Columns in the data frame
     */
    readonly columns: DataFrameColumns;
    addRows(...rows: TRowData[]): Promise<void>;
    findRows(
        columnName: string,
        value: DataFrameValue,
        op?: ComparisonOp,
    ): Promise<DataFrameRow<TRowData>[] | undefined>;
}

export type DataFrameCollection = ReadonlyMap<string, IDataFrame>;

/**
 * Sample, in-memory data frame that currently implements lookups using loops
 * In actuality, DataFrames will use more optimal storage like Sql
 */
export class DataFrame<TRowData extends IDataFrameRowData>
    implements IDataFrame<TRowData>
{
    public rows: DataFrameRow<TRowData>[] = [];
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

    public addRows(...rowsToAdd: TRowData[]): Promise<void> {
        for (let i = 0; i < rowsToAdd.length; ++i) {
            this.rows.push({
                rowId: this.rows.length,
                data: rowsToAdd[i],
            });
        }
        return Promise.resolve();
    }

    public findRows(
        columnName: string,
        value: DataFrameValue,
        op?: ComparisonOp,
    ): Promise<DataFrameRow<TRowData>[] | undefined> {
        if (!this.columns.has(columnName)) {
            return Promise.resolve(undefined);
        }

        op ??= ComparisonOp.Eq;
        let matches: DataFrameRow<TRowData>[] | undefined;
        for (const row of this.rows) {
            if (this.matchRowData(row.data, columnName, value, op)) {
                matches ??= [];
                matches.push(row);
            }
        }
        return Promise.resolve(matches);
    }

    private matchRowData(
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

export async function lookupDataFrameRow(
    dataFrame: IDataFrame,
    term: PropertySearchTerm,
    exact: boolean = true,
) {}

export async function searchDataFrames(
    dataFrames: DataFrameCollection,
    termGroup: SearchTermGroup,
) {
    for (const term of termGroup.terms) {
        if (isPropertyTerm(term)) {
        } else if (isSearchGroupTerm(term)) {
        } else {
        }
    }
}

/**
 * TODO: need better naming for everything here.
 */
export interface IConversationHybrid<TMessage extends IMessage = IMessage> {
    get conversation(): IConversation<TMessage>;
    get dataFrames(): ReadonlyMap<string, IDataFrame>;
}

export async function searchConversationKnowledgeHybrid(
    hybridConversation: IConversationHybrid,
    searchTermGroup: SearchTermGroup,
    filter: WhenFilter,
    options: SearchOptions,
) {
    const knowledgeResults = await searchConversationKnowledge(
        hybridConversation.conversation,
        searchTermGroup,
        filter,
        options,
    );
    return knowledgeResults;
}

export class DataFrameRowAccumulator extends MatchAccumulator<DataFrameRowId> {
    constructor() {
        super();
    }
}

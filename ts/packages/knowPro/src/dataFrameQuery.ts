// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { MessageAccumulator, TextRangeCollection } from "./collections.js";
import { BooleanOp, isPropertyTerm } from "./compileLib.js";
import {
    DataFrameCollection,
    DataFrameSearchTerm,
    DataFrameTermGroup,
    IDataFrame,
} from "./dataFrame.js";
import {
    PropertySearchTerm,
    SearchTerm,
    SearchTermGroup,
    Term,
} from "./interfaces.js";
import * as q from "./query.js";

export class TextRangeFromDataFrameExpr implements q.IQueryTextRangeSelector {
    constructor(public termGroups: DataFrameTermGroup[]) {}

    public eval(context?: q.QueryEvalContext): TextRangeCollection | undefined {
        const rangeCollection = new TextRangeCollection();
        for (const termGroup of this.termGroups) {
            const matches = termGroup.dataFrame.findSources(termGroup);
            if (matches && matches.length > 0) {
                for (const match of matches) {
                    rangeCollection.addRange(match.range);
                }
            }
        }
        return rangeCollection.size > 0 ? rangeCollection : undefined;
    }
}

export class MatchDataFrameTermsExpr extends q.QueryOpExpr<MessageAccumulator> {
    constructor(public termGroup: DataFrameTermGroup) {
        super();
    }

    public override eval(context?: q.QueryEvalContext): MessageAccumulator {
        const messages = new MessageAccumulator();
        const sourceRefs = this.termGroup.dataFrame.findSources(this.termGroup);
        if (sourceRefs !== undefined) {
            for (const sr of sourceRefs) {
                messages.addRange(sr.range, sr.score ?? 1.0);
            }
        }
        return messages;
    }
}

export class MatchDataFrameExpr extends q.QueryOpExpr<
    MessageAccumulator | undefined
> {
    constructor(public termExpressions: MatchDataFrameTermsExpr[]) {
        super();
    }
    public override eval(
        context?: q.QueryEvalContext,
    ): MessageAccumulator | undefined {
        let matches: MessageAccumulator | undefined;
        for (const termExpr of this.termExpressions) {
            const termMatches = termExpr.eval(context);
            if (termMatches) {
                if (matches) {
                    matches.addUnion(termMatches);
                } else {
                    matches = termMatches;
                }
            }
        }
        return matches;
    }
}

export class DataFrameCompiler {
    constructor(public dataFrames: DataFrameCollection) {}

    public compile(termGroup: SearchTermGroup): MatchDataFrameExpr | undefined {
        const dfTermGroups = getDataFrameTermGroups(this.dataFrames, termGroup);
        if (dfTermGroups === undefined || dfTermGroups.length === 0) {
            return undefined;
        }
        this.validateAndPrepareGroups(dfTermGroups);
        let termExpressions: MatchDataFrameTermsExpr[] = [];
        for (const dfTermGroup of dfTermGroups) {
            termExpressions.push(new MatchDataFrameTermsExpr(dfTermGroup));
        }
        return new MatchDataFrameExpr(termExpressions);
    }

    public compileScope(termGroup: SearchTermGroup) {
        const dfTermGroups = getDataFrameTermGroups(
            this.dataFrames,
            termGroup,
            "and",
        );
        if (dfTermGroups === undefined || dfTermGroups.length === 0) {
            return undefined;
        }
        this.validateAndPrepareGroups(dfTermGroups);
        return new TextRangeFromDataFrameExpr(dfTermGroups);
    }

    private validateAndPrepareGroups(dfGroups: DataFrameTermGroup[]): boolean {
        for (const dfGroup of dfGroups) {
            if (!this.validateAndPrepareTerms(dfGroup.terms)) {
                return false;
            }
        }
        return true;
    }

    private validateAndPrepareTerms(dfTerms: DataFrameSearchTerm[]): boolean {
        for (const dfTerm of dfTerms) {
            if (!this.validateAndPrepareTerm(dfTerm.columnValue.term)) {
                return false;
            }
        }
        return true;
    }

    private validateAndPrepareTerm(term: Term | undefined): boolean {
        if (term) {
            term.text = term.text.toLowerCase();
        }
        return true;
    }
}

/***
 * Binds terms to dataFrames and columns
 * They are grouped by the dataFrame in which columns were found
 */
export function getDataFrameTermGroups(
    dataFrames: DataFrameCollection,
    termGroup: SearchTermGroup,
    booleanOp?: BooleanOp,
): DataFrameTermGroup[] {
    const dfTermGroups = new Map<string, DataFrameTermGroup>();
    for (const term of termGroup.terms) {
        let qualifiedColumn: [IDataFrame, string] | undefined;
        let columnValue: SearchTerm | undefined = undefined;

        if (isPropertyTerm(term)) {
            qualifiedColumn = resolveDataFrameColumn(
                dataFrames,
                columnNameFromPropertyTerm(term),
            );
            columnValue = term.propertyValue;
        } else {
            // Nested or straight search terms not supported
            continue;
        }
        if (qualifiedColumn !== undefined && columnValue) {
            let dataFrame = qualifiedColumn[0];
            let dfGroup = dfTermGroups.get(dataFrame.name);
            if (dfGroup === undefined) {
                dfGroup = {
                    booleanOp: booleanOp ?? termGroup.booleanOp,
                    dataFrame,
                    terms: [],
                };
                dfTermGroups.set(dataFrame.name, dfGroup);
            }
            const columnName = qualifiedColumn[1];
            dfGroup.terms.push({
                columnName,
                columnValue,
            });
        }
    }
    return [...dfTermGroups.values()];
}

export function resolveDataFrameColumn(
    dataFrames: DataFrameCollection,
    qualifiedColumnName: string,
): [IDataFrame, string] | undefined {
    let [dfName, columnName] = getDataFrameAndColumnName(qualifiedColumnName);
    if (dfName) {
        const dataFrame = dataFrames.get(dfName);
        if (dataFrame !== undefined) {
            const columnDef = dataFrame.columns.get(columnName);
            if (columnDef !== undefined) {
                return [dataFrame, columnName];
            }
        }
    } else {
        for (const dataFrame of dataFrames.values()) {
            const columnDef = dataFrame.columns.get(columnName);
            if (columnDef !== undefined) {
                return [dataFrame, columnName];
            }
        }
    }
    return undefined;
}

export function getDataFrameAndColumnName(
    text: string,
): [string | undefined, string] {
    const frameNameStartAt = text.indexOf(".");
    if (frameNameStartAt >= 0) {
        return [
            text.slice(0, frameNameStartAt),
            text.slice(frameNameStartAt + 1),
        ];
    }
    return [undefined, text];
}

function columnNameFromPropertyTerm(propertySearchTerm: PropertySearchTerm) {
    return typeof propertySearchTerm.propertyName === "string"
        ? propertySearchTerm.propertyName
        : propertySearchTerm.propertyName.term.text;
}

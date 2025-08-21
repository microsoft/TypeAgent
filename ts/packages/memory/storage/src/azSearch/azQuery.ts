// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";

export type AzSearchCompilerSettings = {
    /**
     * Always use phrase matching
     */
    phraseMatch: boolean;
    /** Mapping of knowPro {@link kp.PropertyNames} to paths in the Azure Search schema.*/
    propertyFields: Map<kp.PropertyNames, string>;
    timestampField: string;
};

/**
 * {@link https://lucene.apache.org/core/2_9_4/queryparsersyntax.html | Query Syntax}
 * {@link https://learn.microsoft.com/en-us/azure/search/search-query-odata-filter | Filter Syntax}
 */
export class AzSearchQueryCompiler {
    constructor(public settings: AzSearchCompilerSettings) {}

    public compileSearchTermGroup(group: kp.SearchTermGroup): string {
        if (group.terms.length === 0) {
            return "";
        }
        const searchExpressions: string[] = [];
        for (const term of group.terms) {
            if (kp.isSearchGroupTerm(term)) {
                searchExpressions.push(
                    `(${this.compileSearchTermGroup(term)})`,
                );
            } else if (kp.isPropertyTerm(term)) {
                searchExpressions.push(this.compilePropertySearchTerm(term));
            } else {
                searchExpressions.push(this.compileSearchTerm(term));
            }
        }
        return queryMultiBoolExpr(
            group.booleanOp === "and" ? "AND" : "OR",
            searchExpressions,
        );
    }

    public compileWhen(filter: kp.WhenFilter): string | undefined {
        if (filter.dateRange) {
            return this.compileDateRange(filter.dateRange);
        }

        return undefined;
    }

    private compilePropertySearchTerm(term: kp.PropertySearchTerm): string {
        // TODO: handle related terms
        let searchExpr: string;
        if (typeof term.propertyName === "string") {
            searchExpr = this.compilePropertyMatch(
                term.propertyName as kp.PropertyNames,
                term.propertyValue.term,
            );
        } else {
            searchExpr = queryBoolExpr(
                "AND",
                this.compilePropertyMatch(
                    kp.PropertyNames.FacetName,
                    term.propertyName.term,
                ),
                this.compilePropertyMatch(
                    kp.PropertyNames.FacetValue,
                    term.propertyValue.term,
                ),
            );
        }
        return searchExpr;
    }

    private compileSearchTerm(term: kp.SearchTerm): string {
        return queryPhraseMatchExpr(term.term);
    }

    private compilePropertyMatch(
        propertyName: kp.PropertyNames,
        value: kp.Term,
    ) {
        return queryFieldMatchExpr(this.getFieldPath(propertyName), value.text);
    }

    private compileDateRange(dateRange: kp.DateRange): string {
        if (dateRange.end) {
            return filterRangeInclusiveExpr(
                this.settings.timestampField,
                dateRange.start.toISOString(),
                dateRange.end.toISOString(),
            );
        }

        return filterCompareExpr(
            "ge",
            this.settings.timestampField,
            dateRange.start.toISOString(),
        );
    }

    private getFieldPath(propertyName: kp.PropertyNames) {
        const fieldPath = this.settings.propertyFields.get(propertyName);
        if (fieldPath === undefined) {
            throw new Error("Not supported");
        }
        return fieldPath;
    }
}

// Lucene syntax

type QueryBoolOp = "AND" | "OR";

function queryBoolExpr(op: QueryBoolOp, lh: string, rh: string): string {
    return `(${lh} ${op} ${rh})`;
}

function queryMultiBoolExpr(op: QueryBoolOp, expr: string[]): string {
    return expr.length > 1
        ? `(${expr.join(` ${op} `)})`
        : expr.length === 1
          ? expr[0]
          : "";
}

function queryFieldMatchExpr(field: string, value: string): string {
    return `${field}:"${value}"`;
}

function queryPhraseMatchExpr(term: kp.Term): string {
    return `"${term.text}"`;
}

// Filter syntax

type FilterComparisonOp = "lt" | "le" | "gt" | "ge";
type FilterBoolOp = "and" | "or";

function filterRangeInclusiveExpr(
    field: string,
    valueStart: any,
    valueEnd: any,
): string {
    return filterBoolExpr(
        "and",
        filterCompareExpr("ge", field, valueStart),
        filterCompareExpr("le", field, valueEnd),
    );
}

function filterBoolExpr(op: FilterBoolOp, lh: string, rh: string): string {
    return `(${lh} ${op} ${rh})`;
}

function filterCompareExpr(
    op: FilterComparisonOp,
    field: string,
    value: any,
): string {
    return `${field} ${op} ${value}`;
}

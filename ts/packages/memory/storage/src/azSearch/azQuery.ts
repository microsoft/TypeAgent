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
    /**
     * Field that stores {@link kp.KnowledgeType}
     */
    kTypeField: string;
    /**
     * Fields that store {@link kp.TextRange}
     */
    rangeStartField: string;
    rangeEndField: string;
};

/**
 * {@link https://lucene.apache.org/core/2_9_4/queryparsersyntax.html | Query Syntax}
 * {@link https://learn.microsoft.com/en-us/azure/search/search-query-odata-filter | Filter Syntax}
 */
export class AzSearchQueryCompiler {
    constructor(public settings: AzSearchCompilerSettings) {}

    /**
     * Compile into Lucene syntax
     * @param group
     * @returns
     */
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

    public compileWhenFilter(filter: kp.WhenFilter): string | undefined {
        let filterExpressions: string[] = [];
        if (filter.knowledgeType) {
            filterExpressions.push(
                filterCompareExpr(
                    "eq",
                    this.settings.kTypeField,
                    filter.knowledgeType,
                ),
            );
        }
        if (filter.dateRange) {
            filterExpressions.push(this.compileDateRange(filter.dateRange));
        }
        if (filter.textRangesInScope && filter.textRangesInScope.length > 0) {
            const rangeExpressions = filter.textRangesInScope.map((tr) =>
                this.compileTextRange(tr),
            );
            filterExpressions.push(filterMultiBoolExpr("or", rangeExpressions));
        }
        if (
            filter.scopeDefiningTerms &&
            filter.scopeDefiningTerms.terms.length > 0
        ) {
        }
        return filterExpressions.length > 0
            ? filterMultiBoolExpr("and", filterExpressions)
            : undefined;
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

    private compileSearchTerm(searchTerm: kp.SearchTerm): string {
        let searchExpr = queryPhraseExpr(searchTerm.term);
        if (
            searchTerm.relatedTerms === undefined ||
            searchTerm.relatedTerms.length === 0
        ) {
            return searchExpr;
        }
        let searchExprGroup: string[] = [searchExpr];
        for (const relatedTerm of searchTerm.relatedTerms) {
            searchExprGroup.push(queryPhraseExpr(relatedTerm));
        }
        return queryMultiBoolExpr("OR", searchExprGroup);
    }

    private compilePropertyMatch(
        propertyName: kp.PropertyNames,
        value: kp.Term,
    ) {
        return queryFieldMatchExpr(this.getFieldPath(propertyName), value);
    }

    private compileDateRange(dateRange: kp.DateRange): string {
        if (dateRange.end) {
            return filterBoolExpr(
                "and",
                filterCompareExpr(
                    "ge",
                    this.settings.timestampField,
                    dateRange.start.toISOString(),
                ),
                filterCompareExpr(
                    "le",
                    this.settings.timestampField,
                    dateRange.end.toISOString(),
                ),
            );
        }

        return filterCompareExpr(
            "ge",
            this.settings.timestampField,
            dateRange.start.toISOString(),
        );
    }

    private compileTextRange(textRange: kp.TextRange): string {
        if (textRange.end) {
            return filterBoolExpr(
                "and",
                filterCompareExpr(
                    "ge",
                    this.settings.rangeStartField,
                    textRange.start.messageOrdinal,
                ),
                // Range end is exclusive
                filterCompareExpr(
                    "lt",
                    this.settings.rangeEndField,
                    textRange.end.messageOrdinal,
                ),
            );
        }

        return filterCompareExpr(
            "eq",
            this.settings.rangeStartField,
            textRange.start.messageOrdinal,
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

function queryFieldMatchExpr(field: string, value: kp.Term): string {
    return `${field}:${queryPhraseExpr(value)}`;
}

function queryPhraseExpr(term: kp.Term): string {
    return term.weight && term.weight !== 1.0
        ? `"${term.text}"^${term.weight}`
        : `"${term.text}"`;
}

/*
function queryTermExpr(term: kp.Term): string {
    return term.weight && term.weight !== 1.0
        ? `${term.text}^${term.weight}`
        : term.text;
}
*/

// Filter syntax

type FilterComparisonOp = "eq" | "lt" | "le" | "gt" | "ge";
type FilterBoolOp = "and" | "or";

function filterBoolExpr(op: FilterBoolOp, lh: string, rh: string): string {
    return `(${lh} ${op} ${rh})`;
}

function filterMultiBoolExpr(op: FilterBoolOp, expr: string[]): string {
    return expr.length > 1
        ? `(${expr.join(` ${op} `)})`
        : expr.length === 1
          ? expr[0]
          : "";
}

function filterCompareExpr(
    op: FilterComparisonOp,
    field: string,
    value: any,
): string {
    if (typeof value === "string") {
        return `${field} ${op} '${value}'`;
    }
    return `${field} ${op} ${value}`;
}
